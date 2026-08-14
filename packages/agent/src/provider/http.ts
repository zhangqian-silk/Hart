import type {
  AgentContext,
  AgentDecision,
  AgentProfile,
  AgentProvider,
} from '../types.js';
import { parseResponse, toRequestMessage, validateDecision } from '../protocol.js';

export interface HttpProviderOptions {
  /** Webhook URL，接收 Agent Protocol 请求，返回 { action, reasoning? } */
  url: string;
  /** 超时毫秒，默认 60s */
  timeoutMs?: number;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 失败重试次数（不含首次），默认 1 */
  retries?: number;
}

/**
 * HTTP Agent（V8: HTTP Agent）。
 * 把决策上下文 POST 到外部 webhook，由外部服务返回动作。
 */
export class HttpProvider implements AgentProvider {
  readonly kind = 'http';
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private readonly retries: number;

  constructor(
    private readonly profile: AgentProfile,
    options: HttpProviderOptions,
  ) {
    this.url = options.url;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.headers = options.headers ?? { 'Content-Type': 'application/json' };
    this.retries = options.retries ?? 1;
  }

  async start(): Promise<void> {
    // 探活：HEAD 或 GET，失败不阻塞（有些 webhook 不支持）
  }

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const body = JSON.stringify(toRequestMessage(ctx));
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const res = await fetch(this.url, {
          method: 'POST',
          headers: this.headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
        }
        const text = await res.text();
        const parsed = parseResponse(text);
        const v = validateDecision(
          { action: parsed.action, reasoning: parsed.reasoning },
          ctx.actions,
        );
        if (!v.ok) throw new Error(v.error);
        return { action: v.action, reasoning: parsed.reasoning };
      } catch (e) {
        lastError = e;
        if (attempt < this.retries) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }
    throw new Error(
      `HTTP Agent 决策失败（${this.profile.name}）: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  async stop(): Promise<void> {}
}

export function createHttpProvider(
  profile: AgentProfile,
  options?: Record<string, unknown>,
): AgentProvider {
  const opts = options ?? {};
  if (typeof opts.url !== 'string') {
    throw new Error('HttpProvider 需要 url 参数');
  }
  return new HttpProvider(profile, {
    url: opts.url,
    timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : undefined,
    headers: opts.headers as Record<string, string> | undefined,
    retries: typeof opts.retries === 'number' ? opts.retries : undefined,
  });
}
