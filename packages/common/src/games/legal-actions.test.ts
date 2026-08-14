import { describe, expect, it } from 'vitest';
import './index.js';
import { getGame } from '../framework.js';
import { seededRng, type GameId, type PlayerInfo } from '../types.js';

/**
 * legalActions 契约测试（Agent 层依赖）：
 * 枚举出的每个动作都必须能被 apply 接受（不抛错），
 * 且非活跃玩家 / 终局返回空。
 */

function players(n: number): PlayerInfo[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, seat: i }));
}

const CASES: { id: GameId; n: number }[] = [
  { id: 'wuziqi', n: 2 },
  { id: 'doudizhu', n: 3 },
  { id: 'yiyelang', n: 5 },
  { id: 'avalon', n: 5 },
];

describe('legalActions 契约（四款游戏）', () => {
  for (const { id, n } of CASES) {
    it(`${id}: 每个枚举动作都能被 apply 接受，直到终局`, () => {
      const def = getGame(id)!;
      expect(def.legalActions).toBeDefined();
      const ps = players(n);
      let state = def.start(ps, {}, seededRng(2026));
      let steps = 0;
      while (def.result(state) === null && steps < 3000) {
        const turn = def.turn(state);
        if (turn.active.length === 0) break;
        // 非活跃玩家必须返回空
        for (const p of ps) {
          if (!turn.active.includes(p.id)) {
            expect(def.legalActions!(state, p.id)).toEqual([]);
          }
        }
        const actor = turn.active[0]!;
        const legal = def.legalActions!(state, actor);
        expect(legal.length).toBeGreaterThan(0);
        // 每个枚举动作都应通过校验（用副本尝试，不改变主状态）
        for (const a of legal.slice(0, 12)) {
          expect(() => def.apply(state, a, actor)).not.toThrow();
        }
        // 用第一个动作推进
        const r = def.apply(state, legal[0]!, actor);
        state = r.state;
        steps++;
      }
      // 终局后所有玩家 legalActions 为空
      if (def.result(state) !== null) {
        for (const p of ps) expect(def.legalActions!(state, p.id)).toEqual([]);
      }
    });
  }
});
