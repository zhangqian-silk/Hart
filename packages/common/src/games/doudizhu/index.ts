/**
 * 斗地主（Doudizhu）
 * 3 人，54 张牌（含大小王），叫分抢地主，地主一打二，先出完者胜。
 */
import {
  registerGame,
  type GameDefinition,
  type GameView,
  type TurnInfo,
} from '../../framework.js';
import {
  shuffle,
  type GameEvent,
  type GameOptions,
  type GameResult,
  type PlayerId,
  type PlayerInfo,
  type Rng,
} from '../../types.js';

/* ---------------- 牌 ---------------- */

export type Suit = 'spade' | 'heart' | 'club' | 'diamond' | 'joker';

export interface Card {
  /** 3..15 普通牌（11=J 12=Q 13=K 14=A 15=2），16=小王，17=大王 */
  rank: number;
  suit: Suit;
}

export const RANK_LABELS: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
};

export const SUIT_SYMBOLS: Record<Exclude<Suit, 'joker'>, string> = {
  spade: '♠', heart: '♥', club: '♣', diamond: '♦',
};

const SUIT_ORDER: Record<Suit, number> = {
  spade: 0, heart: 1, club: 2, diamond: 3, joker: 4,
};

export function cardKey(c: Card): string {
  return `${c.rank}-${c.suit}`;
}

export function sortHand(cards: Card[]): Card[] {
  return [...cards].sort(
    (a, b) => a.rank - b.rank || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit],
  );
}

function buildDeck(): Card[] {
  const deck: Card[] = [];
  const suits: Suit[] = ['spade', 'heart', 'club', 'diamond'];
  for (let rank = 3; rank <= 15; rank++) {
    for (const suit of suits) deck.push({ rank, suit });
  }
  deck.push({ rank: 16, suit: 'joker' });
  deck.push({ rank: 17, suit: 'joker' });
  return deck;
}

/* ---------------- 牌型 ---------------- */

export type PlayKind =
  | 'single' | 'pair' | 'triple' | 'triple1' | 'triple2'
  | 'straight' | 'pairs' | 'plane' | 'plane1' | 'plane2'
  | 'four2' | 'four22' | 'bomb' | 'rocket';

export interface PlayInfo {
  kind: PlayKind;
  /** 主牌点数（比较大小用） */
  mainRank: number;
  /** 牌张数 */
  length: number;
}

export const PLAY_KIND_LABELS: Record<PlayKind, string> = {
  single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带二',
  straight: '顺子', pairs: '连对', plane: '飞机', plane1: '飞机带单', plane2: '飞机带对',
  four2: '四带二', four22: '四带两对', bomb: '炸弹', rocket: '火箭',
};

function isConsecutive(list: number[]): boolean {
  for (let i = 1; i < list.length; i++) {
    if (list[i] !== list[i - 1]! + 1) return false;
  }
  return true;
}

