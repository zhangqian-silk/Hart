import { describe, expect, it } from 'vitest';
import { seededRng } from '../../types.js';
import {
  doudizhu,
  identifyPlay,
  canBeat,
  cardKey,
  type Card,
  type DdzState,
  type DdzView,
  type LeadPlay,
  type PlayInfo,
  type Suit,
} from './index.js';

const players = [
  { id: 'A', name: '甲', seat: 0 },
  { id: 'B', name: '乙', seat: 1 },
  { id: 'C', name: '丙', seat: 2 },
];

const c = (rank: number, suit: Suit = 'spade'): Card => ({ rank, suit });

function startGame(seed = 42): DdzState {
  return doudizhu.start(players, {}, seededRng(seed));
}

/** 直接构造一个出牌阶段的状态（便于精确控制手牌） */
function mkPlaying(opts: {
  hands: Record<string, Card[]>;
  bottom?: Card[];
  landlord?: string;
  current?: string;
  lead?: LeadPlay;
  passCount?: number;
  landlordPlays?: number;
  farmerPlayed?: boolean;
}): DdzState {
  const s = startGame();
  return {
    ...s,
    phase: 'playing',
    hands: opts.hands,
    bottom: opts.bottom ?? [c(15, 'heart'), c(15, 'diamond'), c(15, 'club')],
    landlord: opts.landlord ?? 'A',
    current: opts.current ?? 'A',
    lead: opts.lead ?? null,
    passCount: opts.passCount ?? 0,
    trick: { A: null, B: null, C: null },
    landlordPlays: opts.landlordPlays ?? 0,
    farmerPlayed: opts.farmerPlayed ?? false,
  };
}

function play(s: DdzState, cards: Card[], from: string): DdzState {
  return doudizhu.apply(s, { t: 'play', cards }, from).state;
}

describe('斗地主 · 发牌', () => {
  it('3 人各 17 张，底牌 3 张，共 54 张不重复', () => {
    const s = startGame();
    expect(s.hands.A).toHaveLength(17);
    expect(s.hands.B).toHaveLength(17);
    expect(s.hands.C).toHaveLength(17);
    expect(s.bottom).toHaveLength(3);
    const all = [...s.hands.A!, ...s.hands.B!, ...s.hands.C!, ...s.bottom];
    expect(all).toHaveLength(54);
    expect(new Set(all.map(cardKey)).size).toBe(54);
  });

  it('开局进入叫分阶段', () => {
    const s = startGame();
    expect(s.phase).toBe('bidding');
    expect(s.bidIndex).toBeGreaterThanOrEqual(0);
    expect(s.bidIndex).toBeLessThan(3);
  });
});

describe('斗地主 · 叫分', () => {
  it('依次叫 1/2/3，叫 3 分者立即成为地主并拿底牌', () => {
    let s = startGame();
    const first = players[s.bidIndex]!.id;
    const second = players[(s.bidIndex + 1) % 3]!.id;
    const third = players[(s.bidIndex + 2) % 3]!.id;
    s = doudizhu.apply(s, { t: 'bid', score: 1 }, first).state;
    expect(s.highestBid).toBe(1);
    s = doudizhu.apply(s, { t: 'bid', score: 2 }, second).state;
    expect(s.highestBid).toBe(2);
    s = doudizhu.apply(s, { t: 'bid', score: 3 }, third).state;
    expect(s.phase).toBe('playing');
    expect(s.landlord).toBe(third);
    expect(s.current).toBe(third);
    expect(s.hands[third]).toHaveLength(20);
  });

  it('叫分必须高于当前最高分', () => {
    let s = startGame();
    const first = players[s.bidIndex]!.id;
    const second = players[(s.bidIndex + 1) % 3]!.id;
    s = doudizhu.apply(s, { t: 'bid', score: 2 }, first).state;
    expect(() => doudizhu.apply(s, { t: 'bid', score: 1 }, second)).toThrow();
    expect(() => doudizhu.apply(s, { t: 'bid', score: 2 }, second)).toThrow();
  });

  it('未轮到的玩家不能叫分', () => {
    const s = startGame();
    const notMe = players[(s.bidIndex + 1) % 3]!.id;
    expect(() => doudizhu.apply(s, { t: 'bid', score: 1 }, notMe)).toThrow();
  });

  it('三人叫完，最高者为地主', () => {
    let s = startGame();
    const first = players[s.bidIndex]!.id;
    const second = players[(s.bidIndex + 1) % 3]!.id;
    const third = players[(s.bidIndex + 2) % 3]!.id;
    s = doudizhu.apply(s, { t: 'bid', score: 1 }, first).state;
    s = doudizhu.apply(s, { t: 'bid', score: 0 }, second).state; // 不叫
    s = doudizhu.apply(s, { t: 'bid', score: 0 }, third).state;
    expect(s.phase).toBe('playing');
    expect(s.landlord).toBe(first);
    expect(s.hands[first]).toHaveLength(20);
  });

  it('全不叫则重新发牌', () => {
    let s = startGame();
    const before = s.hands.A!.map(cardKey).join(',');
    for (let i = 0; i < 3; i++) {
      s = doudizhu.apply(s, { t: 'bid', score: 0 }, players[s.bidIndex]!.id).state;
    }
    expect(s.phase).toBe('bidding');
    expect(s.dealCount).toBe(2);
    expect(s.highestBid).toBe(0);
    expect(s.hands.A).toHaveLength(17);
    const after = s.hands.A!.map(cardKey).join(',');
    expect(after).not.toBe(before);
  });
});

