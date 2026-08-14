import { useEffect, useMemo, useState } from 'react';
import type { GameId } from '@hart/common';
import { registerGameUI, type GameUIProps } from '../types';
import { Avatar, Badge } from '../../ui';

/* ------------------------------------------------------------------ */
/* 视图类型（与 @hart/common 中斗地主 view 保持一致，本地声明避免跨包深引用） */
/* ------------------------------------------------------------------ */

type Suit = 'spade' | 'heart' | 'club' | 'diamond' | 'joker';

interface CardT {
  rank: number;
  suit: Suit;
}

type PlayKind =
  | 'single' | 'pair' | 'triple' | 'triple1' | 'triple2'
  | 'straight' | 'pairs' | 'plane' | 'plane1' | 'plane2'
  | 'four2' | 'four22' | 'bomb' | 'rocket';

interface DdzPlayer {
  id: string;
  name: string;
  seat: number;
  role: 'landlord' | 'farmer' | null;
  cardCount: number;
  current: boolean;
}

interface DdzView {
  game: 'doudizhu';
  phase: 'bidding' | 'playing' | 'finished';
  you: string;
  yourHand: CardT[];
  yourRole: 'landlord' | 'farmer' | null;
  players: DdzPlayer[];
  bottom: CardT[] | null;
  bottomCount: number;
  highestBid: number;
  highestBidder: string | null;
  bidLog: { id: string; name: string; score: number }[];
  bidCurrent: string | null;
  lead: { by: string; name: string; cards: CardT[]; kind: PlayKind } | null;
  trick: { id: string; name: string; cards: CardT[] | null }[];
  current: string | null;
  winner: 'landlord' | 'farmer' | null;
  springType: 'spring' | 'anti-spring' | null;
  dealCount: number;
}

/* ------------------------------------------------------------------ */
/* 牌型识别（UI 提示用，与服务端逻辑一致；服务端为权威）                    */
/* ------------------------------------------------------------------ */

const RANK_LABELS: Record<number, string> = {
  3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王',
};

const SUIT_SYMBOLS: Record<Exclude<Suit, 'joker'>, string> = {
  spade: '♠', heart: '♥', club: '♣', diamond: '♦',
};

const KIND_LABELS: Record<PlayKind, string> = {
  single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带二',
  straight: '顺子', pairs: '连对', plane: '飞机', plane1: '飞机带单', plane2: '飞机带对',
  four2: '四带二', four22: '四带两对', bomb: '炸弹', rocket: '火箭',
};

interface PlayInfo {
  kind: PlayKind;
  mainRank: number;
  length: number;
}

function isConsecutive(list: number[]): boolean {
  for (let i = 1; i < list.length; i++) {
    if (list[i] !== list[i - 1]! + 1) return false;
  }
  return true;
}

function identifyPlay(cards: CardT[]): PlayInfo | null {
  if (cards.length === 0) return null;
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
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

  if (total === 4 && allCount(4)) return { kind: 'bomb', mainRank: rs[0]!, length: 4 };
  if (total === 1) return { kind: 'single', mainRank: rs[0]!, length: 1 };
  if (total === 2 && allCount(2)) return { kind: 'pair', mainRank: rs[0]!, length: 2 };
  if (total === 3 && allCount(3)) return { kind: 'triple', mainRank: rs[0]!, length: 3 };
  if (total === 4 && countOf(3) === 1 && countOf(1) === 1) {
    return { kind: 'triple1', mainRank: entries.find((e) => e[1] === 3)![0], length: 4 };
  }
  if (total === 5 && countOf(3) === 1 && countOf(2) === 1) {
    return { kind: 'triple2', mainRank: entries.find((e) => e[1] === 3)![0], length: 5 };
  }
  if (allCount(1) && total >= 5 && maxR <= 14 && isConsecutive(rs)) {
    return { kind: 'straight', mainRank: maxR, length: total };
  }
  if (allCount(2) && rs.length >= 3 && maxR <= 14 && isConsecutive(rs)) {
    return { kind: 'pairs', mainRank: maxR, length: total };
  }
  if (allCount(3) && rs.length >= 2 && maxR <= 14 && isConsecutive(rs)) {
    return { kind: 'plane', mainRank: maxR, length: total };
  }
  const tRanks = entries.filter((e) => e[1] === 3).map((e) => e[0]);
  const wingCounts = entries.filter((e) => e[1] !== 3).map((e) => e[1]);
  if (tRanks.length >= 2 && isConsecutive(tRanks) && tRanks[tRanks.length - 1]! <= 14) {
    const n = tRanks.length;
    const top = tRanks[n - 1]!;
    if (total === 4 * n && wingCounts.length === n && wingCounts.every((c) => c === 1)) {
      return { kind: 'plane1', mainRank: top, length: total };
    }
    if (total === 5 * n && wingCounts.length === n && wingCounts.every((c) => c === 2)) {
      return { kind: 'plane2', mainRank: top, length: total };
    }
  }
  if (total === 6 && countOf(4) === 1 && countOf(1) === 2) {
    return { kind: 'four2', mainRank: entries.find((e) => e[1] === 4)![0], length: 6 };
  }
  if (total === 8 && countOf(4) === 1 && countOf(2) === 2) {
    return { kind: 'four22', mainRank: entries.find((e) => e[1] === 4)![0], length: 8 };
  }
  return null;
}

