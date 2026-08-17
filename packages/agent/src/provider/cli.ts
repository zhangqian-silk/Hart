import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type {
  AgentContext,
  AgentDecision,
  AgentProfile,
  AgentProvider,
} from '../types.js';
import { parseResponse, validateDecision } from '../protocol.js';
import { buildInitialPrompt, buildTurnPrompt } from '../prompt.js';
import { getGame } from '@hart/common';

export interface CliProviderOptions {
  /** 可执行文件路径或命令名，默认 'claude' / 'codex' */
  binPath?: string;
  /** 模型（透传 --model） */
  model?: string;
  /** 努力程度（claude 透传 --effort；codex 走 -c model_reasoning_effort=） */
  effort?: string;
  /** 超时毫秒，默认 180s */
  timeoutMs?: number;
  /** 额外命令行参数 */
  extraArgs?: string[];
  /** 失败重试次数，默认 1 */
  retries?: number;
  /** API Key：claude 注入 ANTHROPIC_API_KEY，codex 注入 OPENAI_API_KEY（BYOK 用） */
  apiKey?: string;
  /** 自定义 API 端点：claude 注入 ANTHROPIC_BASE_URL（中转/网关用） */
  baseUrl?: string;
  /** 独立配置目录：claude 注入 CLAUDE_CONFIG_DIR（多账号隔离，会话也按目录隔离） */
  configDir?: string;
  /**
   * 会话模式：
   * - 'fresh'（默认）：每轮新会话 + 完整自包含 prompt。延迟恒定，上下文不随轮次增长；
   *   平台 prompt 已含近 12 个事件与记忆，不损失游戏能力。
   * - 'resume'：首轮建会话，后续轮 --resume 续接（CLI 侧保留完整对话记忆），
   *   但每轮重发累积历史，长局会越来越慢。
   */
  sessionMode?: 'fresh' | 'resume';
  /** 测试注入：替换子进程执行器（生产环境不要传） */
  runner?: (bin: string, args: string[], input: string, timeoutMs: number, env?: Record<string, string>) => Promise<string>;
}

/** 运行 CLI 子进程并收集 stdout */
function runCli(
  bin: string,
  args: string[],
  input: string,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(env ?? {}) },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI 超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 ${bin}: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${bin} 退出码 ${code}: ${stderr.slice(-500)}`));
      } else {
        resolve(stdout);
      }
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

type Runner = typeof runCli;

/** 由凭据选项组装子进程环境变量（BYOK：每个 AI 可用独立 key/端点/配置目录） */
function cliEnv(
  kind: 'claude-code' | 'codex',
  opts: { apiKey?: string; baseUrl?: string; configDir?: string },
): Record<string, string> {
  const env: Record<string, string> = {};
  if (opts.apiKey) {
    env[kind === 'claude-code' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'] = opts.apiKey;
  }
  if (kind === 'claude-code') {
    if (opts.baseUrl) env.ANTHROPIC_BASE_URL = opts.baseUrl;
    if (opts.configDir) env.CLAUDE_CONFIG_DIR = opts.configDir;
  }
  return env;
}

/** 判断是否为传输层错误（子进程退出码/超时/启动失败），而非模型输出问题 */
function isTransportError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return /退出码|超时|无法启动/.test(e.message);
}

/** 调试日志（HART_AGENT_DEBUG=1 时输出） */
function debugLog(msg: string): void {
  if (process.env.HART_AGENT_DEBUG) {
    console.error(`[hart-agent] ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Codex JSONL 解析
// ---------------------------------------------------------------------------

interface CodexStream {
  threadId?: string;
  message: string;
}

/**
 * 解析 `codex exec --json` 的 JSONL 输出流。
 * 提取 thread_id（用于续接）和最终 agent_message。
 */
function parseCodexJsonl(stdout: string): CodexStream {
  let threadId: string | undefined;
  let lastAgentMessage: string | undefined;
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let evt: {
      type?: string;
      thread_id?: string;
      item?: { type?: string; text?: string };
      error?: { message?: string };
      message?: string;
    };
    try {
      evt = JSON.parse(t);
    } catch {
      continue;
    }
    if (evt.type === 'thread.started' && typeof evt.thread_id === 'string') {
      threadId = evt.thread_id;
    } else if (
      (evt.type === 'item.completed' || evt.type === 'item.updated') &&
      evt.item?.type === 'agent_message' &&
      typeof evt.item.text === 'string' &&
      evt.item.text.length > 0
    ) {
      lastAgentMessage = evt.item.text;
    } else if (evt.type === 'turn.failed') {
      throw new Error(`codex turn.failed: ${evt.error?.message ?? '未知错误'}`);
    } else if (evt.type === 'error') {
      throw new Error(`codex 流错误: ${evt.message ?? '未知错误'}`);
    }
  }
  if (!lastAgentMessage) throw new Error('codex 输出中未找到 agent_message');
  return { threadId, message: lastAgentMessage };
}

