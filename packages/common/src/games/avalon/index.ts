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

/* ---------- 身份 ---------- */

export type AvalonSide = 'good' | 'evil';

export type AvalonRole =
  | 'merlin' // 梅林（好人）：能看到所有坏人，莫德雷德除外
  | 'percival' // 派西维尔（好人）：能看到梅林与莫甘娜（不区分）
  | 'loyal' // 亚瑟忠臣（好人）
  | 'assassin' // 刺客（坏人）：终局刺杀梅林
  | 'morgana' // 莫甘娜（坏人）：在派西维尔眼中显示为梅林候选
  | 'mordred' // 莫德雷德（坏人）：对梅林隐身
  | 'oberon' // 奥伯伦（坏人）：不与其他坏人互认
  | 'minion'; // 莫德雷德的爪牙（坏人）：普通坏人

export const ROLE_INFO: Record<
  AvalonRole,
  { name: string; side: AvalonSide; icon: string; desc: string }
> = {
  merlin: { name: '梅林', side: 'good', icon: '🧙', desc: '你能看到所有坏人（莫德雷德除外）。隐藏好自己！' },
  percival: { name: '派西维尔', side: 'good', icon: '🛡️', desc: '你能看到梅林与莫甘娜，但无法区分谁是真梅林。' },
  loyal: { name: '亚瑟忠臣', side: 'good', icon: '👑', desc: '你只知道自己的身份，观察、推理、投票。' },
  assassin: { name: '刺客', side: 'evil', icon: '🗡️', desc: '你是坏人头目。若好人完成三次任务，由你刺杀梅林。' },
  morgana: { name: '莫甘娜', side: 'evil', icon: '🔮', desc: '你在派西维尔眼中显示为梅林候选，尽量混淆视听。' },
  mordred: { name: '莫德雷德', side: 'evil', icon: '💀', desc: '你对梅林隐身，梅林看不到你。' },
  oberon: { name: '奥伯伦', side: 'evil', icon: '🦉', desc: '你不知道谁是同伙，同伙也不知道你。' },
  minion: { name: '爪牙', side: 'evil', icon: '🗡️', desc: '莫德雷德的爪牙，普通坏人。' },
};

/* ---------- 人数配置 ---------- */

export interface AvalonConfig {
  good: number;
  evil: number;
  /** 5 次任务各自需要的人数 */
  missionSizes: number[];
}

export const CONFIG: Record<number, AvalonConfig> = {
  5: { good: 3, evil: 2, missionSizes: [2, 3, 2, 3, 3] },
  6: { good: 4, evil: 2, missionSizes: [2, 3, 4, 3, 4] },
  7: { good: 4, evil: 3, missionSizes: [2, 3, 3, 4, 4] },
  8: { good: 5, evil: 3, missionSizes: [3, 4, 4, 5, 5] },
  9: { good: 6, evil: 3, missionSizes: [3, 4, 4, 5, 5] },
  10: { good: 6, evil: 4, missionSizes: [3, 4, 4, 5, 5] },
};

/** 构造身份牌堆：必含梅林+刺客，5~10 人局均含派西维尔+莫甘娜，其余按阵营填充 */
function buildRoles(n: number): AvalonRole[] {
  const { good, evil } = CONFIG[n]!;
  const roles: AvalonRole[] = ['merlin', 'assassin', 'percival', 'morgana'];
  let evilLeft = evil - 2;
  // 其余坏人：优先莫德雷德，其次奥伯伦，最后爪牙
  for (const r of ['mordred', 'oberon', 'minion'] as AvalonRole[]) {
    if (evilLeft <= 0) break;
    roles.push(r);
    evilLeft--;
  }
  let goodLeft = good - 2;
  while (goodLeft-- > 0) roles.push('loyal');
  return roles;
}

/** 任务失败所需的失败票数：第 4 次任务（index 3）在 7 人及以上时需 2 张失败票 */
function failsRequired(mission: number, playerCount: number): number {
  if (mission === 3 && playerCount >= 7) return 2;
  return 1;
}

/* ---------- 状态 ---------- */

export type AvalonPhase = 'propose' | 'vote' | 'quest' | 'assassinate' | 'finished';

