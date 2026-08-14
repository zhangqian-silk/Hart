import { describe, expect, it } from 'vitest';
import { seededRng } from '../../types.js';
import {
  avalon,
  CONFIG,
  ROLE_INFO,
  type AvalonRole,
  type AvalonState,
  type AvalonView,
} from './index.js';

function mkPlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `玩家${i + 1}`,
    seat: i,
  }));
}

function start(n: number, seed = 42): AvalonState {
  return avalon.start(mkPlayers(n), {}, seededRng(seed));
}

function side(s: AvalonState, id: string) {
  return ROLE_INFO[s.roles[id]!]!.side;
}

/** 队长提名 */
function propose(s: AvalonState, team: string[]): AvalonState {
  const leader = s.players[s.leaderIdx]!;
  return avalon.apply(s, { t: 'propose', team }, leader.id).state;
}

/** 全员投票（未投者按 decide 决定） */
function voteAll(
  s: AvalonState,
  decide: boolean | ((id: string) => boolean) = true,
): AvalonState {
  let cur = s;
  for (const p of cur.players) {
    if (p.id in cur.votes) continue;
    const yes = typeof decide === 'function' ? decide(p.id) : decide;
    cur = avalon.apply(cur, { t: 'vote', approve: yes }, p.id).state;
  }
  return cur;
}

/** 任务队员投票，failIds 中的人投失败 */
function questAll(s: AvalonState, failIds: string[] = []): AvalonState {
  let cur = s;
  for (const id of cur.questTeam!) {
    cur = avalon.apply(
      cur,
      { t: 'quest', vote: failIds.includes(id) ? 'fail' : 'success' },
      id,
    ).state;
  }
  return cur;
}

/** 打完一次任务（提名+投票+执行），全员赞成 */
function playMission(s: AvalonState, team: string[], failIds: string[] = []): AvalonState {
  let cur = propose(s, team);
  cur = voteAll(cur, true);
  return questAll(cur, failIds);
}

describe('阿瓦隆-身份分配', () => {
  for (const n of [5, 6, 7, 8, 9, 10]) {
    it(`${n} 人局：阵营人数正确且必含梅林/刺客/派西维尔/莫甘娜`, () => {
      const s = start(n);
      const roles = Object.values(s.roles);
      expect(roles).toHaveLength(n);
      const good = roles.filter((r) => ROLE_INFO[r]!.side === 'good').length;
      const evil = n - good;
      expect(good).toBe(CONFIG[n]!.good);
      expect(evil).toBe(CONFIG[n]!.evil);
      expect(roles).toContain('merlin');
      expect(roles).toContain('assassin');
      expect(roles).toContain('percival');
      expect(roles).toContain('morgana');
    });
  }

  it('10 人局含莫德雷德与奥伯伦', () => {
    const roles = Object.values(start(10).roles);
    expect(roles).toContain('mordred');
    expect(roles).toContain('oberon');
  });

  it('非 5~10 人开局抛错', () => {
    expect(() => start(4)).toThrow();
    expect(() => start(11)).toThrow();
  });
});

