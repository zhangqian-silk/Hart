import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES } from './profiles.js';
import {
  buildInitialPrompt,
  buildTurnPrompt,
  buildPrompt,
  type PromptInput,
} from './prompt.js';
import type { AgentContext } from './types.js';

function makeInput(): PromptInput {
  const ctx: AgentContext = {
    game: 'wuziqi',
    you: 'p1',
    role: 'black',
    visibleState: { game: 'wuziqi', phase: 'playing' } as never,
    turn: { active: ['p1'], phase: 'playing' },
    actions: [{ t: 'place', row: 7, col: 7 }],
    history: [{ type: 'place', by: 'p2', row: 7, col: 8 }],
    players: [{ id: 'p1', name: 'A', seat: 0 }],
    memory: { profileNote: 'test', gameSummary: '', relationships: {} },
  };
  return {
    profile: BUILTIN_PROFILES[0]!,
    ctx,
    rules: '五子棋规则：黑白交替落子，先连成五子者胜。',
  };
}

describe('Prompt Builders', () => {
  describe('buildInitialPrompt', () => {
    it('包含全部 8 个段落', () => {
      const p = buildInitialPrompt(makeInput());
      expect(p).toContain('## Base Identity');
      expect(p).toContain('## Game Rules');
      expect(p).toContain('## Role Instruction');
      expect(p).toContain('## Persona');
      expect(p).toContain('## Strategy');
      expect(p).toContain('## Observation');
      expect(p).toContain('## Memory');
      expect(p).toContain('## Output Schema');
    });

    it('包含 recentEvents（历史事件）', () => {
      const p = buildInitialPrompt(makeInput());
      expect(p).toContain('recentEvents');
    });

    it('包含游戏规则文本', () => {
      const p = buildInitialPrompt(makeInput());
      expect(p).toContain('五子棋规则');
    });
  });

  describe('buildTurnPrompt', () => {
    it('只包含续场 4 段', () => {
      const p = buildTurnPrompt(makeInput());
      expect(p).toContain('## Continuation');
      expect(p).toContain('## Observation');
      expect(p).toContain('## Memory');
      expect(p).toContain('## Output Schema');
    });

    it('不包含身份/规则/人格/策略段', () => {
      const p = buildTurnPrompt(makeInput());
      expect(p).not.toContain('## Base Identity');
      expect(p).not.toContain('## Game Rules');
      expect(p).not.toContain('## Persona');
      expect(p).not.toContain('## Strategy');
      expect(p).not.toContain('## Role Instruction');
    });

    it('不包含 recentEvents（历史在会话中）', () => {
      const p = buildTurnPrompt(makeInput());
      expect(p).not.toContain('recentEvents');
    });

    it('包含当前合法动作和玩家信息', () => {
      const p = buildTurnPrompt(makeInput());
      expect(p).toContain('legalActions');
      expect(p).toContain('players');
      expect(p).toContain('place');
    });
  });

  describe('buildPrompt（别名）', () => {
    it('与 buildInitialPrompt 行为一致', () => {
      const input = makeInput();
      expect(buildPrompt(input)).toBe(buildInitialPrompt(input));
    });
  });
});
