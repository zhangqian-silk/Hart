import { spawn } from 'node:child_process';
import type {
  AgentContext,
  AgentDecision,
  AgentProfile,
  AgentProvider,
} from '../types.js';
import { parseResponse, validateDecision } from '../protocol.js';
import { buildPrompt } from '../prompt.js';
import { getGame } from '@hart/common';

export interface CliProviderOptions {
  /** 可执行文件路径或命令名，默认 'claude' / 'codex' */
  binPath?: string;
  /** 超时毫秒，默认 180s */
  timeoutMs?: number;
  /** 额外命令行参数 */
  extraArgs?: string[];
  /** 失败重试次数，默认 1 */
  retries?: number;
}

/** 运行 CLI 子进程并收集 stdout */
function runCli(
  bin: string,
  args: string[],
  input: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
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

/**
 * Claude Code Agent（V8: Claude Code）。
 * 通过 `claude -p --output-format json` 非交互调用。
 */
export class ClaudeCodeProvider implements AgentProvider {
  readonly kind = 'claude-code';
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly extraArgs: string[];
  private readonly retries: number;

  constructor(
    private readonly profile: AgentProfile,
    options: CliProviderOptions = {},
  ) {
    this.bin = options.binPath ?? 'claude';
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.extraArgs = options.extraArgs ?? [];
    this.retries = options.retries ?? 1;
  }

  async start(): Promise<void> {
    // 不做探活：首次 decide 时若 CLI 不存在会报清晰错误
  }

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const rules = getGame(ctx.game)?.meta.rules ?? '';
    const prompt = buildPrompt({ profile: this.profile, ctx, rules });
    const args = ['-p', '--output-format', 'json', ...this.extraArgs];
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const stdout = await runCli(this.bin, args, prompt, this.timeoutMs);
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
        if (attempt < this.retries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Claude Code 决策失败');
  }

  async stop(): Promise<void> {}
}

/**
 * Codex Agent（V8: Codex）。
 * 通过 `codex exec` 非交互调用。
 */
export class CodexProvider implements AgentProvider {
  readonly kind = 'codex';
  private readonly bin: string;
  private readonly timeoutMs: number;
  private readonly extraArgs: string[];

  constructor(
    private readonly profile: AgentProfile,
    options: CliProviderOptions = {},
  ) {
    this.bin = options.binPath ?? 'codex';
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.extraArgs = options.extraArgs ?? [];
  }

  async start(): Promise<void> {}

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const rules = getGame(ctx.game)?.meta.rules ?? '';
    const prompt = buildPrompt({ profile: this.profile, ctx, rules });
    const args = ['exec', ...this.extraArgs];
    const stdout = await runCli(this.bin, args, prompt, this.timeoutMs);
    const parsed = parseResponse(stdout);
    const v = validateDecision(
      { action: parsed.action, reasoning: parsed.reasoning },
      ctx.actions,
    );
    if (!v.ok) throw new Error(v.error);
    return { action: v.action, reasoning: parsed.reasoning };
  }

  async stop(): Promise<void> {}
}

export function createClaudeCodeProvider(
  profile: AgentProfile,
  options?: Record<string, unknown>,
): AgentProvider {
  const opts = options ?? {};
  return new ClaudeCodeProvider(profile, {
    binPath: typeof opts.binPath === 'string' ? opts.binPath : undefined,
    timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : undefined,
    extraArgs: Array.isArray(opts.extraArgs) ? (opts.extraArgs as string[]) : undefined,
  });
}

export function createCodexProvider(
  profile: AgentProfile,
  options?: Record<string, unknown>,
): AgentProvider {
  const opts = options ?? {};
  return new CodexProvider(profile, {
    binPath: typeof opts.binPath === 'string' ? opts.binPath : undefined,
    timeoutMs: typeof opts.timeoutMs === 'number' ? opts.timeoutMs : undefined,
    extraArgs: Array.isArray(opts.extraArgs) ? (opts.extraArgs as string[]) : undefined,
  });
}
