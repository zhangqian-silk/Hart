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
  /** Provider 类型，如 scripted / http / claude-code / codex / anthropic */
  kind: string;
  /** 思考状态（UI 展示用） */
  status: 'idle' | 'thinking';
  /** 使用的玩家模型标签（通过 modelRef 指定时存在） */
  modelLabel?: string;
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
  | { t: 'hello'; name: string; pid?: string }
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
  /** 房主添加 AI 到指定座位（或自动选座）；modelRef 指定使用某玩家的模型凭据 */
  | { t: 'room.add_agent'; seat?: number; profileId: string; providerKind?: string; modelRef?: ModelRef }
  /** 房主移除座位上的 AI */
  | { t: 'room.remove_agent'; seat: number };

/** 玩家模型引用（玩家自带凭据） */
export interface ModelRef {
  /** 模型拥有者的玩家 id */
  pid: string;
  /** 玩家模型仓库中的模型 id */
  modelId: string;
}

export type ServerMsg =
  | { t: 'welcome'; you: PlayerId; name: string; pid: string }
  | { t: 'room.state'; room: RoomView }
  | { t: 'room.event'; event: GameEvent }
  /** 可选 Agent 档案列表（hello 后下发） */
  | { t: 'agent.profiles'; profiles: AgentProfileInfo[] }
  | { t: 'error'; message: string };

/** Agent Provider 配置（决定 AI 用什么执行能力） */
export interface AgentProviderInfo {
  /** Provider 类型：scripted / http / claude-code / codex / anthropic */
  kind: string;
  /** 模型（claude-code / codex / anthropic 用） */
  model?: string;
  /** 努力程度（claude-code / anthropic 用） */
  effort?: string;
  /** 可执行文件路径（CLI 用，缺省取 PATH 中的 claude/codex） */
  binPath?: string;
  /** Webhook URL（http 用） */
  url?: string;
  /** 超时毫秒 */
  timeoutMs?: number;
  /** API Key（claude-code / codex / anthropic 用；服务端读取时脱敏为 ••••xxxx） */
  apiKey?: string;
  /** 自定义 API 端点（anthropic/openai 直连；claude-code 注入 ANTHROPIC_BASE_URL） */
  baseUrl?: string;
  /** 独立 CLI 配置目录（claude-code 注入 CLAUDE_CONFIG_DIR，多账号隔离） */
  configDir?: string;
}

/** 玩家模型类型（玩家自带凭据的执行能力） */
export type PlayerModelKind = 'claude-code' | 'codex' | 'anthropic' | 'openai';

/**
 * 玩家模型（BYOK：玩家自带 API Key）。
 * 服务端持久化时保存明文 key；通过任何接口读取时 apiKey 脱敏为 ••••xxxx。
 * 保存时：apiKey 含 • 表示沿用原值，空字符串表示清除，其余视为新值。
 */
export interface PlayerModel {
  id: string;
  /** 展示标签，如「我的 opus」 */
  label: string;
  kind: PlayerModelKind;
  /** 模型 id，如 claude-sonnet-5 / gpt-5 */
  model: string;
  /** API Key（读取时脱敏） */
  apiKey?: string;
  /** 自定义 API 端点（anthropic 直连 / CLI BASE_URL） */
  baseUrl?: string;
  /** 努力程度 */
  effort?: string;
  /** 可执行文件路径（CLI 用） */
  binPath?: string;
  /** 超时毫秒 */
  timeoutMs?: number;
  /** 创建时间戳（ms） */
  createdAt: number;
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