describe('阿瓦隆-夜晚信息（信息隐藏）', () => {
  const s = start(10, 7);
  const byRole = (r: AvalonRole) => s.players.find((p) => s.roles[p.id] === r)!;

  it('梅林看到所有坏人，莫德雷德除外', () => {
    const merlin = byRole('merlin');
    const v = avalon.view(s, merlin.id) as AvalonView;
    const seen = v.nightInfo.filter((i) => i.kind === 'evil').map((i) => i.playerId).sort();
    const expected = s.players
      .filter((p) => side(s, p.id) === 'evil' && s.roles[p.id] !== 'mordred')
      .map((p) => p.id)
      .sort();
    expect(seen).toEqual(expected);
    expect(seen).not.toContain(byRole('mordred').id);
  });

  it('派西维尔看到梅林与莫甘娜（不区分）', () => {
    const percival = byRole('percival');
    const v = avalon.view(s, percival.id) as AvalonView;
    const seen = v.nightInfo
      .filter((i) => i.kind === 'merlin-candidate')
      .map((i) => i.playerId)
      .sort();
    expect(seen).toEqual([byRole('merlin').id, byRole('morgana').id].sort());
  });

  it('坏人互认，奥伯伦除外', () => {
    const assassin = byRole('assassin');
    const v = avalon.view(s, assassin.id) as AvalonView;
    const seen = v.nightInfo
      .filter((i) => i.kind === 'evil-ally')
      .map((i) => i.playerId)
      .sort();
    const expected = s.players
      .filter(
        (p) =>
          side(s, p.id) === 'evil' &&
          p.id !== assassin.id &&
          s.roles[p.id] !== 'oberon',
      )
      .map((p) => p.id)
      .sort();
    expect(seen).toEqual(expected);
    expect(seen).not.toContain(byRole('oberon').id);
  });

  it('奥伯伦与忠臣看不到任何人', () => {
    expect((avalon.view(s, byRole('oberon').id) as AvalonView).nightInfo).toEqual([]);
    expect((avalon.view(s, byRole('loyal').id) as AvalonView).nightInfo).toEqual([]);
  });

  it('对局中视图不泄露他人身份', () => {
    const loyal = byRole('loyal');
    const v = avalon.view(s, loyal.id) as AvalonView;
    expect(v.yourRole).toBe('loyal');
    expect(v.players.every((p) => p.role === undefined)).toBe(true);
    expect(v.youAreAssassin).toBe(false);
    // 序列化后不应出现任何身份枚举值（你自己是 loyal，其余身份值不得出现）
    const text = JSON.stringify(v);
    for (const r of ['merlin', 'percival', 'assassin', 'morgana', 'mordred', 'oberon', 'minion']) {
      expect(text).not.toContain(`"${r}"`);
    }
  });

  it('任务票匿名：视图只暴露已投者，不暴露投票方向', () => {
    let cur = start(5);
    cur = propose(cur, cur.players.slice(0, 2).map((p) => p.id));
    cur = voteAll(cur, true);
    const team = cur.questTeam!;
    cur = avalon.apply(cur, { t: 'quest', vote: 'success' }, team[0]!).state;
    const v = avalon.view(cur, team[1]!) as AvalonView;
    expect(v.questSubmitted).toEqual([team[0]]);
    expect(JSON.stringify(v)).not.toContain('"fail"');
  });
});