describe('斗地主 · 牌型识别', () => {
  const cases: [string, Card[], PlayInfo][] = [
    ['单张', [c(3)], { kind: 'single', mainRank: 3, length: 1 }],
    ['对子', [c(5), c(5, 'heart')], { kind: 'pair', mainRank: 5, length: 2 }],
    ['三张', [c(7), c(7, 'heart'), c(7, 'diamond')], { kind: 'triple', mainRank: 7, length: 3 }],
    ['三带一', [c(8), c(8, 'heart'), c(8, 'diamond'), c(3)], { kind: 'triple1', mainRank: 8, length: 4 }],
    ['三带二', [c(9), c(9, 'heart'), c(9, 'diamond'), c(4), c(4, 'heart')], { kind: 'triple2', mainRank: 9, length: 5 }],
    ['顺子', [c(3), c(4), c(5), c(6), c(7)], { kind: 'straight', mainRank: 7, length: 5 }],
    ['长顺子', [c(3), c(4), c(5), c(6), c(7), c(8), c(9), c(10), c(11), c(12), c(13), c(14)], { kind: 'straight', mainRank: 14, length: 12 }],
    ['连对', [c(3), c(3, 'heart'), c(4), c(4, 'heart'), c(5), c(5, 'heart')], { kind: 'pairs', mainRank: 5, length: 6 }],
    ['飞机', [c(3), c(3, 'heart'), c(3, 'diamond'), c(4), c(4, 'heart'), c(4, 'diamond')], { kind: 'plane', mainRank: 4, length: 6 }],
    ['飞机带单', [c(3), c(3, 'heart'), c(3, 'diamond'), c(4), c(4, 'heart'), c(4, 'diamond'), c(6), c(7)], { kind: 'plane1', mainRank: 4, length: 8 }],
    ['飞机带对', [c(3), c(3, 'heart'), c(3, 'diamond'), c(4), c(4, 'heart'), c(4, 'diamond'), c(6), c(6, 'heart'), c(7), c(7, 'heart')], { kind: 'plane2', mainRank: 4, length: 10 }],
    ['四带二', [c(5), c(5, 'heart'), c(5, 'diamond'), c(5, 'club'), c(3), c(7)], { kind: 'four2', mainRank: 5, length: 6 }],
    ['四带两对', [c(5), c(5, 'heart'), c(5, 'diamond'), c(5, 'club'), c(3), c(3, 'heart'), c(7), c(7, 'heart')], { kind: 'four22', mainRank: 5, length: 8 }],
    ['炸弹', [c(10), c(10, 'heart'), c(10, 'diamond'), c(10, 'club')], { kind: 'bomb', mainRank: 10, length: 4 }],
    ['火箭', [c(16, 'joker'), c(17, 'joker')], { kind: 'rocket', mainRank: 17, length: 2 }],
  ];
  for (const [name, cards, expected] of cases) {
    it(name, () => {
      expect(identifyPlay(cards)).toEqual(expected);
    });
  }

  it('非法牌型', () => {
    expect(identifyPlay([])).toBeNull();
    expect(identifyPlay([c(3), c(5)])).toBeNull(); // 两张不连
    expect(identifyPlay([c(3), c(4), c(5), c(6)])).toBeNull(); // 顺子不足 5 张
    expect(identifyPlay([c(3), c(4), c(5), c(6), c(15)])).toBeNull(); // 顺子含 2
    expect(identifyPlay([c(13), c(14), c(15), c(13, 'heart'), c(14, 'heart'), c(15, 'heart')])).toBeNull(); // 连对含 2
    expect(identifyPlay([c(3), c(3, 'heart'), c(3, 'diamond'), c(4), c(5)])).toBeNull(); // 三带二带的是两张散牌
    expect(identifyPlay([c(3), c(3, 'heart'), c(3, 'diamond'), c(4), c(4, 'heart'), c(4, 'diamond'), c(6), c(6, 'heart')])).toBeNull(); // 飞机带单却带了对子
  });
});

