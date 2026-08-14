import { describe, expect, it } from 'vitest';
import '@hart/common/games';
import { seededRng, type PlayerInfo } from '@hart/common';
import { BUILTIN_PROFILES } from './profiles.js';
import { ScriptedProvider } from './provider/scripted.js';
import { playGame, type AgentSeat } from './host.js';

function seats(names: string[]): AgentSeat[] {
  return names.map((name, i): AgentSeat => {
    const profile = BUILTIN_PROFILES[i % BUILTIN_PROFILES.length]!;
    return {
      player: { id: `p${i}`, name, seat: i } as PlayerInfo,
      profile,
      provider: new ScriptedProvider(profile),
    };
  });
}

describe('playGame（脚本 Agent 自对弈）', () => {
  it('五子棋能下完并产生胜者', async () => {
    const t = await playGame('wuziqi', seats(['黑', '白']), {}, seededRng(42));
    expect(t.result).not.toBeNull();
    expect(t.result!.winners.length).toBe(1);
    expect(t.decisions.length).toBeGreaterThan(5);
    expect(t.events.length).toBeGreaterThan(5);
  });

  it('五子棋每一步都合法（无 fallback）', async () => {
    const t = await playGame('wuziqi', seats(['黑', '白']), {}, seededRng(7));
    expect(t.decisions.every((d) => d.ok)).toBe(true);
  });

  it('transcript 记录完整（决策与事件非空）', async () => {
    const t = await playGame('wuziqi', seats(['黑', '白']), {}, seededRng(99));
    expect(t.decisions.length).toBeGreaterThan(0);
    expect(t.events.length).toBeGreaterThan(0);
    expect(t.durationMs).toBeGreaterThanOrEqual(0);
  });
});
