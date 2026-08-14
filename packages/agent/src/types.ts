import type { GameEvent, GameId, PlayerId, PlayerInfo } from '@hart/common';
import type { GameView, TurnInfo } from '@hart/common';

/** 记忆快照（V8: Memory System 对 Agent 的输出） */
export interface MemorySnapshot {
  /** 长期人格记忆 */
  profileNote: string;
  /** 当前游戏事件摘要 */
  gameSummary: string;
  /** 玩家间关系记忆，key 为对方玩家 id */
  relationships: Record<string, string>;
}

/**
 * Agent 档案（V8: Agent Profile）。
 * 定义 Agent 身份：System Prompt / Persona / Strategy / Game Policy。
 * 同一个 Provider 可以挂载不同 Profile。
 */
export interface AgentProfile {
  id: string;
  name: string;
  /** 人格，如 "逻辑推理型" */
  persona: string;
  /** 通用策略倾向 */
  strategy: string;
  /** 可选：完整 system prompt 覆盖 */
  systemPrompt?: string;
  /** 按游戏的策略细则（Game Policy） */
  gamePolicy?: Partial<Record<GameId, string>>;
}

/**
 * 一次决策的输入（V8: Agent Protocol 输入的服务端形态）。
 * visibleState 已经过 Context Provider 过滤，Agent 看不到秘密信息。
 */
export interface AgentContext {
  game: GameId;
  you: PlayerId;
  /** 角色，如 black / landlord / merlin */
  role: string;
  /** 可见状态（Context Provider 输出） */
  visibleState: GameView;
  turn: TurnInfo;
  /** 当前合法动作列表（来自 GameDefinition.legalActions） */
  actions: unknown[];
  /** 近期事件 */
  history: GameEvent[];
  players: PlayerInfo[];
  memory: MemorySnapshot;
}

/** Agent 决策输出 */
export interface AgentDecision {
  /** 必须是合法动作之一（与 AgentContext.actions 中某项深相等） */
  action: unknown;
  /** 可选：决策理由（展示/评估用） */
  reasoning?: string;
}

/**
 * Agent 执行能力（V8: Agent Provider）。
 * 生命周期：start -> decide* -> stop（对应 START/INIT/SEND_CONTEXT/WAIT_ACTION/STOP）。
 */
export interface AgentProvider {
  /** Provider 类型，如 scripted / http / claude-code / codex */
  readonly kind: string;
  start(): Promise<void>;
  decide(ctx: AgentContext): Promise<AgentDecision>;
  stop(): Promise<void>;
}

/** Provider 工厂：档案 + 配置 -> Provider 实例 */
export type ProviderFactory = (
  profile: AgentProfile,
  options?: Record<string, unknown>,
) => AgentProvider;
