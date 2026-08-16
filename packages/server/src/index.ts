import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { listGames, type ClientMsg } from '@hart/common';
import { listAgentConfigs, listBuiltinDefaults, saveAgentConfigs } from './agent-store.js';
import { checkProvider } from './provider-check.js';
import {
  getSystemConfig,
  saveSystemConfig,
  updateProviderMeta,
  metaStale,
  type SystemConfig,
} from './system-store.js';
import { fetchProviderMeta } from './provider-meta.js';
import { Room, genCode } from './room.js';
import { Session } from './session.js';

// 注册游戏（各游戏在 common/games 中自注册，import 触发副作用）
import '@hart/common/games';

const PORT = Number(process.env.PORT ?? 8787);

// 生产静态资源目录：优先环境变量，其次默认指向 client 构建产物
const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST =
  process.env.CLIENT_DIST ?? join(here, '..', '..', 'client', 'dist');
const SERVE_STATIC = existsSync(join(CLIENT_DIST, 'index.html'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 提供构建后的前端静态资源（SPA：未命中文件回退 index.html） */
async function serveStatic(reqUrl: string, res: import('node:http').ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent(reqUrl.split('?')[0] ?? '/');
  // 防目录穿越：规范化后必须仍在 dist 内
  const rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(CLIENT_DIST, rel === '/' ? 'index.html' : rel);
  if (!filePath.startsWith(CLIENT_DIST)) filePath = join(CLIENT_DIST, 'index.html');
  if (!existsSync(filePath) || extname(filePath) === '') {
    filePath = join(CLIENT_DIST, 'index.html'); // SPA 回退
  }
  try {
    const body = await readFile(filePath);
    res.setHeader('content-type', MIME[extname(filePath)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
}

const rooms = new Map<string, Room>();

/** 读取 JSON 请求体（上限 1MB） */
function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : null);
      } catch (e) {
        reject(e instanceof Error ? e : new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/** 只保留 provider 的可编辑字段（binPath/defaultModel/defaultEffort），meta 不允许直接写 */
function sanitizeProviderFields(p: unknown): { binPath?: string; defaultModel?: string; defaultEffort?: string } {
  const o = (p ?? {}) as Record<string, unknown>;
  return {
    ...(typeof o.binPath === 'string' ? { binPath: o.binPath } : {}),
    ...(typeof o.defaultModel === 'string' ? { defaultModel: o.defaultModel } : {}),
    ...(typeof o.defaultEffort === 'string' ? { defaultEffort: o.defaultEffort } : {}),
  };
}

const http = createServer(async (req, res) => {
  const url = req.url ?? '/';
  const path = url.split('?')[0] ?? '/';

  if (path === '/api/games' && req.method === 'GET') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(listGames()));
    return;
  }
  // 健康检查
  if (path === '/healthz') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  // Agent 配置：列表 / 内置默认 / 全量保存
  if (path === '/api/agents' && req.method === 'GET') {
    sendJson(res, 200, listAgentConfigs());
    return;
  }
  if (path === '/api/agents/defaults' && req.method === 'GET') {
    sendJson(res, 200, listBuiltinDefaults());
    return;
  }
  if (path === '/api/agents' && req.method === 'PUT') {
    try {
      const body = await readBody(req);
      if (!Array.isArray(body)) {
        sendJson(res, 400, { error: '请求体应为 Agent 配置数组' });
        return;
      }
      saveAgentConfigs(body as never);
      sendJson(res, 200, listAgentConfigs());
    } catch (e) {
      sendJson(res, 400, { error: e instanceof Error ? e.message : '保存失败' });
    }
    return;
  }
  // 检测 provider 配置是否可用（CLI 是否存在、URL 是否可达）
  if (path === '/api/agents/check-provider' && req.method === 'POST') {
    try {
      const body = (await readBody(req)) as { kind?: string; binPath?: string; url?: string } | null;
      if (!body || typeof body.kind !== 'string') {
        sendJson(res, 400, { error: '请求体应包含 kind 字段' });
        return;
      }
      const result = await checkProvider({
        kind: body.kind,
        binPath: typeof body.binPath === 'string' ? body.binPath : undefined,
        url: typeof body.url === 'string' ? body.url : undefined,
      });
      sendJson(res, 200, result);
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : '检测失败' });
    }
    return;
  }
  // 系统配置：读取
  if (path === '/api/system' && req.method === 'GET') {
    sendJson(res, 200, getSystemConfig());
    return;
  }
  // 系统配置：保存（主题、默认模型/effort、binPath）
  if (path === '/api/system' && req.method === 'PUT') {
    try {
      const body = (await readBody(req)) as Partial<SystemConfig> | null;
      if (!body || typeof body !== 'object') {
        sendJson(res, 400, { error: '请求体应为系统配置对象' });
        return;
      }
      const current = getSystemConfig();
      const merged: SystemConfig = {
        theme: body.theme === 'light' ? 'light' : body.theme === 'dark' ? 'dark' : current.theme,
        providers: {
          'claude-code': {
            ...current.providers['claude-code'],
            ...sanitizeProviderFields(body.providers?.['claude-code']),
          },
          'codex': {
            ...current.providers['codex'],
            ...sanitizeProviderFields(body.providers?.['codex']),
          },
          'http': {
            url: typeof body.providers?.http?.url === 'string' ? body.providers.http.url : current.providers.http.url,
          },
        },
      };
      saveSystemConfig(merged);
      sendJson(res, 200, merged);
    } catch (e) {
      sendJson(res, 400, { error: e instanceof Error ? e.message : '保存失败' });
    }
    return;
  }
  // 刷新 provider 元数据（版本、模型、effort 列表），body: { kind?: 'claude-code'|'codex' }
  if (path === '/api/system/refresh-meta' && req.method === 'POST') {
    try {
      const body = (await readBody(req)) as { kind?: string } | null;
      const kinds: ('claude-code' | 'codex')[] =
        body?.kind === 'claude-code' || body?.kind === 'codex'
          ? [body.kind]
          : ['claude-code', 'codex'];
      const config = getSystemConfig();
      const results: Record<string, { ok: boolean; error?: string }> = {};
      for (const kind of kinds) {
        const meta = await fetchProviderMeta(kind, config.providers[kind].binPath);
        updateProviderMeta(kind, meta);
        results[kind] = { ok: !meta.error, ...(meta.error ? { error: meta.error } : {}) };
      }
      sendJson(res, 200, { results, config: getSystemConfig() });
    } catch (e) {
      sendJson(res, 500, { error: e instanceof Error ? e.message : '刷新失败' });
    }
    return;
  }
  // 生产：提供前端静态资源
  if (SERVE_STATIC && req.method === 'GET') {
    void serveStatic(url, res);
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws) => {
  const session = new Session(ws);

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handle(session, msg);
  });

  ws.on('close', () => {
    session.online = false;
    if (session.room) {
      const room = session.room;
      room.leave(session);
      if (room.members().length === 0 && room.status !== 'playing') {
        rooms.delete(room.code);
      }
    }
  });
});