// ---------------------------------------------------------------------------
// Claude Code Provider
// ---------------------------------------------------------------------------

/**
 * Claude Code Agent（V8: Claude Code）。
 * 通过 `claude -p --output-format json` 非交互调用。
 * 会话模式（sessionMode）：
 * - 'fresh'（默认）：每轮新会话 + 完整 prompt，延迟恒定；
 * - 'resume'：每局维护持久会话，首轮 --session-id 建会话，后续 --resume 续接。
 */
export class ClaudeCodeProvider implements AgentProvider {
  readonly kind = 'claude-code';
  private sessionId: string | null = null;
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly extraArgs: string[];
  private readonly retries: number;
  private readonly env: Record<string, string>;
  private readonly run: Runner;
  private readonly sessionMode: 'fresh' | 'resume';

  constructor(
    private readonly profile: AgentProfile,
    options: CliProviderOptions = {},
  ) {
    this.bin = options.binPath ?? 'claude';
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.extraArgs = [
      ...(options.model ? ['--model', options.model] : []),
      ...(options.effort ? ['--effort', options.effort] : []),
      ...(options.extraArgs ?? []),
    ];
    this.retries = options.retries ?? 1;
    this.env = cliEnv('claude-code', options);
    this.run = options.runner ?? runCli;
    this.sessionMode = options.sessionMode ?? 'fresh';
  }

  async start(): Promise<void> {
    // 新一局 = 新会话
    this.sessionId = null;
  }

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const rules = getGame(ctx.game)?.meta.rules ?? '';
    const initialPrompt = buildInitialPrompt({ profile: this.profile, ctx, rules });
    const turnPrompt = buildTurnPrompt({ profile: this.profile, ctx, rules });

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const useResume = this.sessionMode === 'resume';
      const resuming = useResume && this.sessionId !== null;
      const id = this.sessionId ?? randomUUID();
      const args = resuming
        ? ['-p', '--output-format', 'json', '--resume', id, ...this.extraArgs]
        : ['-p', '--output-format', 'json', '--session-id', id, ...this.extraArgs];
      const prompt = resuming ? turnPrompt : initialPrompt;
      debugLog(`claude-code ${resuming ? 'resume' : 'fresh'} session ${id}`);

      try {
        const stdout = await this.run(this.bin, args, prompt, this.timeoutMs, this.env);
        // 会话建立成功：resume 模式记下 id 供后续轮沿用；fresh 模式不保留
        if (useResume) this.sessionId = id;
        // claude --output-format json 返回 { result: string } 或直接文本
        let text = stdout;
        try {
          const obj = JSON.parse(stdout) as { result?: string };
          if (typeof obj.result === 'string') text = obj.result;
        } catch {
          // 非 JSON 输出，直接当文本解析
        }
        const parsed = parseResponse(text);
        const v = validateDecision(
          { action: parsed.action, reasoning: parsed.reasoning },
          ctx.actions,
        );
        if (!v.ok) throw new Error(v.error);
        return { action: v.action, reasoning: parsed.reasoning };
      } catch (e) {
        lastError = e;
        // 仅在传输层失败（子进程退出码/超时/启动失败）时丢弃会话；
        // 解析/校验失败说明会话本身健康，保留会话按原回合提示重试。
        if (resuming && isTransportError(e)) {
          debugLog(`claude-code resume 失败，回退为全新会话: ${(e as Error).message}`);
          this.sessionId = null;
        }
        if (attempt < this.retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Claude Code 决策失败');
  }

  async stop(): Promise<void> {
    this.sessionId = null;
  }
}

// ---------------------------------------------------------------------------
// Codex Provider
// ---------------------------------------------------------------------------

/**
 * Codex Agent（V8: Codex）。
 * 通过 `codex exec --json` 非交互调用。
 * 会话模式（sessionMode）：
 * - 'fresh'（默认）：每轮新会话 + 完整 prompt，延迟恒定；
 * - 'resume'：每局维护持久会话，首轮 exec 建会话并捕获 thread_id，后续 exec resume 续接。
 */
export class CodexProvider implements AgentProvider {
  readonly kind = 'codex';
  private threadId: string | null = null;
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly extraArgs: string[];
  private readonly retries: number;
  private readonly env: Record<string, string>;
  private readonly run: Runner;
  private readonly sessionMode: 'fresh' | 'resume';

