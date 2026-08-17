import type {
  AgentContext,
  AgentDecision,
  AgentProfile,
  AgentProvider,
} from '../types.js';
import { parseResponse, validateDecision } from '../protocol.js';
import { buildSystemPrompt, buildObservationPrompt } from '../prompt.js';
import { getGame } from '@hart/common';

export interface OpenAiProviderOptions {
  /** API Key（Authorization: Bearer 头） */
  apiKey: string;
  /** API 端点，默认 https://api.openai.com（可指向任意 OpenAI 兼容网关） */
  baseUrl?: string;
  /** 模型 id，如 gpt-5；网关场景填网关侧的模型 ID */
  model: string;
  /**
   * 努力程度：low/medium/high 映射为 reasoning_effort（o 系列/部分网关支持）；
   * 'off' 或其他值不发送该参数。被网关拒绝时自动降级重试。
   */
  effort?: string;
  /** 超时毫秒，默认 120s */
  timeoutMs?: number;
  /** 最大输出 token，默认 4096 */
  maxTokens?: number;
  /** 失败重试次数（不含首次），默认 1 */
  retries?: number;
  /**
   * 会话模式：
   * - 'fresh'（默认）：每轮只发当前观察，不累积历史。延迟恒定、上下文不增长；
   *   平台 prompt 已含近 12 个事件与记忆。
   * - 'resume'：内存中保留完整对话历史，每轮重发（长局会变慢）。
   */
  sessionMode?: 'fresh' | 'resume';
  /** 测试注入：替换 fetch（生产环境不要传） */
  fetchImpl?: typeof fetch;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** effort → OpenAI reasoning_effort（仅这三档是合法值） */
const REASONING_EFFORT: Record<string, 'low' | 'medium' | 'high'> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};

const DEFAULT_BASE_URL = 'https://api.openai.com';

/** 调试日志（HART_AGENT_DEBUG=1 时输出） */
function debugLog(msg: string): void {
  if (process.env.HART_AGENT_DEBUG) {
    console.error(`[hart-agent] ${msg}`);
  }
}

/**
 * OpenAI 兼容直连 Agent（BYOK）。
 * 直接调用 Chat Completions API（POST {baseUrl}/v1/chat/completions，Bearer 鉴权），
 * 不依赖 SDK 与 CLI 子进程。任何 OpenAI 兼容端点（官方、relay、网关）均可使用。
 * 静态提示走 system 消息；sessionMode='fresh'（默认）时不累积历史，每轮延迟恒定。
 * 凭据（apiKey/baseUrl）按 Provider 实例隔离，天然支持多玩家各带各的 key。
 */
export class OpenAiProvider implements AgentProvider {
  readonly kind = 'openai';
  private messages: ChatMessage[] = [];
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxTokens: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly reasoningEffort: 'low' | 'medium' | 'high' | null;
  private readonly sessionMode: 'fresh' | 'resume';

  constructor(
    private readonly profile: AgentProfile,
    options: OpenAiProviderOptions,
  ) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxTokens = options.maxTokens ?? 4_096;
    this.retries = options.retries ?? 1;
    this.fetchImpl = options.fetchImpl ?? fetch;
    const effort = options.effort?.toLowerCase();
    this.reasoningEffort =
      effort && effort !== 'off' ? (REASONING_EFFORT[effort] ?? null) : null;
    this.sessionMode = options.sessionMode ?? 'fresh';
  }

  async start(): Promise<void> {
    // 新一局 = 新会话
    this.messages = [];
  }

  /** 调用一次 Chat Completions API，返回助手文本 */
  private async callApi(
    systemText: string,
    userText: string,
    withReasoning: boolean,
  ): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: systemText },
      ...this.messages,
      { role: 'user', content: userText },
    ];
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages,
    };
    if (this.reasoningEffort && withReasoning) {
      body.reasoning_effort = this.reasoningEffort;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
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
      throw new Error(`OpenAI API HTTP ${res.status}: ${detail}`);
    }
    const data = JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('OpenAI API 返回中没有 choices[0].message.content');
    }
    return content;
  }

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const rules = getGame(ctx.game)?.meta.rules ?? '';
    const input = { profile: this.profile, ctx, rules };
    const systemText = buildSystemPrompt(input);
    const userText = buildObservationPrompt(input);

    let lastError: unknown = null;
    let reasoningDisabled = false;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const reply = await this.callApi(systemText, userText, !reasoningDisabled);
        // resume 模式：追加本轮问答供后续回合续接；fresh 模式不累积
        if (this.sessionMode === 'resume') {
          this.messages.push({ role: 'user', content: userText });
          this.messages.push({ role: 'assistant', content: reply });
        }
        const parsed = parseResponse(reply);
        const v = validateDecision(
          { action: parsed.action, reasoning: parsed.reasoning },
          ctx.actions,
        );
        if (!v.ok) throw new Error(v.error);
        return { action: v.action, reasoning: parsed.reasoning };
      } catch (e) {
        lastError = e;
        // reasoning_effort 不被支持（部分网关/模型）时，去掉该参数重试
        if (
          this.reasoningEffort &&
          !reasoningDisabled &&
          e instanceof Error &&
          /reasoning/i.test(e.message)
        ) {
          debugLog(`openai reasoning_effort 被拒绝，降级重试: ${e.message}`);
          reasoningDisabled = true;
          attempt--; // 降级不算重试次数
          continue;
        }
        if (attempt < this.retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('OpenAI 决策失败');
  }

  async stop(): Promise<void> {
    this.messages = [];
  }
}

export function createOpenAiProvider(
  profile: AgentProfile,
  options?: Record<string, unknown>,
): AgentProvider {
  const opts = options ?? {};
  if (typeof opts.apiKey !== 'string' || !opts.apiKey) {
    throw new Error('OpenAiProvider 需要 apiKey 参数');
  }
  if (typeof opts.model !== 'string' || !opts.model) {
    throw new Error('OpenAiProvider 需要 model 参数');
  }
  return new OpenAiProvider(profile, {
    apiKey: opts.apiKey,
    model: opts.model,
    baseUrl: typeof opts.baseUrl === 'string' ? opts.baseUrl : undefined,
    effort: typeof opts.effort === 'string' ? opts.effort : undefined,
    timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : undefined,
    maxTokens: typeof opts.maxTokens === 'number' ? opts.maxTokens : undefined,
    retries: typeof opts.retries === 'number' ? opts.retries : undefined,
    sessionMode: opts.sessionMode === 'resume' ? 'resume' : undefined,
    fetchImpl: typeof opts.fetchImpl === 'function' ? (opts.fetchImpl as typeof fetch) : undefined,
  });
}