export interface AvalonMissionRecord {
  index: number;
  leader: PlayerId;
  team: PlayerId[];
  votes: Record<PlayerId, boolean>;
  passed: boolean;
  result?: 'success' | 'fail';
  successCount?: number;
  failCount?: number;
}

export interface AvalonState {
  players: PlayerInfo[];
  roles: Record<PlayerId, AvalonRole>;
  phase: AvalonPhase;
  /** 当前任务序号 0..4 */
  mission: number;
  /** 当前队长座位下标 */
  leaderIdx: number;
  proposal: PlayerId[] | null;
  votes: Record<PlayerId, boolean>;
  questTeam: PlayerId[] | null;
  questVotes: Record<PlayerId, 'success' | 'fail'>;
  results: ('success' | 'fail')[];
  /** 连续被否决的提名数 */
  failedProposals: number;
  history: AvalonMissionRecord[];
  assassination: PlayerId | null;
  winner: AvalonSide | null;
  winReason: string | null;
}

export type AvalonAction =
  | { t: 'propose'; team: PlayerId[] }
  | { t: 'vote'; approve: boolean }
  | { t: 'quest'; vote: 'success' | 'fail' }
  | { t: 'assassinate'; target: PlayerId };

/* ---------- 视图 ---------- */

export interface AvalonNightInfo {
  /** evil=梅林眼中的坏人；merlin-candidate=派西维尔眼中的梅林候选；evil-ally=坏人眼中的同伙 */
  kind: 'evil' | 'merlin-candidate' | 'evil-ally';
  playerId: PlayerId;
  name: string;
}

export interface AvalonViewPlayer {
  id: PlayerId;
  name: string;
  seat: number;
  isLeader: boolean;
  /** 仅终局公开身份 */
  role?: AvalonRole;
}

export interface AvalonView extends GameView {
  game: 'avalon';
  phase: AvalonPhase;
  you: PlayerId;
  yourRole: AvalonRole;
  /** 夜晚情报（按角色过滤后的可见信息） */
  nightInfo: AvalonNightInfo[];
  players: AvalonViewPlayer[];
  mission: number;
  missionSizes: number[];
  leader: PlayerId;
  proposal: PlayerId[] | null;
  /** 已投票玩家（投票方向不公开，投票截止后见 history 末条） */
  voted: PlayerId[];
  questTeam: PlayerId[] | null;
  /** 已提交任务票的玩家（任务票全程匿名） */
  questSubmitted: PlayerId[];
  results: ('success' | 'fail')[];
  failedProposals: number;
  history: AvalonMissionRecord[];
  youAreAssassin: boolean;
  assassination: PlayerId | null;
  winner: AvalonSide | null;
  winReason: string | null;
}

/** 按角色计算夜晚情报（信息隐藏的核心） */
function nightInfo(role: AvalonRole, me: PlayerId, state: AvalonState): AvalonNightInfo[] {
  const info: AvalonNightInfo[] = [];
  const evilPlayers = state.players.filter(
    (p) => ROLE_INFO[state.roles[p.id]!]!.side === 'evil',
  );
  if (role === 'merlin') {
    // 梅林看到所有坏人，莫德雷德除外
    for (const p of evilPlayers) {
      if (state.roles[p.id] !== 'mordred') {
        info.push({ kind: 'evil', playerId: p.id, name: p.name });
      }
    }
  } else if (role === 'percival') {
    // 派西维尔看到梅林与莫甘娜，不区分
    for (const p of state.players) {
      const r = state.roles[p.id]!;
      if (r === 'merlin' || r === 'morgana') {
        info.push({ kind: 'merlin-candidate', playerId: p.id, name: p.name });
      }
    }
  } else if (ROLE_INFO[role]!.side === 'evil' && role !== 'oberon') {
    // 坏人互认，奥伯伦除外
    for (const p of evilPlayers) {
      if (p.id !== me && state.roles[p.id] !== 'oberon') {
        info.push({ kind: 'evil-ally', playerId: p.id, name: p.name });
      }
    }
  }
  return info;
}

/* ---------- 动作处理 ---------- */

