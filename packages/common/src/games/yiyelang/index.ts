import { registerGame, type GameDefinition, type GameView, type TurnInfo } from '../../framework.js';
import type { GameEvent, GameOptions, GameResult, PlayerId, PlayerInfo, Rng } from '../../types.js';
import { shuffle } from '../../types.js';

/* ================= 角色 ================= */

export type Role =
  | 'werewolf'
  | 'minion'
  | 'mason'
  | 'seer'
  | 'robber'
  | 'troublemaker'
  | 'drunk'
  | 'insomniac'
  | 'tanner'
  | 'hunter'
  | 'villager';

export type Team = 'wolf' | 'village' | 'tanner';

export const ROLE_INFO: Record<Role, { name: string; emoji: string; team: Team; desc: string }> = {
  werewolf: {
    name: '狼人',
    emoji: '🐺',
    team: 'wolf',
    desc: '夜晚与同伴相认；若只有你一只狼，可查看中央一张牌。白天若没有狼人出局，狼人阵营获胜。',
  },
  minion: {
    name: '爪牙',
    emoji: '🦹',
    team: 'wolf',
    desc: '夜晚查看谁是狼人。狼人阵营获胜时你一同获胜。',
  },
  mason: {
    name: '守夜人',
    emoji: '🔨',
    team: 'village',
    desc: '夜晚与另一名守夜人相认（若只有你一人，则没有同伴）。',
  },
  seer: {
    name: '预言家',
    emoji: '🔮',
    team: 'village',
    desc: '夜晚可查看一名其他玩家的牌，或查看中央两张牌。',
  },
  robber: {
    name: '强盗',
    emoji: '🗡️',
    team: 'village',
    desc: '夜晚可与一名玩家交换身份牌，并查看自己的新牌。',
  },
  troublemaker: {
    name: '捣蛋鬼',
    emoji: '😈',
    team: 'village',
    desc: '夜晚可交换两名其他玩家的身份牌。',
  },
  drunk: {
    name: '酒鬼',
    emoji: '🍺',
    team: 'village',
    desc: '夜晚可将自己的牌与中央一张交换（不看新牌）。',
  },
  insomniac: {
    name: '失眠者',
    emoji: '🌙',
    team: 'village',
    desc: '夜晚最后醒来，查看自己现在的身份牌。',
  },
  tanner: {
    name: '皮匠',
    emoji: '🥿',
    team: 'tanner',
    desc: '没有阵营。若你出局，你独自获胜。',
  },
  hunter: {
    name: '猎人',
    emoji: '🏹',
    team: 'village',
    desc: '若你出局，可带走任意一名玩家一同出局。',
  },
  villager: {
    name: '村民',
    emoji: '🧑‍🌾',
    team: 'village',
    desc: '普通村民，没有夜晚行动。靠推理找出狼人。',
  },
};

/** 夜晚唤醒顺序（无夜晚行动的角色不在此列） */
export const NIGHT_ORDER: Role[] = [
  'werewolf',
  'minion',
  'mason',
  'seer',
  'robber',
  'troublemaker',
  'drunk',
  'insomniac',
];

/** 按人数给出默认身份配置（N 人用 N+3 张牌） */
export function defaultRoles(n: number): Role[] {
  switch (n) {
    case 3:
      return ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker', 'villager'];
    case 4:
      return ['werewolf', 'werewolf', 'minion', 'seer', 'robber', 'troublemaker', 'villager'];
    case 5:
      return ['werewolf', 'werewolf', 'minion', 'mason', 'mason', 'seer', 'robber', 'troublemaker'];
    case 6:
      return [
        'werewolf', 'werewolf', 'minion', 'mason', 'mason',
        'seer', 'robber', 'troublemaker', 'drunk',
      ];
    case 7:
      return [
        'werewolf', 'werewolf', 'minion', 'mason', 'mason',
        'seer', 'robber', 'troublemaker', 'drunk', 'villager',
      ];
    case 8:
      return [
        'werewolf', 'werewolf', 'minion', 'mason', 'mason', 'seer',
        'robber', 'troublemaker', 'drunk', 'insomniac', 'villager',
      ];
    case 9:
      return [
        'werewolf', 'werewolf', 'minion', 'mason', 'mason', 'seer',
        'robber', 'troublemaker', 'drunk', 'insomniac', 'tanner', 'villager',
      ];
    default:
      // 10 人：13 张牌
      return [
        'werewolf', 'werewolf', 'minion', 'mason', 'mason', 'seer',
        'robber', 'troublemaker', 'drunk', 'insomniac', 'tanner',
        'hunter', 'villager', 'villager',
      ];
  }
}

