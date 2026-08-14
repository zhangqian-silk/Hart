import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BUILTIN_PROFILES } from '../profiles.js';
import { HttpProvider } from './http.js';
import type { AgentContext } from '../types.js';

function makeContext(actions: unknown[]): AgentContext {
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

describe('HttpProvider', () => {
  let server: Server;
  let url: string;
  let handler: (reqBody: string) => { status: number; body: string };

  beforeAll(() => {
    handler = () => ({ status: 200, body: '{}' });
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const r = handler(body);
        res.writeHead(r.status, { 'Content-Type': 'application/json' });
        res.end(r.body);
      });
    });
    server.listen(0);
    const addr = server.address() as AddressInfo;
    url = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => server.close());

  it('正常返回合法动作', async () => {
    handler = () => ({
      status: 200,
      body: JSON.stringify({ action: { t: 'place', row: 7, col: 7 }, reasoning: '占中心' }),
    });
    const provider = new HttpProvider(BUILTIN_PROFILES[0]!, { url, retries: 0 });
    const decision = await provider.decide(
      makeContext([{ t: 'place', row: 7, col: 7 }]),
    );
    expect(decision.action).toEqual({ t: 'place', row: 7, col: 7 });
    expect(decision.reasoning).toBe('占中心');
  });

  it('解析 markdown 代码块包裹的响应', async () => {
    handler = () => ({
      status: 200,
      body: '```json\n{"action":{"t":"pass"}}\n```',
    });
    const provider = new HttpProvider(BUILTIN_PROFILES[0]!, { url, retries: 0 });
    const decision = await provider.decide(makeContext([{ t: 'pass' }]));
    expect(decision.action).toEqual({ t: 'pass' });
  });

  it('非法动作抛错', async () => {
    handler = () => ({
      status: 200,
      body: JSON.stringify({ action: { t: 'bid', score: 3 } }),
    });
    const provider = new HttpProvider(BUILTIN_PROFILES[0]!, { url, retries: 0 });
    await expect(provider.decide(makeContext([{ t: 'pass' }]))).rejects.toThrow();
  });

  it('500 错误重试后抛错', async () => {
    handler = () => ({ status: 500, body: 'error' });
    const provider = new HttpProvider(BUILTIN_PROFILES[0]!, { url, retries: 1 });
    await expect(provider.decide(makeContext([{ t: 'pass' }]))).rejects.toThrow(/HTTP 500/);
  });

  it('请求体是 Agent Protocol 格式', async () => {
    let received = '';
    handler = (body) => {
      received = body;
      return { status: 200, body: JSON.stringify({ action: { t: 'pass' } }) };
    };
    const provider = new HttpProvider(BUILTIN_PROFILES[0]!, { url, retries: 0 });
    await provider.decide(makeContext([{ t: 'pass' }]));
    const req = JSON.parse(received);
    expect(req.game).toBe('wuziqi');
    expect(req.role).toBe('black');
    expect(req.actions).toEqual([{ t: 'pass' }]);
    expect(req.visibleState).toBeDefined();
  });
});
