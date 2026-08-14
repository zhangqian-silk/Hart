import type { AgentContext, AgentDecision, AgentProfile, AgentProvider } from '../types.js';

/**
 * 脚本化 Provider（内置启发式）。
 * 不依赖外部模型，离线可跑：用于测试、评估基线、房间陪玩。
 * 决策风格受 AgentProfile 影响（目前主要影响叫分/投票倾向）。
 */
export class ScriptedProvider implements AgentProvider {
  readonly kind = 'scripted';

  constructor(private readonly profile: AgentProfile) {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    if (ctx.actions.length === 0) {
      return { action: null, reasoning: '无合法动作' };
    }
    switch (ctx.game) {
      case 'wuziqi':
        return wuziqiHeuristic(ctx);
      case 'doudizhu':
        return ddzHeuristic(ctx);
      case 'yiyelang':
        return yylHeuristic(ctx);
      case 'avalon':
        return avalonHeuristic(ctx);
      default:
        return randomPick(ctx, '未知游戏，随机选择');
    }
  }
}

function randomPick(ctx: AgentContext, reasoning: string): AgentDecision {
  const action = ctx.actions[Math.floor(Math.random() * ctx.actions.length)];
  return { action, reasoning };
}

/* ---------------- 五子棋 ---------------- */

const DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
] as const;

function lineScore(
  board: number[][],
  row: number,
  col: number,
  dr: number,
  dc: number,
  color: number,
): number {
  let count = 1;
  let open = 0;
  for (const sign of [1, -1]) {
    let r = row + dr * sign;
    let c = col + dc * sign;
    while (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r]![c] === color) {
      count++;
      r += dr * sign;
      c += dc * sign;
    }
    if (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r]![c] === 0) open++;
  }
  if (count >= 5) return 100000;
  if (count === 4) return open === 2 ? 10000 : open === 1 ? 1000 : 0;
  if (count === 3) return open === 2 ? 1000 : open === 1 ? 100 : 0;
  if (count === 2) return open === 2 ? 100 : 10;
  return open === 2 ? 10 : 1;
}

function wuziqiHeuristic(ctx: AgentContext): AgentDecision {
  const view = ctx.visibleState as unknown as {
    board: number[][];
    youAre: number;
  };
  const me = view.youAre;
  const opp = me === 1 ? 2 : 1;
  let best = -Infinity;
  let bestAction: unknown = null;
  for (const a of ctx.actions) {
    const { row, col } = a as { t: string; row: number; col: number };
    let score = 0;
    for (const [dr, dc] of DIRS) {
      score += lineScore(view.board, row, col, dr, dc, me);
      score += lineScore(view.board, row, col, dr, dc, opp) * 0.9;
    }
    // 偏好靠近已有棋子的位置（避免开局乱下）
    score += 7 - Math.abs(row - 7) - Math.abs(col - 7);
    if (score > best) {
      best = score;
      bestAction = a;
    }
  }
  return { action: bestAction, reasoning: `启发式评分 ${best.toFixed(0)}` };
}

/* ---------------- 斗地主 ---------------- */

interface DdzCard {
  rank: number;
  suit: string;
}

function ddzHeuristic(ctx: AgentContext): AgentDecision {
  const view = ctx.visibleState as unknown as {
    yourHand: DdzCard[];
    highestBid: number;
    phase: string;
  };
  const actions = ctx.actions as { t: string; [k: string]: unknown }[];

  // 叫分阶段
  if (actions.some((a) => a.t === 'bid')) {
    const hand = view.yourHand;
    const hasRocket = hand.some((c) => c.rank === 16) && hand.some((c) => c.rank === 17);
    const bombs = new Map<number, number>();
    for (const c of hand) bombs.set(c.rank, (bombs.get(c.rank) ?? 0) + 1);
    const bombCount = [...bombs.values()].filter((n) => n === 4).length;
    let want = 0;
    if (hasRocket) want = 3;
    else if (bombCount > 0) want = 2;
    else if (hand.filter((c) => c.rank >= 14).length >= 4) want = 1;
    const bids = actions
      .filter((a) => a.t === 'bid')
      .map((a) => a.score as number)
      .sort((x, y) => x - y);
    const pick = bids.filter((s) => s <= want).pop() ?? 0;
    const action = actions.find((a) => a.t === 'bid' && a.score === pick)!;
    return { action, reasoning: `手牌评估 want=${want}，叫 ${pick} 分` };
  }

  // 出牌阶段
  const plays = actions.filter((a) => a.t === 'play');
  if (plays.length === 0) {
    const pass = actions.find((a) => a.t === 'pass');
    return { action: pass ?? actions[0], reasoning: '无牌可压，不出' };
  }
  // 优先出张数少、点数小的牌（保留炸弹/火箭）
  const weight = (a: { t: string; [k: string]: unknown }): number => {
    const cards = (a.cards as DdzCard[] | undefined) ?? [];
    const isBomb = cards.length === 4;
    const isRocket = cards.length === 2 && cards.every((c) => c.rank >= 16);
    const maxRank = Math.max(...cards.map((c) => c.rank));
    return cards.length * 100 + maxRank + (isBomb ? 10000 : 0) + (isRocket ? 20000 : 0);
  };
  const best = plays.reduce((x, y) => (weight(x) <= weight(y) ? x : y));
  const pass = actions.find((a) => a.t === 'pass');
  // 跟牌时：如果最小可压牌是炸弹且对手剩牌多，考虑不出
  const bestCards = (best.cards as DdzCard[] | undefined) ?? [];
  if (pass && bestCards.length === 4) {
    return { action: pass, reasoning: '保留炸弹，不出' };
  }
  return { action: best, reasoning: '出最小的可压牌型' };
}