describe('阿瓦隆-完整对局', () => {
  it('好人三次任务成功，刺客未刺中梅林 → 好人胜', () => {
    let s = start(5);
    for (let m = 0; m < 3; m++) {
      expect(s.phase).toBe('propose');
      const size = CONFIG[5]!.missionSizes[s.mission]!;
      s = playMission(s, s.players.slice(0, size).map((p) => p.id));
      expect(s.results).toHaveLength(m + 1);
      expect(s.results[m]).toBe('success');
    }
    expect(s.phase).toBe('assassinate');
    const assassin = s.players.find((p) => s.roles[p.id] === 'assassin')!;
    const merlin = s.players.find((p) => s.roles[p.id] === 'merlin')!;
    const target = s.players.find((p) => p.id !== merlin.id)!;
    s = avalon.apply(s, { t: 'assassinate', target: target.id }, assassin.id).state;
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('good');
    const res = avalon.result(s)!;
    expect(res.winners.sort()).toEqual(
      s.players.filter((p) => side(s, p.id) === 'good').map((p) => p.id).sort(),
    );
    expect(res.teams?.['好人']).toHaveLength(3);
    expect(res.teams?.['坏人']).toHaveLength(2);
  });

  it('好人三次任务成功，刺客刺中梅林 → 坏人胜', () => {
    let s = start(5, 11);
    for (let m = 0; m < 3; m++) {
      const size = CONFIG[5]!.missionSizes[s.mission]!;
      s = playMission(s, s.players.slice(0, size).map((p) => p.id));
    }
    expect(s.phase).toBe('assassinate');
    const assassin = s.players.find((p) => s.roles[p.id] === 'assassin')!;
    const merlin = s.players.find((p) => s.roles[p.id] === 'merlin')!;
    s = avalon.apply(s, { t: 'assassinate', target: merlin.id }, assassin.id).state;
    expect(s.winner).toBe('evil');
    expect(s.assassination).toBe(merlin.id);
  });

  it('三次任务失败 → 坏人胜', () => {
    let s = start(5, 123);
    const evils = s.players.filter((p) => side(s, p.id) === 'evil').map((p) => p.id);
    for (let m = 0; m < 3; m++) {
      const size = CONFIG[5]!.missionSizes[s.mission]!;
      // 队伍尽量包含坏人，坏人全部投失败
      const team = [
        ...evils,
        ...s.players.map((p) => p.id).filter((id) => !evils.includes(id)),
      ].slice(0, size);
      s = playMission(s, team, evils);
      expect(s.results[m]).toBe('fail');
    }
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('evil');
    expect(avalon.result(s)?.winners.sort()).toEqual(evils.sort());
  });

  it('连续五次提名被否 → 坏人直接胜，且队长顺时针轮换', () => {
    let s = start(5);
    const firstLeader = s.leaderIdx;
    for (let i = 0; i < 5; i++) {
      expect(s.phase).toBe('propose');
      const leaderBefore = s.leaderIdx;
      s = propose(s, s.players.slice(0, 2).map((p) => p.id));
      s = voteAll(s, false);
      if (i < 4) {
        expect(s.phase).toBe('propose');
        expect(s.failedProposals).toBe(i + 1);
        expect(s.leaderIdx).toBe((leaderBefore + 1) % 5);
      }
    }
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('evil');
    expect(s.failedProposals).toBe(5);
    expect(firstLeader).toBeGreaterThanOrEqual(0);
  });

  it('平票视为否决', () => {
    let s = start(6);
    s = propose(s, s.players.slice(0, 2).map((p) => p.id));
    s = voteAll(s, (id) => s.players.findIndex((p) => p.id === id) < 3);
    expect(s.phase).toBe('propose');
    expect(s.failedProposals).toBe(1);
  });

  it('第 4 次任务（7 人局）需 2 张失败票', () => {
    let s = start(7, 99);
    const evils = s.players.filter((p) => side(s, p.id) === 'evil').map((p) => p.id);
    const goods = s.players.filter((p) => side(s, p.id) === 'good').map((p) => p.id);
    // 任务 0：1 坏 1 好，坏人投失败 → 失败（比分 0-1）
    s = playMission(s, [evils[0]!, goods[0]!], [evils[0]!]);
    expect(s.results[0]).toBe('fail');
    // 任务 1、2：全好队 → 成功（比分 2-1）
    s = playMission(s, goods.slice(0, CONFIG[7]!.missionSizes[1]!));
    s = playMission(s, goods.slice(0, CONFIG[7]!.missionSizes[2]!));
    expect(s.mission).toBe(3);
    // 任务 3：1 坏 3 好，仅 1 张失败 → 仍成功（第 4 次任务需 2 张失败）
    s = playMission(s, [evils[0]!, goods[0]!, goods[1]!, goods[2]!], [evils[0]!]);
    expect(s.results[3]).toBe('success');
    expect(s.phase).toBe('assassinate'); // 好人 3 次成功
  });

  it('第 4 次任务 2 张失败 → 失败', () => {
    let s = start(7, 99);
    const evils = s.players.filter((p) => side(s, p.id) === 'evil').map((p) => p.id);
    const goods = s.players.filter((p) => side(s, p.id) === 'good').map((p) => p.id);
    s = playMission(s, [evils[0]!, goods[0]!], [evils[0]!]); // 0-1
    s = playMission(s, goods.slice(0, CONFIG[7]!.missionSizes[1]!)); // 1-1
    s = playMission(s, goods.slice(0, CONFIG[7]!.missionSizes[2]!)); // 2-1
    // 任务 3：2 坏 2 好，2 张失败 → 失败（2-2）
    s = playMission(
      s,
      [evils[0]!, evils[1]!, goods[0]!, goods[1]!],
      [evils[0]!, evils[1]!],
    );
    expect(s.results[3]).toBe('fail');
    expect(s.phase).toBe('propose');
    expect(s.mission).toBe(4);
  });
});