function applyPropose(
  state: AvalonState,
  action: Extract<AvalonAction, { t: 'propose' }>,
  from: PlayerId,
): { state: AvalonState; events: GameEvent[] } {
  if (state.phase !== 'propose') throw new Error('当前不是提名阶段');
  const leader = state.players[state.leaderIdx]!;
  if (from !== leader.id) throw new Error('只有队长能提名');
  const team = action.team;
  if (!Array.isArray(team)) throw new Error('队伍格式错误');
  const need = CONFIG[state.players.length]!.missionSizes[state.mission]!;
  if (team.length !== need) throw new Error(`本次任务需要 ${need} 名队员`);
  const ids = new Set(state.players.map((p) => p.id));
  const seen = new Set<PlayerId>();
  for (const id of team) {
    if (!ids.has(id)) throw new Error('队伍中存在不存在的玩家');
    if (seen.has(id)) throw new Error('队伍中不能有重复玩家');
    seen.add(id);
  }
  return {
    state: { ...state, phase: 'vote', proposal: team.slice(), votes: {} },
    events: [{ type: 'propose', from, team: team.slice() }],
  };
}

function applyVote(
  state: AvalonState,
  action: Extract<AvalonAction, { t: 'vote' }>,
  from: PlayerId,
): { state: AvalonState; events: GameEvent[] } {
  if (state.phase !== 'vote') throw new Error('当前不是投票阶段');
  if (!state.players.some((p) => p.id === from)) throw new Error('你不在本局中');
  if (from in state.votes) throw new Error('你已经投过票了');
  const votes = { ...state.votes, [from]: action.approve === true };
  if (Object.keys(votes).length < state.players.length) {
    return {
      state: { ...state, votes },
      events: [{ type: 'vote', from }],
    };
  }
  // 全员投票完毕，唱票（投票公开）
  const approveCount = Object.values(votes).filter(Boolean).length;
  const passed = approveCount > state.players.length / 2; // 多数赞成；平票视为否决
  const leader = state.players[state.leaderIdx]!;
  const record: AvalonMissionRecord = {
    index: state.mission,
    leader: leader.id,
    team: state.proposal!,
    votes: { ...votes },
    passed,
  };
  const history = [...state.history, record];
  if (passed) {
    return {
      state: {
        ...state,
        votes,
        phase: 'quest',
        questTeam: state.proposal,
        questVotes: {},
        failedProposals: 0,
        history,
      },
      events: [
        { type: 'vote-reveal', passed, votes: { ...votes } },
        { type: 'quest-start', team: state.proposal! },
      ],
    };
  }
  const failed = state.failedProposals + 1;
  if (failed >= 5) {
    // 连续 5 次提名被否，坏人直接获胜
    return {
      state: {
        ...state,
        votes,
        phase: 'finished',
        failedProposals: failed,
        history,
        winner: 'evil',
        winReason: '连续五次提名被否决，坏人直接获胜',
      },
      events: [
        { type: 'vote-reveal', passed, votes: { ...votes } },
        { type: 'win', winner: 'evil', reason: '连续五次提名被否决' },
      ],
    };
  }
  return {
    state: {
      ...state,
      votes,
      phase: 'propose',
      leaderIdx: (state.leaderIdx + 1) % state.players.length,
      proposal: null,
      failedProposals: failed,
      history,
    },
    events: [{ type: 'vote-reveal', passed, votes: { ...votes } }],
  };
}