/* ---------------- 一夜狼 ---------------- */

function yylHeuristic(ctx: AgentContext): AgentDecision {
  const actions = ctx.actions as { t: string; [k: string]: unknown }[];
  const view = ctx.visibleState as unknown as {
    you: string;
    players: { id: string }[];
    myRole: string;
  };

  // 夜晚行动：选第一个合法选项
  const night = actions.find((a) => a.t === 'night');
  if (night) return { action: night, reasoning: '夜晚行动' };

  // 结束讨论
  const end = actions.find((a) => a.t === 'endDiscussion');
  if (end && Math.random() < 0.3) return { action: end, reasoning: '提议结束讨论' };

  // 投票：随机投给非己的玩家
  const votes = actions.filter((a) => a.t === 'vote');
  if (votes.length > 0) {
    const others = votes.filter((a) => a.target !== view.you && a.target !== null);
    const pool = others.length > 0 ? others : votes;
    return { action: pool[Math.floor(Math.random() * pool.length)], reasoning: '投票' };
  }

  // 猎人开枪
  const hunt = actions.find((a) => a.t === 'hunt');
  if (hunt) {
    const targets = actions.filter((a) => a.target !== view.you);
    const pool = targets.length > 0 ? targets : actions;
    return { action: pool[Math.floor(Math.random() * pool.length)], reasoning: '猎人开枪' };
  }

  return randomPick(ctx, '随机选择');
}

/* ---------------- 阿瓦隆 ---------------- */

const AVALON_EVIL = new Set(['assassin', 'morgana', 'mordred', 'oberon', 'minion']);

function avalonHeuristic(ctx: AgentContext): AgentDecision {
  const actions = ctx.actions as { t: string; [k: string]: unknown }[];
  const view = ctx.visibleState as unknown as {
    you: string;
    yourRole: string;
    proposal?: string[] | null;
  };
  const evil = AVALON_EVIL.has(view.yourRole);

  // 组队：优先包含自己的队伍
  const proposes = actions.filter((a) => a.t === 'propose');
  if (proposes.length > 0) {
    const withMe = proposes.filter((a) => (a.team as string[]).includes(view.you));
    const pool = withMe.length > 0 ? withMe : proposes;
    return { action: pool[Math.floor(Math.random() * pool.length)], reasoning: '组队' };
  }

  // 投票
  const votes = actions.filter((a) => a.t === 'vote');
  if (votes.length > 0) {
    const inTeam = view.proposal?.includes(view.you);
    const approve = votes.find((a) => a.approve === true);
    const reject = votes.find((a) => a.approve === false);
    if (evil) {
      // 坏人：自己在队里就赞成（去破坏），否则反对
      return { action: inTeam ? approve ?? votes[0] : reject ?? votes[0], reasoning: '坏人投票' };
    }
    // 好人：自己在队里赞成；不在队里随机
    if (inTeam) return { action: approve ?? votes[0], reasoning: '我在队伍中，赞成' };
    return { action: Math.random() < 0.5 ? approve ?? votes[0] : reject ?? votes[0], reasoning: '好人投票' };
  }

  // 任务
  const quests = actions.filter((a) => a.t === 'quest');
  if (quests.length > 0) {
    const fail = quests.find((a) => a.vote === 'fail');
    const success = quests.find((a) => a.vote === 'success');
    if (evil) return { action: fail ?? quests[0], reasoning: '坏人破坏任务' };
    return { action: success ?? quests[0], reasoning: '好人支持任务' };
  }

  // 刺杀
  const assassins = actions.filter((a) => a.t === 'assassinate');
  if (assassins.length > 0) {
    const others = assassins.filter((a) => a.target !== view.you);
    const pool = others.length > 0 ? others : assassins;
    return { action: pool[Math.floor(Math.random() * pool.length)], reasoning: '刺杀' };
  }

  return randomPick(ctx, '随机选择');
}

export function createScriptedProvider(
  profile: AgentProfile,
  _options?: Record<string, unknown>,
): AgentProvider {
  return new ScriptedProvider(profile);
}