/* ================= 状态与动作 ================= */

/** 夜晚获得的情报（仅自己可见） */
export type NightInfo =
  | { kind: 'werewolf'; partner: PlayerId | null; centerCard?: Role }
  | { kind: 'minion'; werewolves: PlayerId[] }
  | { kind: 'mason'; partner: PlayerId | null }
  | { kind: 'seer'; player?: { id: PlayerId; role: Role }; center?: [Role, Role] }
  | { kind: 'robber'; from: PlayerId; newRole: Role }
  | { kind: 'troublemaker'; a: PlayerId; b: PlayerId }
  | { kind: 'drunk'; centerIndex: number }
  | { kind: 'insomniac'; role: Role };

export type NightChoice =
  | { kind: 'ack' }
  | { kind: 'skip' }
  | { kind: 'viewCenter'; index: number }
  | { kind: 'seerPlayer'; player: PlayerId }
  | { kind: 'seerCenter'; a: number; b: number }
  | { kind: 'rob'; player: PlayerId }
  | { kind: 'swap'; a: PlayerId; b: PlayerId }
  | { kind: 'drink'; index: number };

export type YylAction =
  | { t: 'night'; choice: NightChoice }
  | { t: 'endDiscussion' }
  | { t: 'vote'; target: PlayerId | null }
  | { t: 'hunt'; target: PlayerId };

export interface YylOutcome {
  winner: 'village' | 'wolves' | 'tanner';
  out: PlayerId[];
  reason: string;
}

export interface YylState {
  players: PlayerInfo[];
  /** 本局使用的 N+3 张牌（公开） */
  rolesInPlay: Role[];
  /** 每人当前持有的牌（夜晚可能变化，私密） */
  hands: Record<PlayerId, Role>;
  /** 中央 3 张牌 */
  center: [Role, Role, Role];
  /** 开局发到的牌（决定夜晚行动权） */
  originalRole: Record<PlayerId, Role>;
  /** 夜晚步骤（仅含有玩家持有的角色） */
  nightSteps: Role[];
  stepIndex: number;
  /** 当前步骤尚未行动的玩家 */
  stepActors: PlayerId[];
  /** 每人夜晚获得的情报 */
  nightInfo: Record<PlayerId, NightInfo[]>;
  phase: 'night' | 'day' | 'voting' | 'hunt' | 'done';
  discussionSeconds: number;
  discussionEndsAt: number;
  dayReady: PlayerId[];
  votes: Record<PlayerId, PlayerId | null>;
  out: PlayerId[];
  hunterTarget: PlayerId | null;
  outcome: YylOutcome | null;
}

/* ================= 视图 ================= */

export interface YylView extends GameView {
  game: 'yiyelang';
  phase: 'night' | 'day' | 'voting' | 'hunt' | 'done';
  you: PlayerId;
  players: { id: PlayerId; name: string; seat: number }[];
  rolesInPlay: Role[];
  myOriginalRole: Role;
  myRole: Role;
  nightInfo: NightInfo[];
  night?: {
    steps: Role[];
    index: number;
    role: Role | null;
    myTurn: boolean;
    myStepPassed: boolean;
  };
  day?: { endsAt: number; ready: boolean; readyCount: number; total: number };
  voting?: { hasVoted: boolean; myVote: PlayerId | null; votedCount: number; total: number };
  hunt?: { hunter: PlayerId; myTurn: boolean };
  reveal?: {
    hands: Record<PlayerId, Role>;
    center: Role[];
    votes: Record<PlayerId, PlayerId | null>;
    out: PlayerId[];
  };
  outcome?: YylOutcome;
}

