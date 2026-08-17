import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_PROFILES } from '../profiles.js';
import { OpenAiProvider } from './openai.js';
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

describe('OpenAiProvider', () => {
  it('携带 Bearer apiKey/baseUrl/model 调用 Chat Completions API', async () => {
    const { fetchImpl, calls } = mockFetch({
      body: { choices: [{ message: { content: OK_REPLY } }] },
    });
    const provider = new OpenAiProvider(profile, {
      apiKey: 'sk-test-123',
      baseUrl: 'https://gw.example.com/',
      model: 'gpt-5',
      fetchImpl,
    });
    await provider.start();
    const decision = await provider.decide(makeContext());

    expect(decision.action).toEqual({ t: 'pass' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://gw.example.com/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-test-123');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.model).toBe('gpt-5');
    // system 消息携带静态身份/规则，user 消息携带本轮观察
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[0]!.content).toContain('AI 玩家');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]!.role).toBe('user');
    expect(body.messages[1]!.content).toContain('Observation');
  });

  it('fresh 模式（默认）：多轮决策不累积历史', async () => {
    const { fetchImpl, calls } = mockFetch({
      body: { choices: [{ message: { content: OK_REPLY } }] },
    });
    const provider = new OpenAiProvider(profile, {
      apiKey: 'sk-test',
      model: 'gpt-5',
      fetchImpl,
    });
    await provider.start();
    await provider.decide(makeContext());
    await provider.decide(makeContext([{ t: 'pass' }, { t: 'resign' }]));

    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const body = JSON.parse(c.init.body as string);
      expect(body.messages).toHaveLength(2); // system + 当前 user
    }
  });

  it('会话续接（sessionMode=resume）：第二轮携带首轮问答历史', async () => {
    const { fetchImpl, calls } = mockFetch({
      body: { choices: [{ message: { content: OK_REPLY } }] },
    });
    const provider = new OpenAiProvider(profile, {
      apiKey: 'sk-test',
      model: 'gpt-5',
      sessionMode: 'resume',
      fetchImpl,
    });
    await provider.start();
    await provider.decide(makeContext());
    await provider.decide(makeContext());

    expect(calls).toHaveLength(2);
    const second = JSON.parse(calls[1]!.init.body as string);
    expect(second.messages).toHaveLength(4); // system + user(首轮) + assistant + user(次轮)
    expect(second.messages[2]!.role).toBe('assistant');
    expect(second.messages[2]!.content).toBe(OK_REPLY);
  });

  it('effort=low/medium/high 映射为 reasoning_effort', async () => {
    const { fetchImpl, calls } = mockFetch({
      body: { choices: [{ message: { content: OK_REPLY } }] },
    });
    const provider = new OpenAiProvider(profile, {
      apiKey: 'sk-test',
      model: 'gpt-5',
      effort: 'medium',
      fetchImpl,
    });
    await provider.start();
    await provider.decide(makeContext());

    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.reasoning_effort).toBe('medium');
  });

  it("effort='off' 时不发送 reasoning_effort", async () => {
    const { fetchImpl, calls } = mockFetch({
      body: { choices: [{ message: { content: OK_REPLY } }] },
    });
    const provider = new OpenAiProvider(profile, {
      apiKey: 'sk-test',
      model: 'gpt-5',
      effort: 'off',
      fetchImpl,
    });
    await provider.start();
    await provider.decide(makeContext());

    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('网关拒绝 reasoning_effort 时降级重试', async () => {
    let n = 0;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => {
        n++;
        if (n === 1) {
          return new Response(
            JSON.stringify({ error: { message: 'Unsupported reasoning_effort' } }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({ choices: [{ message: { content: OK_REPLY } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );
    const provider = new OpenAiProvider(profile, {
      apiKey: 'sk-test',
      model: 'gpt-5',
      effort: 'low',
      retries: 0,
      fetchImpl,
    });
    await provider.start();
    const decision = await provider.decide(makeContext());
    expect(decision.action).toEqual({ t: 'pass' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(first.reasoning_effort).toBe('low');
    const second = JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string);
    expect(second.reasoning_effort).toBeUndefined();
  });

  it('API 错误时抛出含详情的异常', async () => {
    const { fetchImpl } = mockFetch({
      status: 401,
      body: { error: { message: 'invalid api key' } },
    });
    const provider = new OpenAiProvider(profile, {
      apiKey: 'sk-bad',
      model: 'gpt-5',
      retries: 0,
      fetchImpl,
    });
    await provider.start();
    await expect(provider.decide(makeContext())).rejects.toThrow(/invalid api key/);
  });

  it('输出不是合法决策时抛错', async () => {
    const { fetchImpl } = mockFetch({
      body: { choices: [{ message: { content: '我觉得随便走走' } }] },
    });
    const provider = new OpenAiProvider(profile, {
      apiKey: 'sk-test',
      model: 'gpt-5',
      retries: 0,
      fetchImpl,
    });
    await provider.start();
    await expect(provider.decide(makeContext())).rejects.toThrow(/action/);
  });
});
