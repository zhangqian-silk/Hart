import {
  createLocalHost,
  getGame,
  type GameView,
  type TurnInfo,
} from '@hart/common';
import type {
  GameEvent,
  GameId,
  GameOptions,
  GameResult,
  PlayerId,
  PlayerInfo,
  Rng,
} from '@hart/common';
import { seededRng } from '@hart/common';
import { MemoryStore } from './memory.js';
import { validateDecision } from './protocol.js';
import type {
  AgentContext,
  AgentDecision,
  AgentProfile,
  AgentProvider,
} from './types.js';
// 便于脚本从 host 直接取类型
export type { AgentContext, AgentDecision, AgentProfile, AgentProvider } from './types.js';

/** 从玩家视图中提取角色描述 */
export function roleOf(game: GameId, view: GameView): string {
  switch (game) {
    case 'wuziqi': {
      const v = view as { youAre?: number };
      return v.youAre === 1 ? 'black（黑方）' : v.youAre === 2 ? 'white（白方）' : 'spectator';
    }
    case 'doudizhu': {
      const v = view as { yourRole?: string | null };
      return v.yourRole ?? 'bidder（叫分阶段）';
    }
    case 'yiyelang': {
      const v = view as { myRole?: string };
      return v.myRole ?? 'unknown';
    }
    case 'avalon': {
      const v = view as { yourRole?: string };
      return v.yourRole ?? 'unknown';
    }
  }
}

/** 一个 AI 座位：玩家信息 + 档案 + Provider */
export interface AgentSeat {
  player: PlayerInfo;
  profile: AgentProfile;
  provider: AgentProvider;
}

export interface DecisionRecord {
  player: PlayerId;
  action: unknown;
  reasoning?: string;
  ok: boolean;
  error?: string;
  /** 非法决策时的兜底动作 */
  fallback?: boolean;
}

/** 一局完整对局记录（Replay / 评估用） */
export interface GameTranscript {
  gameId: GameId;
  players: PlayerInfo[];
  startedAt: number;
  durationMs: number;
  events: GameEvent[];
  decisions: DecisionRecord[];
  result: GameResult | null;
  seed: number;
  /** 开局选项（重放时复用） */
  options: GameOptions;
}

export interface PlayOptions {
  /** 非法决策时是否用随机合法动作兜底（默认 true，保证对局能走完） */
  fallback?: boolean;
  /** 最大回合数保护 */
  maxSteps?: number;
  onStep?: (record: DecisionRecord, events: GameEvent[]) => void;
}

/**
 * 用 AI 玩家打完一整局（评估/测试/演示用）。
 * 所有座位都必须是 AgentSeat。
 */
export async function playGame(
  gameId: GameId,
  seats: AgentSeat[],
  options: GameOptions = {},
  rng: Rng = Math.random,
  playOptions: PlayOptions = {},
): Promise<GameTranscript> {
  const startedAt = Date.now();
  // 从入参 rng 派生一个确定性种子，并用它开局，保证对局完全可复现（Event Replay）。
  const seed = (rng() * 0xffffffff) >>> 0;
  const gameRng = seededRng(seed);
  const host = createLocalHost(
    gameId,
    seats.map((s) => s.player),
    options,
    gameRng,
  );
  const def = getGame(gameId);
  const rules = def?.meta.rules ?? '';
  const memories = new Map<PlayerId, MemoryStore>();
  for (const s of seats) memories.set(s.player.id, new MemoryStore(s.profile));

  const events: GameEvent[] = [];
  const decisions: DecisionRecord[] = [];
  const history: GameEvent[] = [];
  const fallback = playOptions.fallback ?? true;
  const maxSteps = playOptions.maxSteps ?? 10000;

  const seatOf = new Map(seats.map((s) => [s.player.id, s]));
  let steps = 0;

  while (!host.result() && steps < maxSteps) {
    const turn = host.turn();
    if (turn.active.length === 0) {
      // 某些阶段（如一夜狼白天讨论）turn.active 为空但玩家仍有合法动作
      // 找到有合法动作的玩家继续
      const withActions = seats.filter((s) => {
        const legal = def?.legalActions
          ? (def.legalActions(host.state, s.player.id) as unknown[])
          : [];
        return legal.length > 0;
      });
      if (withActions.length === 0) break;
      // 让所有有合法动作的玩家行动
      const chosen = await Promise.all(
        withActions.map(async (seat) => {
          const view = host.view(seat.player.id);
          const legal = def?.legalActions
            ? (def.legalActions(host.state, seat.player.id) as unknown[])
            : [];
          const mem = memories.get(seat.player.id)!;
          const ctx: AgentContext = {
            game: gameId,
            you: seat.player.id,
            role: roleOf(gameId, view),
            visibleState: view,
            turn,
            actions: legal,
            history,
            players: seats.map((s) => s.player),
            memory: mem.snapshot(seats.map((s) => s.player)),
          };
          const decision = await seat.provider.decide(ctx);
          return { pid: seat.player.id, decision, legal };
        }),
      );
      for (const { pid, decision, legal } of chosen) {
        const v = validateDecision(decision, legal);
        let action = decision.action;
        let record: DecisionRecord;
        if (!v.ok) {
          if (!fallback) throw new Error(`玩家 ${pid} 非法决策: ${v.error}`);
          action = legal[Math.floor(gameRng() * legal.length)];
          record = {
            player: pid,
            action,
            reasoning: decision.reasoning,
            ok: false,
            error: v.error,
            fallback: true,
          };
        } else {
          record = { player: pid, action, reasoning: decision.reasoning, ok: true };
        }
        const evs = host.act(action, pid);
        for (const e of evs) {
          history.push(e);
          events.push(e);
          for (const m of memories.values()) m.noteEvent(e);
        }
        decisions.push(record);
        playOptions.onStep?.(record, evs);
      }
      steps++;
      continue;
    }
    steps++;

    // 收集所有活跃 AI 的决策（同时行动阶段一起收集，再依次 apply）
    const chosen = await Promise.all(
      turn.active.map(async (pid): Promise<{ pid: PlayerId; decision: AgentDecision; legal: unknown[] }> => {
        const seat = seatOf.get(pid);
        if (!seat) throw new Error(`活跃玩家 ${pid} 没有对应的 Agent`);
        const view = host.view(pid);
        const legal = def?.legalActions
          ? (def.legalActions(host.state, pid) as unknown[])
          : [];
        const mem = memories.get(pid)!;
        const ctx: AgentContext = {
          game: gameId,
          you: pid,
          role: roleOf(gameId, view),
          visibleState: view,
          turn,
          actions: legal,
          history,
          players: seats.map((s) => s.player),
          memory: mem.snapshot(seats.map((s) => s.player)),
        };
        const decision = await seat.provider.decide(ctx);
        return { pid, decision, legal };
      }),
    );

    for (const { pid, decision, legal } of chosen) {
      const v = validateDecision(decision, legal);
      let action = decision.action;
      let record: DecisionRecord;
      if (!v.ok) {
        if (!fallback) throw new Error(`玩家 ${pid} 非法决策: ${v.error}`);
        action = legal[Math.floor(rng() * legal.length)];
        record = {
          player: pid,
          action,
          reasoning: decision.reasoning,
          ok: false,
          error: v.error,
          fallback: true,
        };
      } else {
        record = { player: pid, action, reasoning: decision.reasoning, ok: true };
      }
      const evs = host.act(action, pid);
      for (const e of evs) {
        history.push(e);
        events.push(e);
        for (const m of memories.values()) m.noteEvent(e);
      }
      decisions.push(record);
      playOptions.onStep?.(record, evs);
    }
  }

  return {
    gameId,
    players: seats.map((s) => s.player),
    startedAt,
    durationMs: Date.now() - startedAt,
    events,
    decisions,
    result: host.result(),
    seed,
    options,
  };
}