  constructor(
    private readonly profile: AgentProfile,
    options: CliProviderOptions = {},
  ) {
    this.bin = options.binPath ?? 'codex';
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.extraArgs = [
      ...(options.model ? ['--model', options.model] : []),
      ...(options.effort ? ['-c', `model_reasoning_effort=${options.effort}`] : []),
      ...(options.extraArgs ?? []),
    ];
    this.retries = options.retries ?? 1;
    this.env = cliEnv('codex', options);
    this.run = options.runner ?? runCli;
    this.sessionMode = options.sessionMode ?? 'fresh';
  }

  async start(): Promise<void> {
    this.threadId = null;
  }

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const rules = getGame(ctx.game)?.meta.rules ?? '';
    const initialPrompt = buildInitialPrompt({ profile: this.profile, ctx, rules });
    const turnPrompt = buildTurnPrompt({ profile: this.profile, ctx, rules });

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const useResume = this.sessionMode === 'resume';
      const resuming = useResume && this.threadId !== null;
      const args = resuming
        ? ['exec', 'resume', this.threadId!, '-', '--json', ...this.extraArgs]
        : ['exec', '--json', ...this.extraArgs];
      const prompt = resuming ? turnPrompt : initialPrompt;
      debugLog(`codex ${resuming ? `resume ${this.threadId}` : 'fresh session'}`);

      try {
        const stdout = await this.run(this.bin, args, prompt, this.timeoutMs, this.env);
        const { threadId, message } = parseCodexJsonl(stdout);
        // resume 模式：首轮捕获 thread_id，续跑时以流里的为准；fresh 模式忽略
        if (useResume) {
          if (threadId) this.threadId = threadId;
          else if (!this.threadId) throw new Error('codex 未返回 thread_id');
        }
        const parsed = parseResponse(message);
        const v = validateDecision(
          { action: parsed.action, reasoning: parsed.reasoning },
          ctx.actions,
        );
        if (!v.ok) throw new Error(v.error);
        return { action: v.action, reasoning: parsed.reasoning };
      } catch (e) {
        lastError = e;
        if (resuming && isTransportError(e)) {
          debugLog(`codex resume 失败，回退为全新会话: ${(e as Error).message}`);
          this.threadId = null;
        }
        if (attempt < this.retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Codex 决策失败');
  }

  async stop(): Promise<void> {
    this.threadId = null;
  }
}

// ---------------------------------------------------------------------------
// 工厂函数
// ---------------------------------------------------------------------------

export function createClaudeCodeProvider(
  profile: AgentProfile,
  options?: Record<string, unknown>,
): AgentProvider {
  const opts = options ?? {};
  return new ClaudeCodeProvider(profile, {
    binPath: typeof opts.binPath === 'string' ? opts.binPath : undefined,
    model: typeof opts.model === 'string' ? opts.model : undefined,
    effort: typeof opts.effort === 'string' ? opts.effort : undefined,
    timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : undefined,
    extraArgs: Array.isArray(opts.extraArgs) ? (opts.extraArgs as string[]) : undefined,
    apiKey: typeof opts.apiKey === 'string' ? opts.apiKey : undefined,
    baseUrl: typeof opts.baseUrl === 'string' ? opts.baseUrl : undefined,
    configDir: typeof opts.configDir === 'string' ? opts.configDir : undefined,
    sessionMode: opts.sessionMode === 'resume' ? 'resume' : undefined,
  });
}

export function createCodexProvider(
  profile: AgentProfile,
  options?: Record<string, unknown>,
): AgentProvider {
  const opts = options ?? {};
  return new CodexProvider(profile, {
    binPath: typeof opts.binPath === 'string' ? opts.binPath : undefined,
    model: typeof opts.model === 'string' ? opts.model : undefined,
    effort: typeof opts.effort === 'string' ? opts.effort : undefined,
    timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : undefined,
    extraArgs: Array.isArray(opts.extraArgs) ? (opts.extraArgs as string[]) : undefined,
    apiKey: typeof opts.apiKey === 'string' ? opts.apiKey : undefined,
    sessionMode: opts.sessionMode === 'resume' ? 'resume' : undefined,
  });
}