/** 识别牌型；非法牌型返回 null */
export function identifyPlay(cards: Card[]): PlayInfo | null {
  if (cards.length === 0) return null;
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);

  // 火箭：双王
  if (ranks.length === 2 && ranks[0] === 16 && ranks[1] === 17) {
    return { kind: 'rocket', mainRank: 17, length: 2 };
  }

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const rs = entries.map((e) => e[0]);
  const cs = entries.map((e) => e[1]);
  const total = cards.length;
  const maxR = rs[rs.length - 1]!;
  const allCount = (n: number) => cs.every((c) => c === n);
  const countOf = (n: number) => cs.filter((c) => c === n).length;

  // 炸弹
  if (total === 4 && allCount(4)) return { kind: 'bomb', mainRank: rs[0]!, length: 4 };
  // 单张
  if (total === 1) return { kind: 'single', mainRank: rs[0]!, length: 1 };
  // 对子
  if (total === 2 && allCount(2)) return { kind: 'pair', mainRank: rs[0]!, length: 2 };
  // 三张
  if (total === 3 && allCount(3)) return { kind: 'triple', mainRank: rs[0]!, length: 3 };
  // 三带一
  if (total === 4 && countOf(3) === 1 && countOf(1) === 1) {
    return { kind: 'triple1', mainRank: entries.find((e) => e[1] === 3)![0], length: 4 };
  }
  // 三带二
  if (total === 5 && countOf(3) === 1 && countOf(2) === 1) {
    return { kind: 'triple2', mainRank: entries.find((e) => e[1] === 3)![0], length: 5 };
  }
  // 顺子（≥5 张，3~A，不含 2/王）
  if (allCount(1) && total >= 5 && maxR <= 14 && isConsecutive(rs)) {
    return { kind: 'straight', mainRank: maxR, length: total };
  }
  // 连对（≥3 对，3~A）
  if (allCount(2) && rs.length >= 3 && maxR <= 14 && isConsecutive(rs)) {
    return { kind: 'pairs', mainRank: maxR, length: total };
  }
  // 飞机（纯，≥2 连三，3~A）
  if (allCount(3) && rs.length >= 2 && maxR <= 14 && isConsecutive(rs)) {
    return { kind: 'plane', mainRank: maxR, length: total };
  }
  // 飞机带翅膀
  const tRanks = entries.filter((e) => e[1] === 3).map((e) => e[0]);
  const wingCounts = entries.filter((e) => e[1] !== 3).map((e) => e[1]);
  if (tRanks.length >= 2 && isConsecutive(tRanks) && tRanks[tRanks.length - 1]! <= 14) {
    const n = tRanks.length;
    const top = tRanks[n - 1]!;
    // 飞机带单：n 连三 + n 张单牌
    if (total === 4 * n && wingCounts.length === n && wingCounts.every((c) => c === 1)) {
      return { kind: 'plane1', mainRank: top, length: total };
    }
    // 飞机带对：n 连三 + n 个对子
    if (total === 5 * n && wingCounts.length === n && wingCounts.every((c) => c === 2)) {
      return { kind: 'plane2', mainRank: top, length: total };
    }
  }
  // 四带二（4 张 + 2 张单牌）
  if (total === 6 && countOf(4) === 1 && countOf(1) === 2) {
    return { kind: 'four2', mainRank: entries.find((e) => e[1] === 4)![0], length: 6 };
  }
  // 四带两对（4 张 + 2 个对子）
  if (total === 8 && countOf(4) === 1 && countOf(2) === 2) {
    return { kind: 'four22', mainRank: entries.find((e) => e[1] === 4)![0], length: 8 };
  }
  return null;
}

/** play 能否压过 lead */
export function canBeat(play: PlayInfo, lead: PlayInfo): boolean {
  if (play.kind === 'rocket') return true;
  if (lead.kind === 'rocket') return false;
  if (play.kind === 'bomb') {
    if (lead.kind !== 'bomb') return true;
    return play.mainRank > lead.mainRank;
  }
  if (play.kind !== lead.kind) return false;
  if (play.length !== lead.length) return false;
  return play.mainRank > lead.mainRank;
}

/* ---------------- 状态 ---------------- */

export type DdzPhase = 'bidding' | 'playing' | 'finished';

export interface LeadPlay {
  by: PlayerId;
  cards: Card[];
  info: PlayInfo;
}

export interface DdzState {
  players: PlayerInfo[];
  hands: Record<PlayerId, Card[]>;
  /** 底牌 3 张 */
  bottom: Card[];
  phase: DdzPhase;
  /** 叫分：当前轮到的玩家下标 */
  bidIndex: number;
  /** 叫分记录（按时间） */
  bidLog: { id: PlayerId; score: number }[];
  highestBid: number;
  highestBidder: PlayerId | null;
  bidsMade: number;
  landlord: PlayerId | null;
  /** 出牌阶段当前行动者 */
  current: PlayerId | null;
  /** 桌面上待压的牌（null 表示自由出） */
  lead: LeadPlay | null;
  /** 连续不出人数 */
  passCount: number;
  /** 本轮各家最近一次出牌（null=不出） */
  trick: Record<PlayerId, Card[] | null>;
  winner: 'landlord' | 'farmer' | null;
  springType: 'spring' | 'anti-spring' | null;
  /** 地主出牌次数（反春判定） */
  landlordPlays: number;
  /** 农民是否出过牌（春天判定） */
  farmerPlayed: boolean;
  /** 发牌次数（全不叫重发） */
  dealCount: number;
}

export type DdzAction =
  | { t: 'bid'; score: 0 | 1 | 2 | 3 }
  | { t: 'play'; cards: Card[] }
  | { t: 'pass' };

