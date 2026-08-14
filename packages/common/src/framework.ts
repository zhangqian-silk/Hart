import type { GameId, GameEvent, GameOptions, GameResult, PlayerId, PlayerInfo, Rng } from './types.js';

/**
 * 游戏视图：某玩家视角下的全部可见状态。
 * 每款游戏自定义具体字段（discriminated union 或自由结构均可），
 * 但必须带 game/phase 两个公共字段。
 */
export interface GameView {
  game: GameId;
  /** 当前阶段（如 'playing' / 'voting' / 'night'） */
  phase: string;
  [k: string]: unknown;
}

export interface TurnInfo {
  /** 当前需要行动的玩家（可能多人，如投票阶段所有人） */
  active: PlayerId[];
  /** 阶段标识（与 view.phase 对应） */
  phase: string;
  /** 给 UI 的提示文案，如 "请黑方下棋" */
  hint?: string;
}

/** 游戏元信息（大厅/规则展示用） */
export interface GameMeta {
  id: GameId;
  name: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
  /** 主题色（hex） */
  theme: string;
  /** 规则说明（markdown） */
  rules: string;
  /** 可选项 schema（房间设置用） */
  options?: OptionField[];
}

export interface OptionField {
  key: string;
  label: string;
  type: 'select' | 'boolean';
  choices?: { value: string; label: string }[];
  default: unknown;
}

/**
 * 游戏定义契约。每款游戏实现此接口，注册到 registry。
 * 服务端权威运行 start/apply；客户端只拿 view。
 */
export interface GameDefinition<S, A> {
  readonly meta: GameMeta;
  readonly id: GameId;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly defaultOptions: GameOptions;

  /** 开局：返回完整内部状态（含秘密，仅服务端可见） */
  start(players: PlayerInfo[], options: GameOptions, rng: Rng): S;

  /** 应用动作；非法动作抛 Error。返回新状态 + 事件 */
  apply(state: S, action: A, from: PlayerId): { state: S; events: GameEvent[] };

  /** 某玩家视角的视图（剥离秘密） */
  view(state: S, viewer: PlayerId): GameView;

  /**
   * 枚举某玩家当前所有合法动作（Agent 接入用，对应 V8 设计的 getAvailableActions）。
   * 未实现时 Agent 需自行提议动作，由 apply 校验合法性。
   */
  legalActions?(state: S, player: PlayerId): A[];

  /** 当前行动者/阶段 */
  turn(state: S): TurnInfo;

  /** 终局判定；未结束返回 null */
  result(state: S): GameResult | null;
}

/* ---------- 注册中心 ---------- */

const registry = new Map<GameId, GameDefinition<unknown, unknown>>();

export function registerGame<S, A>(def: GameDefinition<S, A>): void {
  registry.set(def.id, def as GameDefinition<unknown, unknown>);
}

export function getGame(id: GameId): GameDefinition<unknown, unknown> | undefined {
  return registry.get(id);
}

export function listGames(): GameMeta[] {
  return [...registry.values()].map((d) => d.meta);
}

/* ---------- 本地对局托管（client 本地模式 / 测试用） ---------- */

export interface LocalHost {
  state: unknown;
  view(viewer: PlayerId): GameView;
  act(action: unknown, from: PlayerId): GameEvent[];
  turn(): TurnInfo;
  result(): GameResult | null;
}

/** 在浏览器/测试里直接跑一个游戏（不经过服务器），用于本地模式与 UI 开发 */
export function createLocalHost(
  id: GameId,
  players: PlayerInfo[],
  options: GameOptions = {},
  rng: Rng = Math.random,
): LocalHost {
  const def = registry.get(id);
  if (!def) throw new Error(`unknown game: ${id}`);
  let state = def.start(players, options, rng);
  return {
    get state() {
      return state;
    },
    view: (viewer) => def.view(state, viewer),
    act: (action, from) => {
      const r = def.apply(state, action, from);
      state = r.state;
      return r.events;
    },
    turn: () => def.turn(state),
    result: () => def.result(state),
  };
}
