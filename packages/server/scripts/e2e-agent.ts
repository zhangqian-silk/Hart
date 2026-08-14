/**
 * AI 座位 E2E：人类房主 + 1 个 scripted AI 下五子棋，验证 AI 自动落子、游戏结束。
 * 用法：先启动 server（pnpm --filter @hart/server start），再 `tsx packages/server/scripts/e2e-agent.ts`
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

  waitFor(pred: (m: ServerMsg) => boolean, timeout = 15000): Promise<ServerMsg> {
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
  const human = new Bot('人类');
  await human.ready();
  console.log('人类玩家:', human.id);

  // 创建五子棋房间
  human.send({ t: 'room.create', game: 'wuziqi' });
  await human.waitFor((m) => m.t === 'room.state' && m.room.status === 'waiting');
  const code = human.room!.code;
  console.log('房间创建:', code);

  // 添加 AI 到座位 1
  human.send({ t: 'room.add_agent', seat: 1, profileId: 'sherlock' });
  await human.waitFor(
    (m) => m.t === 'room.state' && m.room.seats.some((s) => s.agent !== undefined),
  );
  const agentSeat = human.room!.seats.find((s) => s.agent);
  console.log('AI 已添加:', agentSeat?.agent?.profileName, '(' + agentSeat?.agent?.kind + ')');

  // 开始游戏
  human.send({ t: 'room.start' });
  await human.waitFor((m) => m.t === 'room.state' && m.room.status === 'playing');
  console.log('对局开始');

  // 人类（黑）和 AI（白）轮流下棋，直到结束
  let moves = 0;
  while (human.room?.status === 'playing' && moves < 225) {
    const active = human.room.gameState?.turn.active ?? [];
    if (active.includes(human.id)) {
      // 人类下一个合法位置
      const view = human.room.gameState?.view as { board: number[][]; current: string };
      const board = view.board;
      let placed = false;
      for (let r = 0; r < 15 && !placed; r++) {
        for (let c = 0; c < 15 && !placed; c++) {
          if (board[r]![c] === 0) {
            human.send({ t: 'game.action', action: { t: 'place', row: r, col: c } });
            placed = true;
            moves++;
          }
        }
      }
      // 等待 AI 回合或游戏结束
      await human.waitFor(
        (m) =>
          m.t === 'room.state' &&
          (m.room.status === 'finished' ||
            (m.room.status === 'playing' &&
              (m.room.gameState?.turn.active.includes(human.id) ?? false))),
        30000,
      );
    } else {
      // 等待 AI 行动
      await human.waitFor(
        (m) =>
          m.t === 'room.state' &&
          (m.room.status === 'finished' ||
            (m.room.status === 'playing' &&
              (m.room.gameState?.turn.active.includes(human.id) ?? false))),
        30000,
      );
    }
  }

  const status = human.room?.status;
  const winners = human.room?.gameState?.result?.winners;
  console.log('对局结束:', status, '胜者:', winners);
  if (status !== 'finished' || !winners || winners.length === 0) {
    console.error('❌ AI E2E 失败：游戏未正常结束');
    process.exit(1);
  }
  console.log('✅ AI E2E 通过：人类 + AI 五子棋对局完成');
  human.close();

  // 场景 2：全 AI 斗地主（房主 + 2 个 AI，全自动跑完整局，验证多 Agent 驱动）
  await autonomousDoudizhu();

  process.exit(0);
}

/** 房主坐 1 席，另加 2 个 AI，房主准备并开局；对局应全程由 AI 驱动跑到终局。 */
async function autonomousDoudizhu(): Promise<void> {
  const host = new Bot('房主');
  await host.ready();
  host.send({ t: 'room.create', game: 'doudizhu' });
  await host.waitFor((m) => m.t === 'room.state' && m.room.status === 'waiting');
  const code = host.room!.code;
  console.log('\n[全AI斗地主] 房间创建:', code);

  // 房主在 0 席，另加 2 个 AI 填满 1、2 席
  host.send({ t: 'room.add_agent', seat: 1, profileId: 'ddz-master', providerKind: 'scripted' });
  await host.waitFor((m) => m.t === 'room.state' && !!m.room.seats[1]?.agent);
  host.send({ t: 'room.add_agent', seat: 2, profileId: 'loki', providerKind: 'scripted' });
  await host.waitFor((m) => m.t === 'room.state' && !!m.room.seats[2]?.agent);
  console.log('[全AI斗地主] 已添加 2 个 AI');

  host.send({ t: 'room.start' });
  await host.waitFor((m) => m.t === 'room.state' && m.room.status === 'playing');
  console.log('[全AI斗地主] 对局开始');

  // 房主用最保守但始终合法的策略应对，让对局能推进到终局：
  // - 叫分：投 0（不叫）
  // - 出牌：若非首出则 pass；若首出（lead===null）则出最小的单张（始终合法）
  let guard = 0;
  while (host.room?.status === 'playing' && guard < 600) {
    guard++;
    const active = host.room.gameState?.turn.active ?? [];
    if (active.includes(host.id)) {
      const view = host.room.gameState?.view as {
        phase: string;
        lead: unknown | null;
        yourHand: { rank: number; suit: string }[];
      };
      if (view.phase === 'bidding') {
        host.send({ t: 'game.action', action: { t: 'bid', score: 0 } });
      } else if (view.lead === null) {
        // 首出：出最小单张
        const lowest = [...view.yourHand].sort((a, b) => a.rank - b.rank)[0];
        host.send({ t: 'game.action', action: { t: 'play', cards: [lowest] } });
      } else {
        host.send({ t: 'game.action', action: { t: 'pass' } });
      }
      await host
        .waitFor(
          (m) =>
            m.t === 'room.state' &&
            (m.room.status === 'finished' ||
              !(m.room.gameState?.turn.active.includes(host.id) ?? false)),
          30000,
        )
        .catch(() => undefined);
    } else {
      await host
        .waitFor(
          (m) =>
            m.t === 'room.state' &&
            (m.room.status === 'finished' ||
              (m.room.gameState?.turn.active.includes(host.id) ?? false)),
          30000,
        )
        .catch(() => undefined);
    }
  }

  const status = host.room?.status;
  console.log('[全AI斗地主] 结束状态:', status, '胜者:', host.room?.gameState?.result?.winners);
  if (status !== 'finished') {
    console.error('❌ 全AI斗地主 E2E 失败：未在步数内结束');
    process.exit(1);
  }
  console.log('✅ 全AI斗地主 E2E 通过：多 Agent 座位自动驱动完成对局');
  host.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