export interface DdzView extends GameView {
  game: 'doudizhu';
  phase: DdzPhase;
  you: PlayerId;
  yourHand: Card[];
  yourRole: 'landlord' | 'farmer' | null;
  players: {
    id: PlayerId;
    name: string;
    seat: number;
    role: 'landlord' | 'farmer' | null;
    cardCount: number;
    current: boolean;
  }[];
  /** 底牌（叫分阶段隐藏） */
  bottom: Card[] | null;
  bottomCount: number;
  highestBid: number;
  highestBidder: PlayerId | null;
  bidLog: { id: PlayerId; name: string; score: number }[];
  bidCurrent: PlayerId | null;
  lead: { by: PlayerId; name: string; cards: Card[]; kind: PlayKind } | null;
  trick: { id: PlayerId; name: string; cards: Card[] | null }[];
  current: PlayerId | null;
  winner: 'landlord' | 'farmer' | null;
  springType: 'spring' | 'anti-spring' | null;
  dealCount: number;
}

/* ---------------- 引擎 ---------------- */

function nextOf(state: DdzState, id: PlayerId): PlayerId {
  const i = state.players.findIndex((p) => p.id === id);
  return state.players[(i + 1) % state.players.length]!.id;
}

function emptyTrick(players: PlayerInfo[]): Record<PlayerId, Card[] | null> {
  const t: Record<PlayerId, Card[] | null> = {};
  for (const p of players) t[p.id] = null;
  return t;
}

function dealCards(
  players: PlayerInfo[],
  rng: Rng,
): { hands: Record<PlayerId, Card[]>; bottom: Card[] } {
  const deck = shuffle(buildDeck(), rng);
  const hands: Record<PlayerId, Card[]> = {};
  players.forEach((p, i) => {
    hands[p.id] = sortHand(deck.slice(i * 17, i * 17 + 17));
  });
  return { hands, bottom: deck.slice(51, 54) };
}

function freshBidding(
  players: PlayerInfo[],
  rng: Rng,
  dealCount: number,
): Pick<DdzState, 'hands' | 'bottom' | 'phase' | 'bidIndex' | 'bidLog' | 'highestBid' | 'highestBidder' | 'bidsMade' | 'landlord' | 'current' | 'lead' | 'passCount' | 'trick' | 'dealCount'> {
  const { hands, bottom } = dealCards(players, rng);
  return {
    hands,
    bottom,
    phase: 'bidding',
    bidIndex: Math.floor(rng() * players.length),
    bidLog: [],
    highestBid: 0,
    highestBidder: null,
    bidsMade: 0,
    landlord: null,
    current: null,
    lead: null,
    passCount: 0,
    trick: emptyTrick(players),
    dealCount,
  };
}

