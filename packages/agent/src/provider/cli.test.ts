import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROFILES } from '../profiles.js';
import { ClaudeCodeProvider, CodexProvider } from './cli.js';
import type { AgentContext } from '../types.js';

const profile = BUILTIN_PROFILES[0]!;

function makeContext(actions: unknown[] = [{ t: 'pass' }]): AgentContext {
  return {
    game: 'wuziqi',
    you: 'p1',
    role: 'black',
    visibleState: { game: 'wuziqi', phase: 'playing' } as never,
    turn: { active: ['p1'], phase: 'playing' },
    actions,
    history: [],
    players: [{ id: 'p1', name: 'A', seat: 0 }],
    memory: { profileNote: '', gameSummary: '', relationships: {} },
  };
}

/** Claude 返回的合法决策（包在 {result} 里） */
const CLAUDE_OK = JSON.stringify({
  result: JSON.stringify({ action: { t: 'pass' }, reasoning: 'ok' }),
});

/** 构造 codex JSONL 输出 */
function codexJsonl(threadId: string, message: string): string {
  return [
    JSON.stringify({ type: 'thread.started', thread_id: threadId }),
    JSON.stringify({
      type: 'item.completed',
      item: { id: '1', type: 'agent_message', text: message },
    }),
    JSON.stringify({ type: 'turn.completed' }),
  ].join('\n');
}

const CODEX_OK = (id: string) =>
  codexJsonl(id, JSON.stringify({ action: { t: 'pass' }, reasoning: 'ok' }));

// ---------------------------------------------------------------------------
// ClaudeCodeProvider
// ---------------------------------------------------------------------------