function canBeat(play: PlayInfo, lead: PlayInfo): boolean {
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

function cardKey(c: CardT): string {
  return `${c.rank}-${c.suit}`;
}

function isRed(c: CardT): boolean {
  return c.suit === 'heart' || c.suit === 'diamond' || c.rank === 17;
}

/* ------------------------------------------------------------------ */
/* 扑克牌（纯 CSS 绘制）                                                 */
/* ------------------------------------------------------------------ */

type CardSize = 'hand' | 'lead' | 'mini';

const SIZE_CLS: Record<CardSize, string> = {
  hand: 'w-[58px] h-[84px] rounded-lg',
  lead: 'w-[50px] h-[72px] rounded-md',
  mini: 'w-[32px] h-[46px] rounded',
};

function PlayingCard({
  card,
  size = 'hand',
  selected,
  dimmed,
  onClick,
}: {
  card: CardT;
  size?: CardSize;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const red = isRed(card);
  const color = red ? 'text-rose-600' : 'text-slate-900';
  const joker = card.rank >= 16;
  const big = size === 'hand';
  return (
    <div
      onClick={onClick}
      className={`relative bg-gradient-to-br from-white to-slate-50 border shadow-lg select-none flex flex-col transition-all duration-150 ${SIZE_CLS[size]} ${
        selected ? 'border-blue-400 ring-2 ring-blue-400/70 -translate-y-2' : 'border-slate-300'
      } ${dimmed ? 'opacity-60' : ''} ${onClick ? 'cursor-pointer hover:-translate-y-2 hover:shadow-xl' : ''}`}
      style={{
        boxShadow: selected
          ? '0 8px 25px rgba(59,130,246,0.4), 0 2px 8px rgba(0,0,0,0.2)'
          : '0 2px 8px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)',
      }}
    >
      {joker ? (
        <>
          <div className={`px-1 pt-0.5 text-[10px] font-bold leading-tight ${color}`}>
            {RANK_LABELS[card.rank]}
          </div>
          <div className={`flex-1 flex items-center justify-center font-bold ${color} ${big ? 'text-3xl' : 'text-xl'}`}>
            王
          </div>
        </>
      ) : (
        <>
          <div className={`px-1 pt-0.5 font-bold leading-none ${color} ${big ? 'text-sm' : 'text-[10px]'}`}>
            <div>{RANK_LABELS[card.rank]}</div>
            <div className={big ? 'text-sm' : 'text-[10px]'}>{SUIT_SYMBOLS[card.suit as Exclude<Suit, 'joker'>]}</div>
          </div>
          <div className={`flex-1 flex items-center justify-center ${color} ${big ? 'text-2xl' : 'text-base'}`}>
            {SUIT_SYMBOLS[card.suit as Exclude<Suit, 'joker'>]}
          </div>
        </>
      )}
    </div>
  );
}

function CardBack({ size = 'mini' }: { size?: CardSize }) {
  return (
    <div className={`${SIZE_CLS[size]} border border-blue-200/40 shadow-md`}
      style={{
        background:
          'repeating-linear-gradient(45deg, #1d4ed8 0 6px, #1e40af 6px 12px)',
      }}
    >
      <div className="w-full h-full rounded-[inherit] border border-white/20" />
    </div>
  );
}

/** 扇形/弧形手牌 */
function HandFan({
  cards,
  selected,
  onToggle,
}: {
  cards: CardT[];
  selected: ReadonlySet<string>;
  onToggle: (c: CardT) => void;
}) {
  const n = cards.length;
  const mid = (n - 1) / 2;
  return (
    <div className="flex justify-center items-end" style={{ minHeight: 104, maxWidth: '100%' }}>
      {cards.map((card, i) => {
        const off = i - mid;
        const isSel = selected.has(cardKey(card));
        const arc = Math.pow(Math.abs(off), 1.7) * 2.2;
        const transform = `rotate(${off * 2.1}deg) translateY(${arc}px)${isSel ? ' translateY(-18px)' : ''}`;
        return (
          <div
            key={cardKey(card)}
            className="shrink-0"
            style={{
              marginLeft: i === 0 ? 0 : -26,
              transform,
              zIndex: isSel ? 30 : i,
              transformOrigin: '50% 130%',
            }}
          >
            <PlayingCard card={card} size="hand" selected={isSel} onClick={() => onToggle(card)} />
          </div>
        );
      })}
    </div>
  );
}

/** 小型重叠牌列（出牌区/对手面前） */
function MiniFan({ cards, size = 'lead' }: { cards: CardT[]; size?: CardSize }) {
  const overlap = size === 'mini' ? -16 : -22;
  return (
    <div className="flex items-center" style={{ maxWidth: 320 }}>
      {cards.map((card, i) => (
        <div key={cardKey(card)} className="shrink-0" style={{ marginLeft: i === 0 ? 0 : overlap, zIndex: i }}>
          <PlayingCard card={card} size={size} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 座位面板（对手）                                                      */
/* ------------------------------------------------------------------ */

function SeatPanel({
  p,
  trickCards,
  passed,
}: {
  p: DdzPlayer;
  trickCards: CardT[] | null;
  passed: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-1.5 transition-transform ${p.current ? 'scale-105' : ''}`}>
      <div className={`relative rounded-full p-0.5 ${p.current ? 'ring-2 ring-blue-300 shadow-lg shadow-blue-400/40' : ''}`}>
        <Avatar name={p.name} size={52} />
        {p.role && (
          <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] px-1.5 py-px rounded-full font-bold ${
            p.role === 'landlord' ? 'bg-amber-400 text-black' : 'bg-emerald-500/90 text-white'
          }`}>
            {p.role === 'landlord' ? '地主' : '农民'}
          </span>
        )}
      </div>
      <div className="text-xs text-slate-200 font-medium">{p.name}</div>
      <div className="flex items-center gap-1 text-[11px] text-slate-300">
        <CardBack />
        <span>× {p.cardCount}</span>
      </div>
      <div className="h-12 flex items-end">
        {trickCards ? (
          <MiniFan cards={trickCards} size="mini" />
        ) : passed ? (
          <span className="text-xs text-slate-400 bg-white/5 px-2 py-0.5 rounded-full">不出</span>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 主组件                                                               */
/* ------------------------------------------------------------------ */

function DoudizhuUI({ view, turn, result, me, send }: GameUIProps) {
  const v = view as unknown as DdzView;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // 切换视角/回合变化时清空选择
  useEffect(() => {
    setSelected(new Set());
  }, [me, v.phase, v.current, v.bidCurrent]);

  const myHand = v.yourHand;
  const selCards = useMemo(
    () => myHand.filter((c) => selected.has(cardKey(c))),
    [myHand, selected],
  );
  const selInfo = selCards.length > 0 ? identifyPlay(selCards) : null;
  const leadInfo = v.lead ? identifyPlay(v.lead.cards) : null;

  const myBidTurn = v.phase === 'bidding' && v.bidCurrent === me;
  const myPlayTurn = v.phase === 'playing' && v.current === me;
  const canPass = myPlayTurn && !!v.lead && v.lead.by !== me;
  const canPlay =
    myPlayTurn &&
    selCards.length > 0 &&
    !!selInfo &&
    (!v.lead || (leadInfo ? canBeat(selInfo, leadInfo) : false));

  const toggle = (c: CardT) => {
    if (!myPlayTurn) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cardKey(c))) next.delete(cardKey(c));
      else next.add(cardKey(c));
      return next;
    });
  };

  const opponents = v.players.filter((p) => p.id !== me);
  const trickOf = (id: string) => v.trick.find((t) => t.id === id)?.cards ?? null;

  // 判断某玩家本回合是否已「不出」（lead 存在、未出牌、且行动顺序已过）
  const passedSet = useMemo(() => {
    const set = new Set<string>();
    if (v.lead && v.current) {
      const order = v.players.map((p) => p.id);
      const start = order.indexOf(v.lead.by);
      const cur = order.indexOf(v.current);
      for (const p of v.players) {
        if (p.id === v.lead.by) continue;
        const pos = (order.indexOf(p.id) - start + order.length) % order.length;
        const posCur = (cur - start + order.length) % order.length;
        if (pos < posCur && trickOf(p.id) === null) set.add(p.id);
      }
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.lead, v.current, v.trick, v.players]);

  const currentName =
    v.players.find((p) => p.id === v.current)?.name ??
    v.players.find((p) => p.id === v.bidCurrent)?.name ??
    '';

  /* 提示文案 */
  let hint = turn.hint ?? '';
  if (v.phase === 'playing' && myPlayTurn) {
    if (selCards.length === 0) hint = '请选择要出的牌';
    else if (!selInfo) hint = `已选 ${selCards.length} 张：牌型不合法`;
    else {
      hint = `${KIND_LABELS[selInfo.kind]}（${selCards.length} 张）`;
      if (v.lead) hint += leadInfo && canBeat(selInfo, leadInfo) ? ' · 可压' : ' · 管不上';
    }
  } else if (v.phase === 'playing' && !result) {
    hint = `等待 ${currentName} 出牌…`;
  }

  const iWon = result ? result.winners.includes(me) : false;

  return (
    <div className="w-full max-w-6xl select-none">
      {/* 顶部状态 */}
      <div className="text-center text-sm text-slate-300 h-6 mb-2">{result ? '' : hint}</div>

      {/* 牌桌 */}
      <div
        className="relative rounded-3xl overflow-hidden border border-white/10 shadow-2xl"
        style={{
          height: 600,
          background:
            'radial-gradient(ellipse 90% 80% at 50% 35%, #16635a 0%, #0e4a44 45%, #082f2c 100%)',
          boxShadow: 'inset 0 0 80px rgba(0,0,0,0.45), 0 24px 70px rgba(0,0,0,0.55)',
        }}
      >
        {/* 对手 */}
        <div className="absolute top-4 left-5 z-10">
          {opponents[0] && (
            <SeatPanel p={opponents[0]} trickCards={trickOf(opponents[0].id)} passed={passedSet.has(opponents[0].id)} />
          )}
        </div>
        <div className="absolute top-4 right-5 z-10">
          {opponents[1] && (
            <SeatPanel p={opponents[1]} trickCards={trickOf(opponents[1].id)} passed={passedSet.has(opponents[1].id)} />
          )}
        </div>

        {/* 中央区域 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-4">
          {v.phase === 'bidding' && (
            <div className="flex flex-col items-center gap-3">
              <div className="text-slate-200/90 text-sm tracking-widest">叫 分 阶 段</div>
              <div className="flex items-center gap-2">
                {v.bidLog.length === 0 ? (
                  <span className="text-slate-400 text-xs">等待 {currentName} 叫分…</span>
                ) : (
                  v.bidLog.map((b) => (
                    <span key={b.id} className="text-xs px-2.5 py-1 rounded-full bg-white/10 text-slate-200">
                      {b.name} {b.score === 0 ? '不叫' : `${b.score} 分`}
                    </span>
                  ))
                )}
              </div>
              {v.highestBid > 0 && (
                <div className="text-amber-300 text-xs">当前最高 {v.highestBid} 分</div>
              )}
            </div>
          )}

          {v.phase !== 'bidding' && (
            <div className="flex flex-col items-center gap-3">
              {/* 底牌 */}
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-300/80 mr-1">底牌</span>
                {v.bottom
                  ? v.bottom.map((c) => <PlayingCard key={cardKey(c)} card={c} size="mini" />)
                  : Array.from({ length: v.bottomCount }).map((_, i) => <CardBack key={i} />)}
              </div>
              {/* 出牌区 */}
              {v.lead ? (
                <div className="flex flex-col items-center gap-1.5 mt-1">
                  <MiniFan cards={v.lead.cards} />
                  <span className="text-[11px] text-slate-300">
                    {v.lead.name} · {KIND_LABELS[v.lead.kind]}
                  </span>
                </div>
              ) : (
                <div className="h-[72px] flex items-center text-slate-300/70 text-sm mt-1">
                  {v.phase === 'playing' ? `该 ${currentName} 出牌` : ''}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 我的座位信息（左下） */}
        <div className="absolute bottom-3 left-5 z-10 flex items-center gap-2">
          <div className={`relative rounded-full p-0.5 ${myPlayTurn ? 'ring-2 ring-blue-300 shadow-lg shadow-blue-400/40' : ''}`}>
            <Avatar name={v.players.find((p) => p.id === me)?.name ?? '我'} size={44} />
            {v.yourRole && (
              <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] px-1.5 py-px rounded-full font-bold ${
                v.yourRole === 'landlord' ? 'bg-amber-400 text-black' : 'bg-emerald-500/90 text-white'
              }`}>
                {v.yourRole === 'landlord' ? '地主' : '农民'}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-slate-200">
              {v.players.find((p) => p.id === me)?.name ?? '我'}（你）
            </span>
            <span className="text-[11px] text-slate-400">剩余 {myHand.length} 张</span>
          </div>
        </div>

        {/* 底部：按钮 + 手牌 */}
        <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center gap-1.5 pb-2 z-20">
          <div className="h-9 flex items-center gap-2">
            {myBidTurn && (
              <>
                {[1, 2, 3].map((score) => (
                  <button
                    key={score}
                    disabled={score <= v.highestBid}
                    className="btn bg-blue-500 hover:bg-blue-400 text-white text-sm px-4 py-1.5 shadow-lg shadow-blue-500/25"
                    onClick={() => send({ t: 'bid', score })}
                  >
                    {score} 分
                  </button>
                ))}
                <button
                  className="btn bg-white/10 hover:bg-white/15 text-slate-200 text-sm px-4 py-1.5 border border-white/10"
                  onClick={() => send({ t: 'bid', score: 0 })}
                >
                  不叫
                </button>
              </>
            )}
            {myPlayTurn && (
              <>
                <button
                  disabled={!canPlay}
                  className="btn bg-blue-500 hover:bg-blue-400 text-white text-sm px-6 py-1.5 shadow-lg shadow-blue-500/25"
                  onClick={() => {
                    send({ t: 'play', cards: selCards });
                    setSelected(new Set());
                  }}
                >
                  出牌
                </button>
                {canPass && (
                  <button
                    className="btn bg-white/10 hover:bg-white/15 text-slate-200 text-sm px-6 py-1.5 border border-white/10"
                    onClick={() => send({ t: 'pass' })}
                  >
                    不出
                  </button>
                )}
              </>
            )}
          </div>
          <HandFan cards={myHand} selected={selected} onToggle={toggle} />
        </div>

        {/* 结果遮罩 */}
        {result && (
          <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <div className="glass px-12 py-8 text-center">
              <div className={`text-4xl font-black mb-3 ${iWon ? 'text-amber-300' : 'text-slate-300'}`}>
                {iWon ? '你赢了 🎉' : '你输了'}
              </div>
              <div className="text-slate-200 text-lg mb-2">
                {v.winner === 'landlord' ? '地主胜利' : '农民胜利'}
              </div>
              <div className="flex items-center justify-center gap-2">
                {v.springType && (
                  <Badge tone="amber">{v.springType === 'spring' ? '春天' : '反春天'}</Badge>
                )}
                <span className="text-xs text-slate-400">{result.reason}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

registerGameUI('doudizhu' as GameId, DoudizhuUI);
export default DoudizhuUI;