/* ================= 实现 ================= */

function judge(hands: Record<PlayerId, Role>, out: PlayerId[]): YylOutcome {
  const tannerOut = out.some((id) => hands[id] === 'tanner');
  const wolfOut = out.some((id) => hands[id] === 'werewolf');
  if (tannerOut) return { winner: 'tanner', out, reason: '皮匠被出局，皮匠独自获胜！' };
  if (wolfOut) return { winner: 'village', out, reason: '狼人被出局，村民阵营获胜！' };
  return { winner: 'wolves', out, reason: '没有狼人出局，狼人阵营获胜！' };
}

function enterDay(state: YylState): YylState {
  return {
    ...state,
    phase: 'day',
    discussionEndsAt: Date.now() + state.discussionSeconds * 1000,
    dayReady: [],
  };
}

function applyNight(state: YylState, choice: NightChoice, from: PlayerId): { state: YylState; events: GameEvent[] } {
  if (state.phase !== 'night') throw new Error('现在不是夜晚');
  if (state.stepIndex >= state.nightSteps.length) throw new Error('夜晚已经结束');
  const role = state.nightSteps[state.stepIndex]!;
  if (!state.stepActors.includes(from)) throw new Error('还没轮到你行动');

  const hands: Record<PlayerId, Role> = { ...state.hands };
  const center: [Role, Role, Role] = [...state.center] as [Role, Role, Role];
  const info = state.nightInfo[from] ? [...state.nightInfo[from]!] : [];
  const events: GameEvent[] = [];
  const playerIds = state.players.map((p) => p.id);

  switch (role) {
    case 'werewolf': {
      const partners = state.players
        .filter((p) => p.id !== from && state.originalRole[p.id] === 'werewolf')
        .map((p) => p.id);
      if (partners.length > 0) {
        if (choice.kind !== 'ack') throw new Error('狼人请确认同伴信息');
        info.push({ kind: 'werewolf', partner: partners[0]! });
      } else {
        // 独狼：可查看中央一张牌，或跳过
        if (choice.kind === 'skip') {
          info.push({ kind: 'werewolf', partner: null });
        } else if (choice.kind === 'viewCenter') {
          if (choice.index < 0 || choice.index > 2) throw new Error('中央牌下标非法');
          info.push({ kind: 'werewolf', partner: null, centerCard: center[choice.index] });
        } else {
          throw new Error('独狼请选择查看中央一张牌或跳过');
        }
      }
      break;
    }
    case 'minion': {
      if (choice.kind !== 'ack') throw new Error('爪牙请确认信息');
      const wolves = state.players.filter((p) => hands[p.id] === 'werewolf').map((p) => p.id);
      info.push({ kind: 'minion', werewolves: wolves });
      break;
    }
    case 'mason': {
      if (choice.kind !== 'ack') throw new Error('守夜人请确认同伴');
      const partner =
        state.players.find((p) => p.id !== from && state.originalRole[p.id] === 'mason')?.id ?? null;
      info.push({ kind: 'mason', partner });
      break;
    }
    case 'seer': {
      if (choice.kind === 'skip') {
        info.push({ kind: 'seer' });
      } else if (choice.kind === 'seerPlayer') {
        if (choice.player === from) throw new Error('预言家不能查看自己');
        if (!playerIds.includes(choice.player)) throw new Error('目标玩家不存在');
        info.push({ kind: 'seer', player: { id: choice.player, role: hands[choice.player]! } });
      } else if (choice.kind === 'seerCenter') {
        const { a, b } = choice;
        if (a === b) throw new Error('请选择两张不同的中央牌');
        if (a < 0 || a > 2 || b < 0 || b > 2) throw new Error('中央牌下标非法');
        info.push({ kind: 'seer', center: [center[a]!, center[b]!] });
      } else {
        throw new Error('预言家请选择查看方式');
      }
      break;
    }
    case 'robber': {
      if (choice.kind === 'skip') break;
      if (choice.kind !== 'rob') throw new Error('强盗请选择抢劫目标或跳过');
      if (choice.player === from) throw new Error('强盗不能抢自己');
      if (!playerIds.includes(choice.player)) throw new Error('目标玩家不存在');
      const newRole = hands[choice.player]!;
      hands[choice.player] = hands[from]!;
      hands[from] = newRole;
      info.push({ kind: 'robber', from: choice.player, newRole });
      events.push({ type: 'night-swap', a: from, b: choice.player });
      break;
    }
    case 'troublemaker': {
      if (choice.kind === 'skip') break;
      if (choice.kind !== 'swap') throw new Error('捣蛋鬼请选择两名玩家或跳过');
      const { a, b } = choice;
      if (a === b) throw new Error('请选择两名不同的玩家');
      if (a === from || b === from) throw new Error('捣蛋鬼不能交换自己');
      if (!playerIds.includes(a) || !playerIds.includes(b)) throw new Error('目标玩家不存在');
      const tmp = hands[a]!;
      hands[a] = hands[b]!;
      hands[b] = tmp;
      info.push({ kind: 'troublemaker', a, b });
      events.push({ type: 'night-swap', a, b });
      break;
    }
    case 'drunk': {
      if (choice.kind === 'skip') break;
      if (choice.kind !== 'drink') throw new Error('酒鬼请选择中央一张牌或跳过');
      const i = choice.index;
      if (i < 0 || i > 2) throw new Error('中央牌下标非法');
      const tmp = hands[from]!;
      hands[from] = center[i]!;
      center[i] = tmp;
      info.push({ kind: 'drunk', centerIndex: i });
      events.push({ type: 'night-swap', a: from, b: `center${i}` });
      break;
    }
    case 'insomniac': {
      if (choice.kind !== 'ack') throw new Error('失眠者请确认你的身份');
      info.push({ kind: 'insomniac', role: hands[from]! });
      break;
    }
    default:
      throw new Error('该角色没有夜晚行动');
  }

  const stepActors = state.stepActors.filter((id) => id !== from);
  let next: YylState = {
    ...state,
    hands,
    center,
    nightInfo: { ...state.nightInfo, [from]: info },
    stepActors,
  };
  if (stepActors.length === 0) {
    const nextIndex = state.stepIndex + 1;
    if (nextIndex >= state.nightSteps.length) {
      next = enterDay({ ...next, stepIndex: nextIndex });
    } else {
      const actors = state.players
        .filter((p) => state.originalRole[p.id] === state.nightSteps[nextIndex])
        .map((p) => p.id);
      next = { ...next, stepIndex: nextIndex, stepActors: actors };
    }
  }
  return { state: next, events };
}