describe('ClaudeCodeProvider 会话管理', () => {
  it('首轮用 --session-id 建会话，prompt 含完整身份', async () => {
    const calls: { args: string[]; input: string }[] = [];
    const provider = new ClaudeCodeProvider(profile, {
      runner: vi.fn(async (_bin, args, input) => {
        calls.push({ args: [...args], input });
        return CLAUDE_OK;
      }),
    });
    await provider.decide(makeContext());

    expect(calls).toHaveLength(1);
    const args = calls[0]!.args;
    expect(args).toContain('--session-id');
    const idIdx = args.indexOf('--session-id');
    expect(args[idIdx + 1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(calls[0]!.input).toContain('## Base Identity');
    expect(calls[0]!.input).toContain('## Game Rules');
  });

  it('后续轮用 --resume 同一 ID，prompt 只含续场观察', async () => {
    const calls: { args: string[]; input: string }[] = [];
    const provider = new ClaudeCodeProvider(profile, {
      runner: vi.fn(async (_bin, args, input) => {
        calls.push({ args: [...args], input });
        return CLAUDE_OK;
      }),
    });
    await provider.decide(makeContext());
    await provider.decide(makeContext());

    expect(calls).toHaveLength(2);
    // 第二轮用 --resume
    const args2 = calls[1]!.args;
    expect(args2).toContain('--resume');
    expect(args2).not.toContain('--session-id');
    // 同一 session ID
    const id1 = calls[0]!.args[calls[0]!.args.indexOf('--session-id') + 1];
    const id2 = args2[args2.indexOf('--resume') + 1];
    expect(id2).toBe(id1);
    // 续场 prompt 不含身份/规则
    expect(calls[1]!.input).toContain('## Continuation');
    expect(calls[1]!.input).not.toContain('## Base Identity');
    expect(calls[1]!.input).not.toContain('## Game Rules');
  });

  it('resume 传输失败时回退为新会话 + 完整 prompt', async () => {
    const calls: { args: string[]; input: string }[] = [];
    const runner = vi.fn(async (_bin: string, args: string[], input: string) => {
      calls.push({ args: [...args], input });
      // resume 调用抛传输错误
      if (args.includes('--resume')) {
        throw new Error('claude 退出码 1: session not found');
      }
      return CLAUDE_OK;
    });
    const provider = new ClaudeCodeProvider(profile, { runner, retries: 1 });

    // 第一轮正常
    await provider.decide(makeContext());
    // 第二轮 resume 失败 → 回退新会话
    await provider.decide(makeContext());

    // 第 2 次 decide 产生了 2 次 runner 调用（resume 失败 + 新会话）
    expect(calls.length).toBeGreaterThanOrEqual(3);
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall.args).toContain('--session-id');
    expect(lastCall.args).not.toContain('--resume');
    expect(lastCall.input).toContain('## Base Identity');
    // 新会话 ID 不同于第一轮
    const firstId = calls[0]!.args[calls[0]!.args.indexOf('--session-id') + 1];
    const fallbackId = lastCall.args[lastCall.args.indexOf('--session-id') + 1];
    expect(fallbackId).not.toBe(firstId);
  });

  it('stop() 后重置会话，下轮重新建会话', async () => {
    const calls: { args: string[] }[] = [];
    const provider = new ClaudeCodeProvider(profile, {
      runner: vi.fn(async (_bin, args) => {
        calls.push({ args: [...args] });
        return CLAUDE_OK;
      }),
    });
    await provider.decide(makeContext());
    await provider.stop();
    await provider.decide(makeContext());

    expect(calls).toHaveLength(2);
    // 两次都是 --session-id（stop 后没有 --resume）
    expect(calls[0]!.args).toContain('--session-id');
    expect(calls[1]!.args).toContain('--session-id');
    expect(calls[1]!.args).not.toContain('--resume');
  });

  it('模型返回非法动作时不重置会话', async () => {
    const calls: { args: string[] }[] = [];
    let callCount = 0;
    const provider = new ClaudeCodeProvider(profile, {
      retries: 0,
      runner: vi.fn(async (_bin, args) => {
        calls.push({ args: [...args] });
        callCount++;
        // 第一次返回非法动作，第二次返回合法
        if (callCount === 1) {
          return JSON.stringify({
            result: JSON.stringify({ action: { t: 'bid', score: 99 } }),
          });
        }
        return CLAUDE_OK;
      }),
    });
    // retries=0 时非法动作直接抛错
    await expect(provider.decide(makeContext())).rejects.toThrow();
    // 下一次 decide 仍应用 --resume（会话未被重置）
    await provider.decide(makeContext());
    expect(calls[1]!.args).toContain('--resume');
  });
});

// ---------------------------------------------------------------------------
// CodexProvider
// ---------------------------------------------------------------------------

describe('CodexProvider 会话管理', () => {
  it('首轮用 exec --json 建会话并捕获 thread_id', async () => {
    const calls: { args: string[]; input: string }[] = [];
    const provider = new CodexProvider(profile, {
      runner: vi.fn(async (_bin, args, input) => {
        calls.push({ args: [...args], input });
        return CODEX_OK('thread-abc-123');
      }),
    });
    const decision = await provider.decide(makeContext());

    expect(decision.action).toEqual({ t: 'pass' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(calls[0]!.input).toContain('## Base Identity');
  });

  it('后续轮用 exec resume 同一 thread_id', async () => {
    const calls: { args: string[]; input: string }[] = [];
    const provider = new CodexProvider(profile, {
      runner: vi.fn(async (_bin, args, input) => {
        calls.push({ args: [...args], input });
        return CODEX_OK('thread-abc-123');
      }),
    });
    await provider.decide(makeContext());
    await provider.decide(makeContext());

    expect(calls).toHaveLength(2);
    const args2 = calls[1]!.args;
    expect(args2.slice(0, 5)).toEqual(['exec', 'resume', 'thread-abc-123', '-', '--json']);
    expect(calls[1]!.input).toContain('## Continuation');
    expect(calls[1]!.input).not.toContain('## Base Identity');
  });

  it('turn.failed 事件抛错', async () => {
    const provider = new CodexProvider(profile, {
      retries: 0,
      runner: vi.fn(async () =>
        [
          JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
          JSON.stringify({
            type: 'turn.failed',
            error: { message: 'model overloaded' },
          }),
        ].join('\n'),
      ),
    });
    await expect(provider.decide(makeContext())).rejects.toThrow('turn.failed');
  });

  it('无 agent_message 时抛错', async () => {
    const provider = new CodexProvider(profile, {
      retries: 0,
      runner: vi.fn(async () =>
        JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      ),
    });
    await expect(provider.decide(makeContext())).rejects.toThrow('未找到 agent_message');
  });

  it('resume 传输失败时回退为新会话', async () => {
    const calls: { args: string[]; input: string }[] = [];
    const runner = vi.fn(async (_bin: string, args: string[], input: string) => {
      calls.push({ args: [...args], input });
      if (args.includes('resume')) {
        throw new Error('codex 退出码 1: thread not found');
      }
      return CODEX_OK('new-thread-456');
    });
    const provider = new CodexProvider(profile, { runner, retries: 1 });

    await provider.decide(makeContext());
    await provider.decide(makeContext());

    const lastCall = calls[calls.length - 1]!;
    expect(lastCall.args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(lastCall.input).toContain('## Base Identity');
  });

  it('stop() 后重置会话', async () => {
    const calls: { args: string[] }[] = [];
    const provider = new CodexProvider(profile, {
      runner: vi.fn(async (_bin, args) => {
        calls.push({ args: [...args] });
        return CODEX_OK('t1');
      }),
    });
    await provider.decide(makeContext());
    await provider.stop();
    await provider.decide(makeContext());

    expect(calls).toHaveLength(2);
    // 两次都是 exec --json（没有 resume）
    expect(calls[0]!.args.slice(0, 2)).toEqual(['exec', '--json']);
    expect(calls[1]!.args.slice(0, 2)).toEqual(['exec', '--json']);
  });
});
