import type { AgentContext, AgentDecision } from './types.js';

/**
 * V8 Agent Protocol 线上格式。
 * 输入：{ game, role, visibleState, actions }
 * 输出：{ action, payload? }（本实现额外允许 reasoning 字段）
 */
export interface AgentRequestMessage {
  game: string;
  role: string;
  visibleState: unknown;
  actions: unknown[];
}

export interface AgentResponseMessage {
  action: unknown;
  payload?: Record<string, unknown>;
  reasoning?: string;
}

/** 服务端上下文 -> 线上请求 */
export function toRequestMessage(ctx: AgentContext): AgentRequestMessage {
  return {
    game: ctx.game,
    role: ctx.role,
    visibleState: ctx.visibleState,
    actions: ctx.actions,
  };
}

/** 解析 Agent 输出（容忍 markdown 代码块包裹与前后噪声） */
export function parseResponse(text: string): AgentResponseMessage {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.unshift(fence[1].trim());
  const brace = trimmed.match(/\{[\s\S]*\}/);
  if (brace) candidates.push(brace[0]);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c) as Record<string, unknown>;
      if (obj && typeof obj === 'object' && 'action' in obj) {
        return {
          action: obj.action,
          payload: (obj.payload as Record<string, unknown>) ?? undefined,
          reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
        };
      }
    } catch {
      // 尝试下一个候选
    }
  }
  throw new Error('Agent 输出不是合法的 { action, ... } JSON');
}

/** 深度相等（动作匹配用） */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/** 在合法动作列表中查找匹配项；找不到返回 null */
export function findLegalAction(actions: unknown[], action: unknown): unknown | null {
  for (const a of actions) {
    if (deepEqual(a, action)) return a;
  }
  return null;
}

export type ValidationResult =
  | { ok: true; action: unknown }
  | { ok: false; error: string };

/**
 * 校验 Agent 决策（V8: 输出必须经过 Validator）。
 * 决策动作必须与合法动作列表中的某一项深度相等。
 */
export function validateDecision(
  decision: AgentDecision,
  legalActions: unknown[],
): ValidationResult {
  if (decision.action === undefined || decision.action === null) {
    return { ok: false, error: '决策缺少 action 字段' };
  }
  if (legalActions.length === 0) {
    return { ok: false, error: '当前没有可执行的合法动作' };
  }
  const match = findLegalAction(legalActions, decision.action);
  if (match === null) {
    return {
      ok: false,
      error: `动作不在合法列表中: ${JSON.stringify(decision.action)}`,
    };
  }
  return { ok: true, action: match };
}
