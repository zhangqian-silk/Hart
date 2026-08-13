import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { listGames, type ClientMsg } from '@hart/common';
import { Room, genCode } from './room.js';
import { Session } from './session.js';

// 注册游戏（各游戏在 common/games 中自注册，import 触发副作用）
import '@hart/common/games';

const PORT = Number(process.env.PORT ?? 8787);

const rooms = new Map<string, Room>();

const http = createServer((req, res) => {
  if (req.url === '/api/games') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(listGames()));
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
  }
}

http.listen(PORT, () => {
  console.log(`Hart server listening on http://localhost:${PORT}`);
  console.log(`games: ${listGames().map((g) => g.id).join(', ')}`);
});