function tally(votes: Record<PlayerId, PlayerId | null>): PlayerId[] {
  const counts = new Map<PlayerId, number>();
  for (const v of Object.values(votes)) {
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const max = Math.max(...counts.values());
  const top = [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id);
  return top.length === 1 ? [top[0]!] : [];
}

export const yiyelang: GameDefinition<YylState, YylAction> = {
  meta: {
    id: 'yiyelang',
    name: '一夜狼',
    tagline: '一夜真伪，投票揪狼',
    minPlayers: 3,
    maxPlayers: 10,
    theme: '#ef4444',
    rules: `## 一夜狼（One Night Ultimate Werewolf）

3-10 人，每人发 1 张身份牌，中央放 3 张。夜晚各角色按顺序秘密行动（可能换牌/看牌），
白天讨论后投票，得票最多者出局；平票则无人出局。

### 夜晚顺序
1. **狼人**：互认同伴；若只有一只狼，可看中央一张牌。
2. **爪牙**：查看谁是狼人。
3. **守夜人**：两人互认。
4. **预言家**：查看一名其他玩家的牌，或中央两张牌。
5. **强盗**：与一名玩家交换身份牌，然后看自己的新牌。
6. **捣蛋鬼**：交换两名其他玩家的牌。
7. **酒鬼**：将自己的牌与中央一张交换（不看）。
8. **失眠者**：查看自己现在的牌。

### 胜负
- 出局者是狼人 → 村民阵营胜。
- 没有狼人出局 → 狼人阵营胜。
- 皮匠出局 → 皮匠独胜。
- 猎人出局可带走一人，再判胜负。

注意：你只按**开局发到的角色**行动一次；夜晚结束后你手里的牌才决定你的阵营。`,
  },
  id: 'yiyelang',
  minPlayers: 3,
  maxPlayers: 10,
  defaultOptions: { discussionSeconds: 180 },

  start(players: PlayerInfo[], options: GameOptions, rng: Rng): YylState {
    const sorted = [...players].sort((a, b) => a.seat - b.seat);
    const n = sorted.length;
    if (n < 3 || n > 10) throw new Error('一夜狼支持 3-10 人');

    let roles: Role[];
    const custom = options.roles;
    if (Array.isArray(custom)) {
      if (custom.length !== n + 3) throw new Error('自定义身份数量须为 人数+3');
      roles = custom.map((r) => {
        if (typeof r !== 'string' || !(r in ROLE_INFO)) throw new Error(`未知身份: ${String(r)}`);
        return r as Role;
      });
    } else {
      roles = defaultRoles(n);
    }

    const deck = shuffle(roles, rng);
    const hands: Record<PlayerId, Role> = {};
    const originalRole: Record<PlayerId, Role> = {};
    sorted.forEach((p, i) => {
      hands[p.id] = deck[i]!;
      originalRole[p.id] = deck[i]!;
    });
    const center: [Role, Role, Role] = [deck[n]!, deck[n + 1]!, deck[n + 2]!];

    const inPlay = new Set(sorted.map((p) => originalRole[p.id]!));
    const nightSteps = NIGHT_ORDER.filter((r) => inPlay.has(r));
    const seconds = Number(options.discussionSeconds ?? 180);

    const base: YylState = {
      players: sorted,
      rolesInPlay: roles,
      hands,
      center,
      originalRole,
      nightSteps,
      stepIndex: 0,
      stepActors: [],
      nightInfo: {},
      phase: 'night',
      discussionSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 180,
      discussionEndsAt: 0,
      dayReady: [],
      votes: {},
      out: [],
      hunterTarget: null,
      outcome: null,
    };
    if (nightSteps.length === 0) return enterDay(base);
    const firstActors = sorted
      .filter((p) => originalRole[p.id] === nightSteps[0])
      .map((p) => p.id);
    return { ...base, stepActors: firstActors };
  },

  apply(state: YylState, action: YylAction, from: PlayerId): { state: YylState; events: GameEvent[] } {
    switch (action.t) {
      case 'night':
        return applyNight(state, action.choice, from);
      case 'endDiscussion': {
        if (state.phase !== 'day') throw new Error('现在不是讨论阶段');
        if (state.dayReady.includes(from)) return { state, events: [] };
        const dayReady = [...state.dayReady, from];
        const expired = Date.now() >= state.discussionEndsAt;
        if (dayReady.length >= state.players.length || expired) {
          return {
            state: { ...state, dayReady, phase: 'voting', votes: {} },
            events: [{ type: 'day-end' }],
          };
        }
        return { state: { ...state, dayReady }, events: [] };
      }
      case 'vote': {
        if (state.phase !== 'voting') throw new Error('现在不是投票阶段');
        if (from in state.votes) throw new Error('你已经投过票了');
        const target = action.target;
        if (target !== null && !state.players.some((p) => p.id === target)) throw new Error('投票目标不存在');
        const votes: Record<PlayerId, PlayerId | null> = { ...state.votes, [from]: target };
        const events: GameEvent[] = [{ type: 'vote', from }];
        if (Object.keys(votes).length < state.players.length) {
          return { state: { ...state, votes }, events };
        }
        const out = tally(votes);
        const isHunter = out.length === 1 && state.hands[out[0]!] === 'hunter';
        if (isHunter) {
          events.push({ type: 'hunt', hunter: out[0] });
          return { state: { ...state, votes, out, phase: 'hunt' }, events };
        }
        const outcome = judge(state.hands, out);
        events.push({ type: 'reveal' });
        return { state: { ...state, votes, out, phase: 'done', outcome }, events };
      }
      case 'hunt': {
        if (state.phase !== 'hunt') throw new Error('猎人还未发动技能');
        if (state.out.length !== 1 || state.out[0] !== from) throw new Error('只有出局的猎人才能发动技能');
        const target = action.target;
        if (target === from) throw new Error('猎人不能带走自己');
        if (!state.players.some((p) => p.id === target)) throw new Error('目标玩家不存在');
        const out = [...state.out, target];
        const outcome = judge(state.hands, out);
        return {
          state: { ...state, out, hunterTarget: target, phase: 'done', outcome },
          events: [
            { type: 'hunted', hunter: from, target },
            { type: 'reveal' },
          ],
        };
      }
      default:
        throw new Error('未知动作');
    }
  },

  view(state: YylState, viewer: PlayerId): YylView {
    const base = {
      game: 'yiyelang' as const,
      you: viewer,
      players: state.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
      rolesInPlay: state.rolesInPlay,
      myOriginalRole: state.originalRole[viewer]!,
      myRole: state.hands[viewer]!,
      nightInfo: state.nightInfo[viewer] ?? [],
    };

    if (state.phase === 'night') {
      const idx = Math.min(state.stepIndex, Math.max(0, state.nightSteps.length - 1));
      const role = state.nightSteps[idx] ?? null;
      const myOrig = state.originalRole[viewer]!;
      const myStepIdx = state.nightSteps.indexOf(myOrig);
      return {
        ...base,
        phase: 'night',
        night: {
          steps: state.nightSteps,
          index: state.stepIndex,
          role,
          myTurn: state.stepActors.includes(viewer),
          myStepPassed: myStepIdx >= 0 && myStepIdx < state.stepIndex,
        },
      };
    }

    if (state.phase === 'day') {
      return {
        ...base,
        phase: 'day',
        day: {
          endsAt: state.discussionEndsAt,
          ready: state.dayReady.includes(viewer),
          readyCount: state.dayReady.length,
          total: state.players.length,
        },
      };
    }

    if (state.phase === 'voting') {
      return {
        ...base,
        phase: 'voting',
        voting: {
          hasVoted: viewer in state.votes,
          myVote: state.votes[viewer] ?? null,
          votedCount: Object.keys(state.votes).length,
          total: state.players.length,
        },
      };
    }

    if (state.phase === 'hunt') {
      return {
        ...base,
        phase: 'hunt',
        hunt: { hunter: state.out[0]!, myTurn: state.out[0] === viewer },
        reveal: {
          hands: { [state.out[0]!]: state.hands[state.out[0]!]! },
          center: [],
          votes: state.votes,
          out: state.out,
        },
      };
    }

    return {
      ...base,
      phase: 'done',
      reveal: {
        hands: state.hands,
        center: [...state.center],
        votes: state.votes,
        out: state.out,
      },
      outcome: state.outcome ?? undefined,
    };
  },

  turn(state: YylState): TurnInfo {
    switch (state.phase) {
      case 'night': {
        const role = state.nightSteps[state.stepIndex];
        const name = role ? ROLE_INFO[role].name : '';
        return {
          active: [...state.stepActors],
          phase: 'night',
          hint: role ? `夜晚：${name}行动中…` : '夜晚',
        };
      }
      case 'day':
        return { active: [], phase: 'day', hint: '白天讨论中，说服大家你的判断…' };
      case 'voting': {
        const pending = state.players.filter((p) => !(p.id in state.votes)).map((p) => p.id);
        return { active: pending, phase: 'voting', hint: '请投票选出你认为的狼人' };
      }
      case 'hunt':
        return { active: [...state.out], phase: 'hunt', hint: '猎人出局，选择一名玩家带走' };
      case 'done':
        return { active: [], phase: 'done', hint: '游戏结束' };
    }
  },

  result(state: YylState): GameResult | null {
    if (!state.outcome) return null;
    const { winner } = state.outcome;
    const village = state.players
      .filter((p) => ROLE_INFO[state.hands[p.id]!]!.team === 'village')
      .map((p) => p.id);
    const wolves = state.players
      .filter((p) => ROLE_INFO[state.hands[p.id]!]!.team === 'wolf')
      .map((p) => p.id);
    const tanner = state.players
      .filter((p) => state.hands[p.id] === 'tanner')
      .map((p) => p.id);
    const winners = winner === 'village' ? village : winner === 'wolves' ? wolves : tanner;
    return {
      winners,
      teams: { 村民阵营: village, 狼人阵营: wolves, 皮匠: tanner },
      reason: state.outcome.reason,
    };
  },

  legalActions(state: YylState, player: PlayerId): YylAction[] {
    if (state.phase === 'done') return [];
    const others = state.players.filter((p) => p.id !== player).map((p) => p.id);
    switch (state.phase) {
      case 'night': {
        if (!state.stepActors.includes(player)) return [];
        const role = state.nightSteps[state.stepIndex];
        if (!role) return [];
        const actions: YylAction[] = [];
        const nightChoices = (choice: NightChoice): YylAction => ({ t: 'night', choice });
        switch (role) {
          case 'werewolf': {
            const hasPartner = state.players.some(
              (p) => p.id !== player && state.originalRole[p.id] === 'werewolf',
            );
            if (hasPartner) {
              actions.push(nightChoices({ kind: 'ack' }));
            } else {
              actions.push(nightChoices({ kind: 'skip' }));
              for (let i = 0; i < 3; i++) actions.push(nightChoices({ kind: 'viewCenter', index: i }));
            }
            break;
          }
          case 'minion':
          case 'mason':
          case 'insomniac':
            actions.push(nightChoices({ kind: 'ack' }));
            break;
          case 'seer':
            actions.push(nightChoices({ kind: 'skip' }));
            for (const p of others) actions.push(nightChoices({ kind: 'seerPlayer', player: p }));
            actions.push(nightChoices({ kind: 'seerCenter', a: 0, b: 1 }));
            actions.push(nightChoices({ kind: 'seerCenter', a: 0, b: 2 }));
            actions.push(nightChoices({ kind: 'seerCenter', a: 1, b: 2 }));
            break;
          case 'robber':
            actions.push(nightChoices({ kind: 'skip' }));
            for (const p of others) actions.push(nightChoices({ kind: 'rob', player: p }));
            break;
          case 'troublemaker':
            actions.push(nightChoices({ kind: 'skip' }));
            for (let i = 0; i < others.length; i++) {
              for (let j = i + 1; j < others.length; j++) {
                actions.push(nightChoices({ kind: 'swap', a: others[i]!, b: others[j]! }));
              }
            }
            break;
          case 'drunk':
            actions.push(nightChoices({ kind: 'skip' }));
            for (let i = 0; i < 3; i++) actions.push(nightChoices({ kind: 'drink', index: i }));
            break;
          default:
            break;
        }
        return actions;
      }
      case 'day':
        return state.dayReady.includes(player) ? [] : [{ t: 'endDiscussion' }];
      case 'voting':
        return player in state.votes
          ? []
          : [
              { t: 'vote', target: null },
              ...others.map((p): YylAction => ({ t: 'vote', target: p })),
            ];
      case 'hunt':
        return state.out.includes(player)
          ? others.map((p): YylAction => ({ t: 'hunt', target: p }))
          : [];
      default:
        return [];
    }
  },
};

registerGame(yiyelang);