describe('斗地主 · 压牌', () => {
  const info = (cards: Card[]) => identifyPlay(cards)!;
  it('同型同长度比点数', () => {
    expect(canBeat(info([c(5)]), info([c(3)]))).toBe(true);
    expect(canBeat(info([c(3)]), info([c(5)]))).toBe(false);
    expect(canBeat(info([c(3), c(4), c(5), c(6), c(7)]), info([c(4), c(5), c(6), c(7), c(8)]))).toBe(false);
  });
  it('不同长度不能压', () => {
    expect(canBeat(info([c(3), c(4), c(5), c(6), c(7), c(8)]), info([c(3), c(4), c(5), c(6), c(7)]))).toBe(false);
  });
  it('炸弹压一切非炸弹非火箭', () => {
    expect(canBeat(info([c(3), c(3, 'heart'), c(3, 'diamond'), c(3, 'club')]), info([c(15)]))).toBe(true);
    expect(canBeat(info([c(3), c(3, 'heart'), c(3, 'diamond'), c(3, 'club')]), info([c(14), c(14, 'heart'), c(14, 'diamond'), c(14, 'club')]))).toBe(false);
    expect(canBeat(info([c(15), c(15, 'heart'), c(15, 'diamond'), c(15, 'club')]), info([c(14), c(14, 'heart'), c(14, 'diamond'), c(14, 'club')]))).toBe(true);
  });
  it('火箭最大', () => {
    const rocket = info([c(16, 'joker'), c(17, 'joker')]);
    expect(canBeat(rocket, info([c(15), c(15, 'heart'), c(15, 'diamond'), c(15, 'club')]))).toBe(true);
    expect(canBeat(info([c(15), c(15, 'heart'), c(15, 'diamond'), c(15, 'club')]), rocket)).toBe(false);
  });
});

describe('斗地主 · 出牌流程', () => {
  it('地主先出，逆时针轮转', () => {
    const s = mkPlaying({
      hands: {
        A: [c(3), c(5), c(7)],
        B: [c(4), c(6), c(8)],
        C: [c(9), c(10), c(11)],
      },
      landlord: 'A',
    });
    const s1 = play(s, [c(3)], 'A');
    expect(s1.current).toBe('B');
    expect(s1.lead?.by).toBe('A');
    const s2 = play(s1, [c(4)], 'B');
    expect(s2.current).toBe('C');
  });

  it('压不过要 throw', () => {
    const s = mkPlaying({
      hands: { A: [c(5)], B: [c(3)], C: [c(9)] },
      lead: { by: 'A', cards: [c(5)], info: identifyPlay([c(5)])! },
      current: 'B',
    });
    expect(() => play(s, [c(3)], 'B')).toThrow();
  });

  it('未轮到不能出牌', () => {
    const s = mkPlaying({ hands: { A: [c(3)], B: [c(4)], C: [c(5)] } });
    expect(() => play(s, [c(4)], 'B')).toThrow();
  });

  it('两家不出后，领出者自由出', () => {
    let s = mkPlaying({
      hands: { A: [c(3), c(15)], B: [c(4), c(6)], C: [c(5), c(7)] },
    });
    s = play(s, [c(3)], 'A'); // current B
    s = doudizhu.apply(s, { t: 'pass' }, 'B').state; // current C
    s = doudizhu.apply(s, { t: 'pass' }, 'C').state; // 回到 A
    expect(s.current).toBe('A');
    expect(s.lead).toBeNull();
    // A 可以出任意牌（不必压）
    s = play(s, [c(15)], 'A');
    expect(s.lead?.cards[0]?.rank).toBe(15);
  });

  it('领出者不能不出', () => {
    const s = mkPlaying({ hands: { A: [c(3)], B: [c(4)], C: [c(5)] } });
    expect(() => doudizhu.apply(s, { t: 'pass' }, 'A')).toThrow();
  });

  it('出的牌必须在手牌中', () => {
    const s = mkPlaying({ hands: { A: [c(3)], B: [c(4)], C: [c(5)] } });
    expect(() => play(s, [c(15)], 'A')).toThrow();
  });
});