/** 服务器集成用的最小宿主接口 */
export interface DrivenHost {
  readonly players: PlayerInfo[];
  readonly gameId: GameId;
  turn(): TurnInfo;
  apply(action: unknown, from: PlayerId): GameEvent[];
  viewFor(p: PlayerId): { view: GameView; turn: TurnInfo; result: GameResult | null };
  legalActionsFor(p: PlayerId): unknown[];
}

export interface AgentSeatConfig {
  profile: AgentProfile;
  provider: AgentProvider;
}

/**
 * Agent 驱动器（服务器集成用）。
 * 每次状态变化后调用 pump()：为所有轮到的 AI 座位决策并 apply。
 */
export class AgentDriver {
  private memories = new Map<PlayerId, MemoryStore>();
  private history: GameEvent[] = [];
  private busy = false;

  constructor(
    private readonly host: DrivenHost,
    private readonly seats: Map<PlayerId, AgentSeatConfig>,
    private readonly rng: Rng = Math.random,
  ) {
    for (const [pid, cfg] of seats) this.memories.set(pid, new MemoryStore(cfg.profile));
  }

  /** 该座位是否由 AI 占据 */
  has(pid: PlayerId): boolean {
    return this.seats.has(pid);
  }

  /** 为所有活跃 AI 座位决策并执行；返回本次产生的事件 */
  async pump(): Promise<GameEvent[]> {
    if (this.busy) return [];
    this.busy = true;
    try {
      const turn = this.host.turn();
      const active = turn.active.filter((pid) => this.seats.has(pid));
      if (active.length === 0) return [];

      const chosen = await Promise.all(
        active.map(async (pid) => {
          const cfg = this.seats.get(pid)!;
          const { view } = this.host.viewFor(pid);
          const legal = this.host.legalActionsFor(pid);
          const mem = this.memories.get(pid)!;
          const ctx: AgentContext = {
            game: this.host.gameId,
            you: pid,
            role: roleOf(this.host.gameId, view),
            visibleState: view,
            turn,
            actions: legal,
            history: this.history,
            players: this.host.players,
            memory: mem.snapshot(this.host.players),
          };
          const decision = await cfg.provider.decide(ctx);
          return { pid, decision, legal };
        }),
      );

      const out: GameEvent[] = [];
      for (const { pid, decision, legal } of chosen) {
        const v = validateDecision(decision, legal);
        let action = decision.action;
        if (!v.ok) {
          if (legal.length === 0) continue;
          action = legal[Math.floor(this.rng() * legal.length)];
        }
        const evs = this.host.apply(action, pid);
        for (const e of evs) {
          this.history.push(e);
          out.push(e);
          for (const m of this.memories.values()) m.noteEvent(e);
        }
      }
      return out;
    } finally {
      this.busy = false;
    }
  }
}