function applyQuest(
  state: AvalonState,
  action: Extract<AvalonAction, { t: 'quest' }>,
  from: PlayerId,
): { state: AvalonState; events: GameEvent[] } {
  if (state.phase !== 'quest') throw new Error('当前不是任务执行阶段');
  const team = state.questTeam!;
  if (!team.includes(from)) throw new Error('你不是本次任务的队员');
  if (from in state.questVotes) throw new Error('你已经投过任务票了');
  const v = action.vote;
  if (v !== 'success' && v !== 'fail') throw new Error('任务票格式错误');
  if (ROLE_INFO[state.roles[from]!]!.side === 'good' && v === 'fail') {
    throw new Error('好人只能投任务成功');
  }
  const questVotes = { ...state.questVotes, [from]: v };
  if (Object.keys(questVotes).length < team.length) {
    return {
      state: { ...state, questVotes },
      events: [{ type: 'quest-vote', from }],
    };
  }
  // 任务结算（任务票匿名，只公开张数）
  const failCount = Object.values(questVotes).filter((x) => x === 'fail').length;
  const successCount = team.length - failCount;
  const need = failsRequired(state.mission, state.players.length);
  const result: 'success' | 'fail' = failCount >= need ? 'fail' : 'success';
  const results = [...state.results, result];
  const history = state.history.slice();
  history[history.length - 1] = {
    ...history[history.length - 1]!,
    result,
    successCount,
    failCount,
  };
  const successTotal = results.filter((r) => r === 'success').length;
  const failTotal = results.length - successTotal;
  const base: AvalonState = {
    ...state,
    questVotes,
    results,
    history,
    questTeam: null,
  };
  const events: GameEvent[] = [
    { type: 'quest-result', result, successCount, failCount },
  ];
  if (successTotal >= 3) {
    // 好人完成三次任务，进入刺杀阶段
    return {
      state: { ...base, phase: 'assassinate', mission: state.mission + 1 },
      events: [...events, { type: 'assassinate-start' }],
    };
  }
  if (failTotal >= 3) {
    return {
      state: {
        ...base,
        phase: 'finished',
        mission: state.mission + 1,
        winner: 'evil',
        winReason: '三次任务失败，坏人获胜',
      },
      events: [...events, { type: 'win', winner: 'evil', reason: '三次任务失败' }],
    };
  }
  return {
    state: {
      ...base,
      phase: 'propose',
      mission: state.mission + 1,
      leaderIdx: (state.leaderIdx + 1) % state.players.length,
      proposal: null,
    },
    events,
  };
}

function applyAssassinate(
  state: AvalonState,
  action: Extract<AvalonAction, { t: 'assassinate' }>,
  from: PlayerId,
): { state: AvalonState; events: GameEvent[] } {
  if (state.phase !== 'assassinate') throw new Error('当前不是刺杀阶段');
  const assassin = state.players.find((p) => state.roles[p.id] === 'assassin')!;
  if (from !== assassin.id) throw new Error('只有刺客能执行刺杀');
  const target = state.players.find((p) => p.id === action.target);
  if (!target) throw new Error('刺杀目标不存在');
  const hit = state.roles[target.id] === 'merlin';
  return {
    state: {
      ...state,
      phase: 'finished',
      assassination: target.id,
      winner: hit ? 'evil' : 'good',
      winReason: hit
        ? '刺客刺中了梅林，坏人获胜'
        : '三次任务成功，且刺客未刺中梅林，好人获胜',
    },
    events: [{ type: 'assassinate', from, target: target.id, hit }],
  };
}

/* ---------- GameDefinition ---------- */

