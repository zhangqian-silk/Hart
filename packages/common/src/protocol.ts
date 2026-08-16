import type { GameEvent, GameId, GameOptions, GameResult, PlayerId, RoomCode } from './types.js';
import type { GameView, TurnInfo } from './framework.js';

export interface SeatInfo {
  seat: number;
  player: { id: PlayerId; name: string } | null;
  ready: boolean;
  online: boolean;
  isHost: boolean;
  /** AI 座位信息（该座位由 Agent 占据时存在） */
  agent?: AgentSeatInfo;
}

/** AI 座位信息 */
export interface AgentSeatInfo {
  /** Agent 档案 id */
  profileId: string;
  /** Agent 展示名 */
  profileName: string;
  /** Provider 类型，如 scripted / http / claude-code / codex */
  kind: string;
  /** 思考状态（UI 展示用） */
  status: 'idle' | 'thinking';
}

export interface ChatMsg {
  id: number;
  from: PlayerId;
  name: string;
  text: string;
  ts: number;
  system?: boolean;
}

export interface RoomGameState {
  view: GameView;
  turn: TurnInfo;
  result: GameResult | null;
}

/** 房间视图（服务端按连接定制 game 部分后下发） */
export interface RoomView {
  code: RoomCode;
  game: GameId;
  host: PlayerId;
  seats: SeatInfo[];
  options: GameOptions;
  status: 'waiting' | 'playing' | 'finished';
  chat: ChatMsg[];
  /** 对局中：你个人视角的游戏状态 */
  gameState?: RoomGameState;
}

export type ClientMsg =
  | { t: 'hello'; name: string }
  | { t: 'room.create'; game: GameId }
  | { t: 'room.join'; code: RoomCode }
  | { t: 'room.leave' }
  | { t: 'room.sit'; seat: number }
  | { t: 'room.stand' }
  | { t: 'room.ready'; ready: boolean }
  | { t: 'room.chat'; text: string }
  | { t: 'room.options'; options: GameOptions }
  | { t: 'room.start' }
  | { t: 'game.action'; action: unknown }
  /** 房主添加 AI 到指定座位（或自动选座） */
  | { t: 'room.add_agent'; seat?: number; profileId: string; providerKind?: string }
  /** 房主移除座位上的 AI */
  | { t: 'room.remove_agent'; seat: number };

export type ServerMsg =
  | { t: 'welcome'; you: PlayerId; name: string }
  | { t: 'room.state'; room: RoomView }
  | { t: 'room.event'; event: GameEvent }
  /** 可选 Agent 档案列表（hello 后下发） */
  | { t: 'agent.profiles'; profiles: AgentProfileInfo[] }
  | { t: 'error'; message: string };

/** Agent Provider 配置（决定 AI 用什么执行能力） */
export interface AgentProviderInfo {
  /** Provider 类型：scripted / http / claude-code / codex */
  kind: string;
  /** 模型（claude-code / codex 用） */
  model?: string;
  /** 努力程度（claude-code 用） */
  effort?: string;
  /** 可执行文件路径（CLI 用，缺省取 PATH 中的 claude/codex） */
  binPath?: string;
  /** Webhook URL（http 用） */
  url?: string;
  /** 超时毫秒 */
  timeoutMs?: number;
}

/** 可选 Agent 档案（大厅/房间添加 AI 用） */
export interface AgentProfileInfo {
  id: string;
  name: string;
  persona: string;
  strategy: string;
  /** 可选：完整 system prompt 覆盖 */
  systemPrompt?: string;
  /** 按游戏的策略细则（Game Policy） */
  gamePolicy?: Partial<Record<GameId, string>>;
  /** 适用的游戏列表（空/缺省 = 全部游戏） */
  games?: GameId[];
  /** Provider 配置（缺省 = scripted） */
  provider?: AgentProviderInfo;
  /** 是否内置档案（内置可重置为默认） */
  builtin?: boolean;
}
