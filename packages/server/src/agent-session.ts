import type { ServerMsg } from '@hart/common';
import type { Room } from './room.js';
import type { AgentProfile, AgentProvider } from '@hart/agent';

let nextAgentId = 1;

/**
 * AI 玩家会话：与 Session 同构，使 Room 可以统一处理人类与 AI 座位。
 * AI 不接收 WebSocket 消息（send 为空操作）。
 */
export class AgentSession {
  readonly id: string;
  name: string;
  online = true;
  room?: Room;
  readonly profile: AgentProfile;
  readonly provider: AgentProvider;
  /** 使用的玩家模型标签（modelRef 指定时存在，仅展示用） */
  modelLabel?: string;
  status: 'idle' | 'thinking' = 'idle';

  constructor(profile: AgentProfile, provider: AgentProvider) {
    this.id = `agent:${nextAgentId++}`;
    this.name = profile.name;
    this.profile = profile;
    this.provider = provider;
  }

  send(_msg: ServerMsg): void {
    // AI 不接收推送
  }
}
