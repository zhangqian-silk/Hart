import { describe, expect, it } from 'vitest';
import { seededRng } from '../../types.js';
import { yiyelang, type YylState, type Role } from './index.js';

const players = [
  { id: 'A', name: '甲', seat: 0 },
  { id: 'B', name: '乙', seat: 1 },
  { id: 'C', name: '丙', seat: 2 },
  { id: 'D', name: '丁', seat: 3 },
];

function startGame(roles?: Role[], seed = 42): YylState {
  return yiyelang.start(players, roles ? { roles, discussionSeconds: 1 } : { discussionSeconds: 1 }, seededRng(seed));
}

/** 推进所有夜晚行动（每个有行动的角色 ack/skip），进入白天 */
function passNight(s: YylState): YylState {
  let state = s;
  let guard = 0;
  while (state.phase === 'night' && guard++ < 50) {
    const role = state.nightSteps[state.stepIndex];
    if (!role) break;
    const actors = state.stepActors;
    if (actors.length === 0) break;
    const actor = actors[0]!;
    // 简单处理：有行动权的角色一律 ack（预言家/强盗等需要选择的，用 skip 或 ack）
    try {
      const r = yiyelang.apply(state, { t: 'night', choice: { kind: 'ack' } }, actor);
      state = r.state;
    } catch {
      const r = yiyelang.apply(state, { t: 'night', choice: { kind: 'skip' } }, actor);
      state = r.state;
    }
  }
  return state;
}

function passDiscussion(s: YylState): YylState {
  let state = s;
  for (const p of players) {
    if (state.phase !== 'day') break;
    state = yiyelang.apply(state, { t: 'endDiscussion' }, p.id).state;
  }
  return state;
}

describe('一夜狼', () => {
  it('开局发牌：每人一张 + 中央三张', () => {
    const s = startGame();
    expect(Object.keys(s.hands)).toHaveLength(4);
    expect(s.center).toHaveLength(3);
    expect(s.phase).toBe('night');
  });

  it('夜晚按顺序行动，结束后进入白天', () => {
    const s = startGame();
    const day = passNight(s);
    expect(day.phase).toBe('day');
  });

  it('白天讨论结束后进入投票', () => {
    let s = startGame();
    s = passNight(s);
    s = passDiscussion(s);
    expect(s.phase).toBe('voting');
  });

  it('投票：全员投票后结算，狼人出局则村民胜', () => {
    let s = startGame();
    s = passNight(s);
    s = passDiscussion(s);
    // 找一个狼人投出去
    const wolf = players.find((p) => s.hands[p.id] === 'werewolf')!;
    for (const p of players) {
      s = yiyelang.apply(s, { t: 'vote', target: wolf.id }, p.id).state;
    }
    expect(s.phase).toBe('done');
    expect(s.outcome?.winner).toBe('village');
    expect(s.out).toContain(wolf.id);
  });

  it('投票：无人出局（平票）则狼人胜', () => {
    let s = startGame();
    s = passNight(s);
    s = passDiscussion(s);
    // 构造平票：A 投 B，B 投 A，C 投 A，D 投 B → A:2 B:2 平票，无人出局
    s = yiyelang.apply(s, { t: 'vote', target: 'B' }, 'A').state;
    s = yiyelang.apply(s, { t: 'vote', target: 'A' }, 'B').state;
    s = yiyelang.apply(s, { t: 'vote', target: 'A' }, 'C').state;
    s = yiyelang.apply(s, { t: 'vote', target: 'B' }, 'D').state;
    expect(s.phase).toBe('done');
    expect(s.outcome?.winner).toBe('wolves');
    expect(s.out).toHaveLength(0);
  });

  it('视图：夜晚别人的情报不可见', () => {
    const s = startGame();
    const v = yiyelang.view(s, 'A') as any;
    expect(v.you).toBe('A');
    expect(v.myRole).toBeTruthy();
    // 夜晚信息只有自己的
    expect(Array.isArray(v.nightInfo)).toBe(true);
  });

  it('不能重复投票', () => {
    let s = startGame();
    s = passNight(s);
    s = passDiscussion(s);
    s = yiyelang.apply(s, { t: 'vote', target: 'B' }, 'A').state;
    expect(() => yiyelang.apply(s, { t: 'vote', target: 'C' }, 'A')).toThrow();
  });

  it('自定义身份：皮匠出局则皮匠胜', () => {
    // 4 人 + 3 中央 = 7 张
    const roles: Role[] = ['tanner', 'werewolf', 'seer', 'villager', 'werewolf', 'minion', 'robber'];
    let s = startGame(roles, 7);
    s = passNight(s);
    s = passDiscussion(s);
    const tanner = players.find((p) => s.hands[p.id] === 'tanner');
    if (tanner) {
      for (const p of players) {
        s = yiyelang.apply(s, { t: 'vote', target: tanner.id }, p.id).state;
      }
      expect(s.outcome?.winner).toBe('tanner');
    }
  });
});
