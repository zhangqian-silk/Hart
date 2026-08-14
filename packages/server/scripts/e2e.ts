/**
 * E2E 冒烟脚本：用 ws 客户端模拟多名玩家，创建房间→入座→准备→开始→下棋→结束。
 * 用法：先启动 server（pnpm --filter @hart/server start），再 `tsx packages/server/scripts/e2e.ts`
 */
import WebSocket from 'ws';
import type { ClientMsg, RoomView, ServerMsg } from '@hart/common';

const URL = process.env.WS_URL ?? 'ws://localhost:8787/ws';

class Bot {
  ws: WebSocket;
  name: string;
  id = '';
  room: RoomView | null = null;
  private waiters: ((m: ServerMsg) => void)[] = [];

  constructor(name: string) {
    this.name = name;
    this.ws = new WebSocket(URL);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as ServerMsg;
      if (msg.t === 'room.state') this.room = msg.room;
      for (const w of this.waiters) w(msg);
    });
  }

  send(msg: ClientMsg) {
    this.ws.send(JSON.stringify(msg));
  }

  async ready(): Promise<void> {
    await new Promise<void>((res) => {
      if (this.ws.readyState === WebSocket.OPEN) return res();
      this.ws.on('open', () => res());
    });
    this.send({ t: 'hello', name: this.name });
    const welcome = await this.waitFor((m) => m.t === 'welcome');
    if (welcome.t === 'welcome') this.id = welcome.you;
  }

  waitFor(pred: (m: ServerMsg) => boolean, timeout = 5000): Promise<ServerMsg> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== onMsg);
        reject(new Error(`timeout waiting for message (${this.name})`));
      }, timeout);
      const onMsg = (m: ServerMsg) => {
        if (pred(m)) {
          clearTimeout(t);
          this.waiters = this.waiters.filter((w) => w !== onMsg);
          resolve(m);
        }
      };
      this.waiters.push(onMsg);
    });
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  const a = new Bot('甲');
  const b = new Bot('乙');
  await a.ready();
  await b.ready();
  const aid = a.id;
  const bid = b.id;
  console.log('玩家:', aid, bid);

  // 甲创建五子棋房间
  a.send({ t: 'room.create', game: 'wuziqi' });
  await a.waitFor((m) => m.t === 'room.state' && m.room.status === 'waiting');
  const code = a.room!.code;
  console.log('房间创建:', code);

  // 乙加入
  b.send({ t: 'room.join', code });
  await b.waitFor((m) => m.t === 'room.state' && m.room.seats.some((s) => s.player?.name === '乙'));
  console.log('乙加入房间');

  // 乙准备
  b.send({ t: 'room.ready', ready: true });
  await b.waitFor(
    (m) => m.t === 'room.state' && m.room.seats.some((s) => s.player?.name === '乙' && s.ready),
  );

  // 甲开始
  a.send({ t: 'room.start' });
  await a.waitFor((m) => m.t === 'room.state' && m.room.status === 'playing');
  console.log('对局开始');

  // 甲（黑）下五连，乙（白）应
  const aMoves: [number, number][] = [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]];
  const bMoves: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 3]];
  for (let i = 0; i < 4; i++) {
    a.send({ t: 'game.action', action: { t: 'place', row: aMoves[i]![0], col: aMoves[i]![1] } });
    await b.waitFor((m) => m.t === 'room.state' && m.room.gameState?.turn.active.includes(bid));
    b.send({ t: 'game.action', action: { t: 'place', row: bMoves[i]![0], col: bMoves[i]![1] } });
    await a.waitFor((m) => m.t === 'room.state' && m.room.gameState?.turn.active.includes(aid));
  }
  a.send({ t: 'game.action', action: { t: 'place', row: aMoves[4]![0], col: aMoves[4]![1] } });
  const fin = await a.waitFor((m) => m.t === 'room.state' && m.room.status === 'finished');
  const winners = fin.room.gameState?.result?.winners;
  console.log('对局结束，胜者:', winners);
  if (!winners || winners.length !== 1) {
    console.error('❌ E2E 失败：胜者异常');
    process.exit(1);
  }
  console.log('✅ E2E 通过：五子棋完整对局');
  a.close();
  b.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
