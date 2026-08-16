import type {
  AgentContext,
  AgentDecision,
  AgentProfile,
  AgentProvider,
} from '../types.js';
import { parseResponse, validateDecision } from '../protocol.js';
import { buildInitialPrompt, buildTurnPrompt } from '../prompt.js';
import { getGame } from '@hart/common';

export interface AnthropicProviderOptions {
  /** API Key（x-api-key 头） */
  apiKey: string;
  /** API 端点，默认 https://api.anthropic.com（可指向任意 Anthropic 兼容网关） */
  baseUrl?: string;
  /** 模型 id，如 claude-sonnet-5 */
  model: string;
  /** 努力程度：映射为 extended thinking 预算（low/medium/high/xhigh/max） */
  effort?: string;
  /** 超时毫秒，默认 120s */
  timeoutMs?: number;
  /** 最大输出 token，默认 4096 */
  maxTokens?: number;
  /** 失败重试次数（不含首次），默认 1 */
  retries?: number;
  /** 测试注入：替换 fetch（生产环境不要传） */
  fetchImpl?: typeof fetch;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** effort → extended thinking 预算（token） */
const THINKING_BUDGET: Record<string, number> = {
  low: 2_048,
  medium: 4_096,
  high: 8_192,
  xhigh: 16_384,
  max: 32_768,
};

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

/** 调试日志（HART_AGENT_DEBUG=1 时输出） */
function debugLog(msg: string): void {
  if (process.env.HART_AGENT_DEBUG) {
    console.error(`[hart-agent] ${msg}`);
  }
}

/**
 * Anthropic 直连 Agent（BYOK）。
 * 直接调用 Messages API，不依赖 CLI 子进程；每局游戏在内存中维护会话历史。
 * 凭据（apiKey/baseUrl）按 Provider 实例隔离，天然支持多玩家各带各的 key。
 */
export class AnthropicProvider implements AgentProvider {
  readonly kind = 'anthropic';
  private messages: ChatMessage[] = [];
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly thinkingBudget: number | null;

  constructor(
    private readonly profile: AgentProfile,
    options: AnthropicProviderOptions,
  ) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxTokens = options.maxTokens ?? 4_096;
    this.retries = options.retries ?? 1;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.thinkingBudget = options.effort
      ? (THINKING_BUDGET[options.effort.toLowerCase()] ?? null)
      : null;
  }

  async start(): Promise<void> {
    // 新一局 = 新会话
    this.messages = [];
  }

  /** 调用一次 Messages API，返回助手文本 */
  private async callApi(prompt: string, withThinking: boolean): Promise<string> {
    const messages = [...this.messages, { role: 'user' as const, content: prompt }];
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens:
        this.thinkingBudget && withThinking
          ? Math.max(this.maxTokens, this.thinkingBudget + 2_048)
          : this.maxTokens,
      messages,
    };
    if (this.thinkingBudget && withThinking) {
      body.thinking = { type: 'enabled', budget_tokens: this.thinkingBudget };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 300);
      try {
        const err = JSON.parse(text) as { error?: { message?: string } };
        if (err.error?.message) detail = err.error.message;
      } catch {
        // 非 JSON 错误体，用原文
      }
      throw new Error(`Anthropic API HTTP ${res.status}: ${detail}`);
    }
    const data = JSON.parse(text) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const parts = (data.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string);
    if (parts.length === 0) throw new Error('Anthropic API 返回中没有文本块');
    return parts.join('\n');
  }

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const rules = getGame(ctx.game)?.meta.rules ?? '';
    const initialPrompt = buildInitialPrompt({ profile: this.profile, ctx, rules });
    const turnPrompt = buildTurnPrompt({ profile: this.profile, ctx, rules });
    const prompt = this.messages.length === 0 ? initialPrompt : turnPrompt;

    let lastError: unknown = null;
    let thinkingDisabled = false;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const reply = await this.callApi(prompt, !thinkingDisabled);
        // 会话历史：追加本轮问答，供后续回合续接
        this.messages.push({ role: 'user', content: prompt });
        this.messages.push({ role: 'assistant', content: reply });
        const parsed = parseResponse(reply);
        const v = validateDecision(
          { action: parsed.action, reasoning: parsed.reasoning },
          ctx.actions,
        );
        if (!v.ok) throw new Error(v.error);
        return { action: v.action, reasoning: parsed.reasoning };
      } catch (e) {
        lastError = e;
        // thinking 不被支持（如部分网关/模型）时，降级为无 thinking 重试
        if (
          this.thinkingBudget &&
          !thinkingDisabled &&
          e instanceof Error &&
          /thinking/i.test(e.message)
        ) {
          debugLog(`anthropic thinking 被拒绝，降级重试: ${e.message}`);
          thinkingDisabled = true;
          attempt--; // 降级不算重试次数
          continue;
        }
        if (attempt < this.retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Anthropic 决策失败');
  }

  async stop(): Promise<void> {
    this.messages = [];
  }
}

export function createAnthropicProvider(
  profile: AgentProfile,
  options?: Record<string, unknown>,
): AgentProvider {
  const opts = options ?? {};
  if (typeof opts.apiKey !== 'string' || !opts.apiKey) {
    throw new Error('AnthropicProvider 需要 apiKey 参数');
  }
  if (typeof opts.model !== 'string' || !opts.model) {
    throw new Error('AnthropicProvider 需要 model 参数');
  }
  return new AnthropicProvider(profile, {
    apiKey: opts.apiKey,
    model: opts.model,
    baseUrl: typeof opts.baseUrl === 'string' ? opts.baseUrl : undefined,
    effort: typeof opts.effort === 'string' ? opts.effort : undefined,
    timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : undefined,
    maxTokens: typeof opts.maxTokens === 'number' ? opts.maxTokens : undefined,
    retries: typeof opts.retries === 'number' ? opts.retries : undefined,
    fetchImpl: typeof opts.fetchImpl === 'function' ? (opts.fetchImpl as typeof fetch) : undefined,
  });
}
