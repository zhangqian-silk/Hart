import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { listGames, type ClientMsg } from '@hart/common';
import { BUILTIN_PROFILES } from '@hart/agent';
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

const http = createServer((req, res) => {
  if (req.url === '/api/games') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(listGames()));
    return;
  }
  // 健康检查
  if (req.url === '/healthz') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  // 生产：提供前端静态资源
  if (SERVE_STATIC && req.method === 'GET') {
    void serveStatic(req.url ?? '/', res);
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
      s.send({
        t: 'agent.profiles',
        profiles: BUILTIN_PROFILES.map((p) => ({
          id: p.id,
          name: p.name,
          persona: p.persona,
          strategy: p.strategy,
        })),
      });
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