export const doudizhu: GameDefinition<DdzState, DdzAction> = {
  meta: {
    id: 'doudizhu',
    name: '斗地主',
    tagline: '三人经典，争当地主',
    minPlayers: 3,
    maxPlayers: 3,
    theme: '#3b82f6',
    rules: [
      '## 斗地主',
      '',
      '3 人使用 54 张牌（含大小王），每人 17 张，底牌 3 张。',
      '',
      '### 叫分',
      '依次叫 0/1/2/3 分（只能比当前最高分高或不叫），最高者为地主并拿走底牌（亮明）。',
      '叫到 3 分立即结束叫分；三人全不叫则重新发牌。',
      '',
      '### 出牌',
      '地主先出，逆时针轮流出牌，可出「不出」。牌型：单张、对子、三张、三带一、三带二、',
      '顺子（≥5 张，3~A）、连对（≥3 对，3~A）、飞机（≥2 连三，可带同数量单张或对子）、',
      '四带二、四带两对、炸弹、火箭（双王）。',
      '',
      '### 压牌',
      '同型同长度比点数；炸弹压一切非炸弹非火箭，大炸压小炸；火箭最大。',
      '',
      '### 胜负',
      '先出完牌者胜：地主出完则地主独胜，农民出完则两农民同胜。',
    ].join('\n'),
  },
  id: 'doudizhu',
  minPlayers: 3,
  maxPlayers: 3,
  defaultOptions: {},

  start(players: PlayerInfo[], _options: GameOptions, rng: Rng): DdzState {
    const sorted = [...players].sort((a, b) => a.seat - b.seat);
    return {
      players: sorted,
      ...freshBidding(sorted, rng, 1),
      winner: null,
      springType: null,
      landlordPlays: 0,
      farmerPlayed: false,
    };
  },

  apply(state, action, from) {
    if (state.phase === 'finished') throw new Error('对局已结束');
    if (action.t === 'bid') return applyBid(state, action, from);
    if (action.t === 'play') return applyPlay(state, action, from);
    if (action.t === 'pass') return applyPass(state, from);
    throw new Error('未知动作');
  },

  view(state, viewer): DdzView {
    const me = state.players.find((p) => p.id === viewer);
    const myRole = state.landlord
      ? viewer === state.landlord
        ? 'landlord'
        : 'farmer'
      : null;
    const nameOf = (id: PlayerId) =>
      state.players.find((p) => p.id === id)?.name ?? id;
    return {
      game: 'doudizhu',
      phase: state.phase,
      you: viewer,
      yourHand: me ? state.hands[viewer]! : [],
      yourRole: myRole,
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        role: state.landlord
          ? p.id === state.landlord
            ? 'landlord'
            : 'farmer'
          : null,
        cardCount: state.hands[p.id]!.length,
        current: state.current === p.id,
      })),
      bottom: state.phase === 'bidding' ? null : state.bottom,
      bottomCount: state.bottom.length,
      highestBid: state.highestBid,
      highestBidder: state.highestBidder,
      bidLog: state.bidLog.map((b) => ({ ...b, name: nameOf(b.id) })),
      bidCurrent:
        state.phase === 'bidding'
          ? state.players[state.bidIndex]!.id
          : null,
      lead: state.lead
        ? {
            by: state.lead.by,
            name: nameOf(state.lead.by),
            cards: state.lead.cards,
            kind: state.lead.info.kind,
          }
        : null,
      trick: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        cards: state.trick[p.id] ?? null,
      })),
      current: state.current,
      winner: state.winner,
      springType: state.springType,
      dealCount: state.dealCount,
    };
  },

  turn(state): TurnInfo {
    if (state.phase === 'finished') {
      return { active: [], phase: 'finished', hint: '对局结束' };
    }
    if (state.phase === 'bidding') {
      const p = state.players[state.bidIndex]!;
      return {
        active: [p.id],
        phase: 'bidding',
        hint:
          state.highestBid > 0
            ? `轮到 ${p.name} 叫分（当前最高 ${state.highestBid} 分）`
            : `轮到 ${p.name} 叫分`,
      };
    }
    const p = state.players.find((pl) => pl.id === state.current)!;
    return {
      active: state.current ? [state.current] : [],
      phase: 'playing',
      hint: state.lead
        ? `轮到 ${p.name} 出牌（可出更大的牌或不出）`
        : `轮到 ${p.name} 出牌`,
    };
  },

  result(state): GameResult | null {
    if (!state.winner || !state.landlord) return null;
    const farmers = state.players.filter((p) => p.id !== state.landlord).map((p) => p.id);
    const landlordWin = state.winner === 'landlord';
    return {
      winners: landlordWin ? [state.landlord] : farmers,
      teams: {
        地主: [state.landlord],
        农民: farmers,
      },
      reason:
        (landlordWin ? '地主出完手牌' : '农民出完手牌') +
        (state.springType === 'spring'
          ? '（春天）'
          : state.springType === 'anti-spring'
            ? '（反春天）'
            : ''),
    };
  },
};

/* ---------------- 动作处理 ---------------- */