function handle(s: Session, msg: ClientMsg): void {
  switch (msg.t) {
    case 'hello':
      s.name = msg.name.slice(0, 20) || `玩家${s.id}`;
      s.send({ t: 'welcome', you: s.id, name: s.name });
      s.send({ t: 'agent.profiles', profiles: listAgentConfigs() });
      break;
    case 'room.create': {
      if (s.room) s.room.leave(s);
      const code = genCode((c) => rooms.has(c));
      const room = new Room(code, msg.game, s);
      rooms.set(code, room);
      room.sit(s, 0);
      room.addChat(s, `${s.name} 创建了房间`, true);
      break;
    }
    case 'room.join': {
      const room = rooms.get(msg.code.toUpperCase());
      if (!room) return s.send({ t: 'error', message: '房间不存在' });
      if (s.room) s.room.leave(s);
      const empty = room.seats.findIndex((x) => !x);
      if (empty < 0) return s.send({ t: 'error', message: '房间已满' });
      room.sit(s, empty);
      room.addChat(s, `${s.name} 加入了房间`, true);
      break;
    }
    case 'room.leave':
      if (s.room) {
        const room = s.room;
        room.leave(s);
        if (room.members().length === 0) rooms.delete(room.code);
        s.room = undefined;
      }
      break;
    case 'room.sit':
      if (s.room) {
        const err = s.room.sit(s, msg.seat);
        if (err) s.send({ t: 'error', message: err });
      }
      break;
    case 'room.stand':
      s.room?.stand(s);
      break;
    case 'room.ready':
      s.room?.setReady(s, msg.ready);
      break;
    case 'room.chat':
      if (s.room && msg.text.trim()) {
        s.room.addChat(s, msg.text.trim().slice(0, 500));
      }
      break;
    case 'room.options':
      if (s.room) {
        const err = s.room.setOptions(s, msg.options);
        if (err) s.send({ t: 'error', message: err });
      }
      break;
    case 'room.start':
      if (s.room) {
        const err = s.room.start(s);
        if (err) s.send({ t: 'error', message: err });
      }
      break;
    case 'game.action':
      if (s.room) {
        const err = s.room.action(s, msg.action);
        if (err) s.send({ t: 'error', message: err });
      }
      break;
    case 'room.add_agent':
      if (s.room) {
        const err = s.room.addAgent(s, msg.seat, msg.profileId, msg.providerKind);
        if (err) s.send({ t: 'error', message: err });
      }
      break;
    case 'room.remove_agent':
      if (s.room) {
        const err = s.room.removeAgent(s, msg.seat);
        if (err) s.send({ t: 'error', message: err });
      }
      break;
  }
}

http.listen(PORT, () => {
  console.log(`Hart server listening on http://localhost:${PORT}`);
  console.log(`games: ${listGames().map((g) => g.id).join(', ')}`);
});
