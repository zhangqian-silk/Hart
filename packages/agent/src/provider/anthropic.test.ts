import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROFILES } from '../profiles.js';
import { AnthropicProvider } from './anthropic.js';
import { ClaudeCodeProvider } from './cli.js';
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

const OK_REPLY = JSON.stringify({ action: { t: 'pass' }, reasoning: 'ok' });

function mockFetch(response: { status?: number; body: unknown }): {
  fetchImpl: ReturnType<typeof vi.fn>;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fetchImpl, calls };
}

describe('AnthropicProvider', () => {
  it('携带 apiKey/baseUrl/model 调用 Messages API', async () => {
    const { fetchImpl, calls } = mockFetch({
      body: { content: [{ type: 'text', text: OK_REPLY }] },
    });
    const provider = new AnthropicProvider(profile, {
      apiKey: 'sk-test-123',
      baseUrl: 'https://gw.example.com/',
      model: 'claude-sonnet-5',
      fetchImpl,
    });
    await provider.start();
    const decision = await provider.decide(makeContext());

    expect(decision.action).toEqual({ t: 'pass' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://gw.example.com/v1/messages');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test-123');
    expect(headers['anthropic-version']).toBeTruthy();
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]!.role).toBe('user');
    expect(body.messages[0]!.content).toContain('AI 玩家');
  });

  it('会话续接：第二轮携带首轮问答历史', async () => {
    const { fetchImpl, calls } = mockFetch({
      body: { content: [{ type: 'text', text: OK_REPLY }] },
    });
    const provider = new AnthropicProvider(profile, {
      apiKey: 'sk-test',
      model: 'claude-sonnet-5',
      fetchImpl,
    });
    await provider.start();
    await provider.decide(makeContext());
    await provider.decide(makeContext([{ t: 'pass' }, { t: 'resign' }]));

    expect(calls).toHaveLength(2);
    const second = JSON.parse(calls[1]!.init.body as string);
    expect(second.messages).toHaveLength(3); // user(首轮) + assistant + user(次轮)
    expect(second.messages[0]!.role).toBe('user');
    expect(second.messages[1]!.role).toBe('assistant');
    expect(second.messages[1]!.content).toBe(OK_REPLY);
  });

  it('effort 映射为 thinking 预算；被拒绝时降级重试', async () => {
    let n = 0;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => {
        n++;
        if (n === 1) {
          return new Response(
            JSON.stringify({ error: { message: 'thinking is not supported' } }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ content: [{ type: 'text', text: OK_REPLY }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    const provider = new AnthropicProvider(profile, {
      apiKey: 'sk-test',
      model: 'claude-sonnet-5',
      effort: 'high',
      retries: 0,
      fetchImpl,
    });
    await provider.start();
    const decision = await provider.decide(makeContext());
    expect(decision.action).toEqual({ t: 'pass' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(first.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
    const second = JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string);
    expect(second.thinking).toBeUndefined();
  });

  it('API 错误时抛出含详情的异常', async () => {
    const { fetchImpl } = mockFetch({
      status: 401,
      body: { error: { message: 'invalid x-api-key' } },
    });
    const provider = new AnthropicProvider(profile, {
      apiKey: 'sk-bad',
      model: 'claude-sonnet-5',
      retries: 0,
      fetchImpl,
    });
    await provider.start();
    await expect(provider.decide(makeContext())).rejects.toThrow(/invalid x-api-key/);
  });

  it('输出不是合法决策时抛错', async () => {
    const { fetchImpl } = mockFetch({
      body: { content: [{ type: 'text', text: '我觉得随便走走' }] },
    });
    const provider = new AnthropicProvider(profile, {
      apiKey: 'sk-test',
      model: 'claude-sonnet-5',
      retries: 0,
      fetchImpl,
    });
    await provider.start();
    await expect(provider.decide(makeContext())).rejects.toThrow(/action/);
  });
});

describe('CLI Provider 凭据注入', () => {
  it('ClaudeCodeProvider 把 apiKey/baseUrl/configDir 注入子进程 env', async () => {
    const envs: (Record<string, string> | undefined)[] = [];
    const provider = new ClaudeCodeProvider(profile, {
      model: 'opus',
      apiKey: 'sk-abc',
      baseUrl: 'https://gw.example.com',
      configDir: '/tmp/hart-acct-1',
      runner: vi.fn(async (_b, _a, _i, _t, env) => {
        envs.push(env);
        return JSON.stringify({ result: OK_REPLY });
      }),
    });
    await provider.decide(makeContext());
    expect(envs[0]).toMatchObject({
      ANTHROPIC_API_KEY: 'sk-abc',
      ANTHROPIC_BASE_URL: 'https://gw.example.com',
      CLAUDE_CONFIG_DIR: '/tmp/hart-acct-1',
    });
  });
});