function applyBid(
  state: DdzState,
  action: { t: 'bid'; score: 0 | 1 | 2 | 3 },
  from: PlayerId,
): { state: DdzState; events: GameEvent[] } {
  if (state.phase !== 'bidding') throw new Error('当前不是叫分阶段');
  const expected = state.players[state.bidIndex]!.id;
  if (from !== expected) throw new Error('还没轮到你叫分');
  const score = action.score;
  if (score !== 0 && score <= state.highestBid) {
    throw new Error('叫分必须高于当前最高分');
  }

  const events: GameEvent[] = [{ type: 'bid', from, score }];
  const highestBid = score > state.highestBid ? score : state.highestBid;
  const highestBidder = score > state.highestBid ? from : state.highestBidder;
  const bidsMade = state.bidsMade + 1;
  const bidLog = [...state.bidLog, { id: from, score }];

  const settled = score === 3 || bidsMade >= state.players.length;
  if (!settled) {
    return {
      state: {
        ...state,
        bidIndex: (state.bidIndex + 1) % state.players.length,
        bidLog,
        highestBid,
        highestBidder,
        bidsMade,
      },
      events,
    };
  }

  // 全不叫：重新发牌
  if (!highestBidder) {
    const fresh = freshBidding(state.players, Math.random, state.dealCount + 1);
    return {
      state: {
        ...state,
        ...fresh,
        winner: null,
        springType: null,
        landlordPlays: 0,
        farmerPlayed: false,
      },
      events: [...events, { type: 'redeal' }],
    };
  }

  // 地主确定：拿底牌，亮明
  const landlordHand = sortHand([
    ...state.hands[highestBidder]!,
    ...state.bottom,
  ]);
  return {
    state: {
      ...state,
      phase: 'playing',
      bidLog,
      highestBid,
      highestBidder,
      bidsMade,
      landlord: highestBidder,
      current: highestBidder,
      hands: { ...state.hands, [highestBidder]: landlordHand },
      trick: emptyTrick(state.players),
    },
    events: [...events, { type: 'landlord', player: highestBidder, score: highestBid }],
  };
}

function applyPlay(
  state: DdzState,
  action: { t: 'play'; cards: Card[] },
  from: PlayerId,
): { state: DdzState; events: GameEvent[] } {
  if (state.phase !== 'playing') throw new Error('当前不是出牌阶段');
  if (from !== state.current) throw new Error('还没轮到你出牌');
  const hand = state.hands[from]!;
  const selected = action.cards;
  if (!selected || selected.length === 0) throw new Error('请选择要出的牌');
  const handSet = new Set(hand.map(cardKey));
  for (const c of selected) {
    if (!handSet.has(cardKey(c))) throw new Error('手牌中没有这些牌');
  }
  const info = identifyPlay(selected);
  if (!info) throw new Error('牌型不合法');
  if (state.lead && !canBeat(info, state.lead.info)) {
    throw new Error('压不过上家的牌');
  }

  const removeKeys = new Set(selected.map(cardKey));
  const newHand = hand.filter((c) => !removeKeys.has(cardKey(c)));
  const isLandlord = from === state.landlord;
  const won = newHand.length === 0;

  let winner: DdzState['winner'] = state.winner;
  let springType = state.springType;
  if (won) {
    winner = isLandlord ? 'landlord' : 'farmer';
    if (isLandlord && !state.farmerPlayed) springType = 'spring';
    if (!isLandlord && state.landlordPlays <= 1) springType = 'anti-spring';
  }

  const next: DdzState = {
    ...state,
    hands: { ...state.hands, [from]: newHand },
    lead: { by: from, cards: selected, info },
    passCount: 0,
    trick: { ...state.trick, [from]: selected },
    current: won ? null : nextOf(state, from),
    landlordPlays: state.landlordPlays + (isLandlord ? 1 : 0),
    farmerPlayed: state.farmerPlayed || !isLandlord,
    phase: won ? 'finished' : 'playing',
    winner,
    springType,
  };
  const events: GameEvent[] = [
    { type: 'play', from, cards: selected, kind: info.kind },
    ...(won ? [{ type: 'win', side: winner, springType } as GameEvent] : []),
  ];
  return { state: next, events };
}

function applyPass(
  state: DdzState,
  from: PlayerId,
): { state: DdzState; events: GameEvent[] } {
  if (state.phase !== 'playing') throw new Error('当前不是出牌阶段');
  if (from !== state.current) throw new Error('还没轮到你');
  if (!state.lead || state.lead.by === from) {
    throw new Error('你必须出牌（不能不出）');
  }
  const passCount = state.passCount + 1;
  const twoPassed = passCount >= 2;
  const next: DdzState = twoPassed
    ? {
        ...state,
        passCount: 0,
        lead: null,
        trick: emptyTrick(state.players),
        current: nextOf(state, from),
      }
    : {
        ...state,
        passCount,
        trick: { ...state.trick, [from]: null },
        current: nextOf(state, from),
      };
  return { state: next, events: [{ type: 'pass', from }] };
}

registerGame(doudizhu);