describe('斗地主 · 胜负', () => {
  it('地主一把出完（飞机带对 20 张），地主胜且春天', () => {
    // 333 444 555 666 + 77 88 99 1010 = 12 + 8 = 20 张
    const landlordHand: Card[] = [
      ...[3, 4, 5, 6].flatMap((r) => [c(r), c(r, 'heart'), c(r, 'diamond')]),
      ...[7, 8, 9, 10].flatMap((r) => [c(r, 'club'), c(r, 'heart')]),
    ];
    expect(identifyPlay(landlordHand)?.kind).toBe('plane2');
    const s = mkPlaying({
      hands: { A: landlordHand, B: [c(11), c(12)], C: [c(13), c(14)] },
      bottom: [c(15, 'spade'), c(15, 'heart'), c(15, 'diamond')],
    });
    const s1 = play(s, landlordHand, 'A');
    expect(s1.phase).toBe('finished');
    expect(s1.winner).toBe('landlord');
    expect(s1.springType).toBe('spring');
    expect(doudizhu.result(s1)?.winners).toEqual(['A']);
  });

  it('农民出完，两农民同胜（反春天）', () => {
    // A(地主) 出 3♠ → B 火箭 → C 不出 → A 不出 → B 飞机带对出完
    const bHand: Card[] = [
      c(16, 'joker'), c(17, 'joker'),
      ...[3, 4, 5].flatMap((r) => [c(r, 'heart'), c(r, 'diamond'), c(r, 'club')]),
      ...[7, 8, 9].flatMap((r) => [c(r, 'heart'), c(r, 'diamond')]),
    ];
    expect(bHand).toHaveLength(17);
    const s = mkPlaying({
      hands: {
        A: [c(3), c(11), c(12)],
        B: bHand,
        C: [c(13), c(14), c(15, 'spade')],
      },
    });
    let cur = play(s, [c(3)], 'A'); // A 出 3
    cur = play(cur, [c(16, 'joker'), c(17, 'joker')], 'B'); // B 火箭
    cur = doudizhu.apply(cur, { t: 'pass' }, 'C').state;
    cur = doudizhu.apply(cur, { t: 'pass' }, 'A').state; // 回到 B
    const plane = bHand.slice(2); // 去掉火箭
    expect(identifyPlay(plane)?.kind).toBe('plane2');
    cur = play(cur, plane, 'B');
    expect(cur.phase).toBe('finished');
    expect(cur.winner).toBe('farmer');
    expect(cur.springType).toBe('anti-spring');
    expect(doudizhu.result(cur)?.winners).toEqual(['B', 'C']);
    expect(doudizhu.result(cur)?.teams?.['农民']).toEqual(['B', 'C']);
  });
});

describe('斗地主 · 视图', () => {
  it('叫分阶段：底牌隐藏，只能看到自己的手牌', () => {
    const s = startGame();
    const v = doudizhu.view(s, 'A') as unknown as DdzView;
    expect(v.phase).toBe('bidding');
    expect(v.bottom).toBeNull();
    expect(v.yourHand).toHaveLength(17);
    expect(v.players.find((p) => p.id === 'B')?.cardCount).toBe(17);
    // 视图中不泄露他人手牌（players 里只有 cardCount）
    expect(v.players.every((p) => !('hand' in p) && !('cards' in p))).toBe(true);
  });

  it('地主确定后：底牌对所有人亮明', () => {
    let s = startGame();
    for (let i = 0; i < 3; i++) {
      const id = players[s.bidIndex]!.id;
      s = doudizhu.apply(s, { t: 'bid', score: i === 0 ? 1 : 0 }, id).state;
      if (s.phase === 'playing') break;
    }
    expect(s.phase).toBe('playing');
    const v = doudizhu.view(s, 'B');
    expect(v.bottom).toHaveLength(3);
    expect(v.yourRole).toBe(s.landlord === 'B' ? 'landlord' : 'farmer');
  });

  it('结束后不能再操作', () => {
    const s = mkPlaying({
      hands: { A: [c(3)], B: [c(4)], C: [c(5)] },
    });
    const done = play(s, [c(3)], 'A'); // A 出完 → 地主胜
    expect(done.phase).toBe('finished');
    expect(() => doudizhu.apply(done, { t: 'play', cards: [c(4)] }, 'B')).toThrow();
  });
});
