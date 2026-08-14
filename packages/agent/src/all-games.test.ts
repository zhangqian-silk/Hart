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

describe('脚本 Agent 自对弈（四款游戏）', () => {
  it('五子棋', async () => {
    const t = await playGame('wuziqi', seats(['黑', '白']), {}, seededRng(42));
    expect(t.result).not.toBeNull();
    expect(t.decisions.every((d) => d.ok)).toBe(true);
  });

  it('斗地主', async () => {
    const t = await playGame('doudizhu', seats(['甲', '乙', '丙']), {}, seededRng(42));
    expect(t.result).not.toBeNull();
    expect(t.result!.winners.length).toBeGreaterThan(0);
  });

  it('一夜狼', async () => {
    const t = await playGame('yiyelang', seats(['甲', '乙', '丙', '丁', '戊']), {}, seededRng(42));
    expect(t.result).not.toBeNull();
    expect(t.result!.winners.length).toBeGreaterThan(0);
  });

  it('阿瓦隆', async () => {
    const t = await playGame('avalon', seats(['甲', '乙', '丙', '丁', '戊']), {}, seededRng(42));
    expect(t.result).not.toBeNull();
    expect(t.result!.winners.length).toBeGreaterThan(0);
  });
});