export const avalon: GameDefinition<AvalonState, AvalonAction> = {
  meta: {
    id: 'avalon',
    name: '阿瓦隆',
    tagline: '忠诚与阴谋，任务之争',
    minPlayers: 5,
    maxPlayers: 10,
    theme: '#8b5cf6',
    rules: `## 阿瓦隆

5~10 人，好人阵营 vs 坏人阵营，共 5 次任务。

### 身份

- 好人：梅林（能看到除莫德雷德外的坏人）、派西维尔（能看到梅林与莫甘娜，不区分）、亚瑟忠臣。
- 坏人：刺客（终局刺梅林）、莫甘娜（混淆派西维尔）、莫德雷德（对梅林隐身）、奥伯伦（不与坏人互认）、爪牙。

### 流程

1. 队长顺时针轮换，提名本次任务的队伍。
2. 全员公开投票，多数赞成则执行任务；平票或多数反对则换队长重提。连续 5 次提名被否，坏人直接获胜。
3. 任务队员秘密投「成功 / 失败」：好人只能成功，坏人可投失败。1 张失败票即任务失败（第 4 次任务在 7 人及以上时需 2 张失败票）。
4. 好人完成 3 次任务后进入刺杀阶段：刺客指定一人，若为梅林则坏人胜，否则好人胜。
5. 坏人完成 3 次任务即获胜。`,
  },
  id: 'avalon',
  minPlayers: 5,
  maxPlayers: 10,
  defaultOptions: {},

  start(players: PlayerInfo[], _options: GameOptions, rng: Rng): AvalonState {
    const sorted = [...players].sort((a, b) => a.seat - b.seat);
    const n = sorted.length;
    if (!CONFIG[n]) throw new Error(`阿瓦隆支持 5~10 人，当前 ${n} 人`);
    const roles = shuffle(buildRoles(n), rng);
    const roleMap: Record<PlayerId, AvalonRole> = {};
    sorted.forEach((p, i) => {
      roleMap[p.id] = roles[i]!;
    });
    return {
      players: sorted,
      roles: roleMap,
      phase: 'propose',
      mission: 0,
      leaderIdx: Math.floor(rng() * n),
      proposal: null,
      votes: {},
      questTeam: null,
      questVotes: {},
      results: [],
      failedProposals: 0,
      history: [],
      assassination: null,
      winner: null,
      winReason: null,
    };
  },

  apply(state, action, from) {
    if (state.phase === 'finished') throw new Error('对局已结束');
    switch (action.t) {
      case 'propose':
        return applyPropose(state, action, from);
      case 'vote':
        return applyVote(state, action, from);
      case 'quest':
        return applyQuest(state, action, from);
      case 'assassinate':
        return applyAssassinate(state, action, from);
      default:
        throw new Error('未知动作');
    }
  },

  view(state, viewer): AvalonView {
    const role = state.roles[viewer]!;
    const finished = state.phase === 'finished';
    return {
      game: 'avalon',
      phase: state.phase,
      you: viewer,
      yourRole: role,
      nightInfo: nightInfo(role, viewer, state),
      players: state.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        isLeader: i === state.leaderIdx,
        ...(finished ? { role: state.roles[p.id]! } : {}),
      })),
      mission: state.mission,
      missionSizes: CONFIG[state.players.length]!.missionSizes,
      leader: state.players[state.leaderIdx]!.id,
      proposal: state.proposal ? [...state.proposal] : null,
      voted: Object.keys(state.votes),
      questTeam: state.questTeam ? [...state.questTeam] : null,
      questSubmitted: Object.keys(state.questVotes),
      results: [...state.results],
      failedProposals: state.failedProposals,
      history: state.history.map((r) => ({ ...r, votes: { ...r.votes }, team: [...r.team] })),
      youAreAssassin: role === 'assassin',
      assassination: state.assassination,
      winner: state.winner,
      winReason: state.winReason,
    };
  },

  turn(state): TurnInfo {
    switch (state.phase) {
      case 'propose': {
        const leader = state.players[state.leaderIdx]!;
        return {
          active: [leader.id],
          phase: 'propose',
          hint: `等待 ${leader.name} 提名任务队伍`,
        };
      }
      case 'vote': {
        const pending = state.players
          .filter((p) => !(p.id in state.votes))
          .map((p) => p.id);
        return { active: pending, phase: 'vote', hint: '请全体投票（赞成 / 反对）' };
      }
      case 'quest': {
        const pending = (state.questTeam ?? []).filter((id) => !(id in state.questVotes));
        return { active: pending, phase: 'quest', hint: '任务队员秘密投票（成功 / 失败）' };
      }
      case 'assassinate': {
        const assassin = state.players.find((p) => state.roles[p.id] === 'assassin')!;
        return { active: [assassin.id], phase: 'assassinate', hint: '刺客，请选择刺杀目标' };
      }
      case 'finished':
        return { active: [], phase: 'finished', hint: state.winReason ?? '对局结束' };
    }
  },

  result(state): GameResult | null {
    if (!state.winner) return null;
    const good = state.players
      .filter((p) => ROLE_INFO[state.roles[p.id]!]!.side === 'good')
      .map((p) => p.id);
    const evil = state.players
      .filter((p) => ROLE_INFO[state.roles[p.id]!]!.side === 'evil')
      .map((p) => p.id);
    return {
      winners: state.winner === 'good' ? good : evil,
      teams: { 好人: good, 坏人: evil },
      reason: state.winReason ?? undefined,
    };
  },
};

registerGame(avalon);
