import type { GameEvent, PlayerId } from '@hart/common';
import type { AgentProfile, MemorySnapshot } from './types.js';

/**
 * 记忆系统（V8: Memory System）。
 * - Profile Memory：长期人格（来自档案）
 * - Game Memory：当前游戏事件摘要（滚动窗口）
 * - Relationship Memory：玩家间历史关系
 * Memory 用于辅助 Context，不替代 Agent 决策。
 */
export class MemoryStore {
  private events: GameEvent[] = [];
  private relations = new Map<string, string>();

  constructor(
    private readonly profile: AgentProfile,
    private readonly maxEvents = 40,
  ) {}

  /** 记录一个游戏事件（Game Memory） */
  noteEvent(e: GameEvent): void {
    this.events.push(e);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  /** 记录与某玩家的关系（Relationship Memory） */
  noteRelation(other: PlayerId, note: string): void {
    const prev = this.relations.get(other);
    this.relations.set(other, prev ? `${prev}；${note}` : note);
  }

  snapshot(players: { id: PlayerId; name: string }[]): MemorySnapshot {
    const nameOf = new Map(players.map((p) => [p.id, p.name]));
    const relationships: Record<string, string> = {};
    for (const [id, note] of this.relations) {
      relationships[nameOf.get(id) ?? id] = note;
    }
    return {
      profileNote: `${this.profile.name}：${this.profile.persona}。${this.profile.strategy}`,
      gameSummary: this.events.map((e) => eventToText(e)).join('；') || '（暂无）',
      relationships,
    };
  }
}

/** 事件 -> 简短文本（摘要用） */
export function eventToText(e: GameEvent): string {
  const parts: string[] = [e.type];
  if (typeof e.from === 'string') parts.push(`by=${e.from}`);
  for (const [k, v] of Object.entries(e)) {
    if (k === 'type' || k === 'from') continue;
    if (typeof v === 'string' || typeof v === 'number') parts.push(`${k}=${v}`);
  }
  return parts.join(' ');
}