describe('阿瓦隆-非法动作', () => {
  it('非队长不能提名', () => {
    const s = start(5);
    const other = s.players.find((p) => p.id !== s.players[s.leaderIdx]!.id)!;
    expect(() =>
      avalon.apply(s, { t: 'propose', team: [s.players[0]!.id, s.players[1]!.id] }, other.id),
    ).toThrow();
  });

  it('提名人数必须等于任务人数', () => {
    const s = start(5);
    const leader = s.players[s.leaderIdx]!;
    expect(() =>
      avalon.apply(s, { t: 'propose', team: [s.players[0]!.id] }, leader.id),
    ).toThrow();
  });

  it('提名不能包含重复或不存在的玩家', () => {
    const s = start(5);
    const leader = s.players[s.leaderIdx]!;
    expect(() =>
      avalon.apply(s, { t: 'propose', team: [s.players[0]!.id, s.players[0]!.id] }, leader.id),
    ).toThrow();
    expect(() =>
      avalon.apply(s, { t: 'propose', team: [s.players[0]!.id, 'nobody'] }, leader.id),
    ).toThrow();
  });

  it('不能重复投票', () => {
    let s = start(5);
    s = propose(s, s.players.slice(0, 2).map((p) => p.id));
    s = avalon.apply(s, { t: 'vote', approve: true }, s.players[0]!.id).state;
    expect(() =>
      avalon.apply(s, { t: 'vote', approve: false }, s.players[0]!.id),
    ).toThrow();
  });

  it('非任务队员不能投任务票', () => {
    let s = start(5);
    s = propose(s, s.players.slice(0, 2).map((p) => p.id));
    s = voteAll(s, true);
    const outsider = s.players.find((p) => !s.questTeam!.includes(p.id))!;
    expect(() => avalon.apply(s, { t: 'quest', vote: 'success' }, outsider.id)).toThrow();
  });

  it('好人不能投任务失败', () => {
    let s = start(5, 55);
    s = propose(s, s.players.slice(0, 2).map((p) => p.id));
    s = voteAll(s, true);
    const goodMember = s.questTeam!.find((id) => side(s, id) === 'good')!;
    expect(() => avalon.apply(s, { t: 'quest', vote: 'fail' }, goodMember)).toThrow();
  });

  it('非刺客不能执行刺杀', () => {
    let s = start(5);
    for (let m = 0; m < 3; m++) {
      const size = CONFIG[5]!.missionSizes[s.mission]!;
      s = playMission(s, s.players.slice(0, size).map((p) => p.id));
    }
    const nonAssassin = s.players.find((p) => s.roles[p.id] !== 'assassin')!;
    expect(() =>
      avalon.apply(s, { t: 'assassinate', target: s.players[0]!.id }, nonAssassin.id),
    ).toThrow();
  });

  it('终局后任何动作抛错', () => {
    let s = start(5);
    for (let m = 0; m < 3; m++) {
      const size = CONFIG[5]!.missionSizes[s.mission]!;
      s = playMission(s, s.players.slice(0, size).map((p) => p.id));
    }
    const assassin = s.players.find((p) => s.roles[p.id] === 'assassin')!;
    s = avalon.apply(s, { t: 'assassinate', target: s.players[0]!.id }, assassin.id).state;
    expect(() =>
      avalon.apply(s, { t: 'vote', approve: true }, s.players[0]!.id),
    ).toThrow();
  });
});
