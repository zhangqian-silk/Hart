import { seededRng, type GameId, type PlayerInfo } from '@hart/common';
import { BUILTIN_PROFILES, getProfile } from './profiles.js';
import { ScriptedProvider } from './provider/scripted.js';
import { playGame, type AgentSeat, type GameTranscript } from './host.js';

export interface ArenaStanding {
  profileId: string;
  name: string;
  wins: number;
  losses: number;
  winRate: number;
  avgDurationMs: number;
}

export interface ArenaReport {
  gameId: GameId;
  games: number;
  standings: ArenaStanding[];
  transcripts: GameTranscript[];
}

export interface ArenaConfig {
  gameId: GameId;
  games?: number;
  /** 参与的 profile id 列表，默认全部内置 */
  profileIds?: string[];
  seed?: number;
}

const GAME_PLAYERS: Record<GameId, number> = {
  wuziqi: 2,
  doudizhu: 3,
  yiyelang: 5,
  avalon: 5,
};

/**
 * 评估体系（V8: Agent 评估）。
 * 用多组 profile 跑 N 局自对弈，统计胜率。
 */
export async function runArena(config: ArenaConfig): Promise<ArenaReport> {
  const { gameId } = config;
  const games = config.games ?? 10;
  const profileIds = config.profileIds ?? BUILTIN_PROFILES.map((p) => p.id);
  const profiles = profileIds
    .map((id) => getProfile(id))
    .filter((p): p is NonNullable<typeof p> => !!p);
  if (profiles.length === 0) throw new Error('没有可用的 profile');

  const playerCount = GAME_PLAYERS[gameId];
  const rng = seededRng(config.seed ?? Date.now() % 100000);
  const transcripts: GameTranscript[] = [];
  const stats = new Map<string, { wins: number; losses: number; totalMs: number }>();

  for (let g = 0; g < games; g++) {
    // 随机分配 profile 到座位
    const seats: AgentSeat[] = [];
    for (let i = 0; i < playerCount; i++) {
      const profile = profiles[Math.floor(rng() * profiles.length)]!;
      seats.push({
        player: { id: `p${i}`, name: `${profile.name}-${i}`, seat: i } as PlayerInfo,
        profile,
        provider: new ScriptedProvider(profile),
      });
    }
    const transcript = await playGame(gameId, seats, {}, rng);
    transcripts.push(transcript);

    // 统计胜负
    const winners = new Set(transcript.result?.winners ?? []);
    for (const seat of seats) {
      const pid = seat.player.id;
      const s = stats.get(seat.profile.id) ?? { wins: 0, losses: 0, totalMs: 0 };
      if (winners.has(pid)) s.wins++;
      else s.losses++;
      s.totalMs += transcript.durationMs;
      stats.set(seat.profile.id, s);
    }
  }

  const standings: ArenaStanding[] = [...stats.entries()].map(([profileId, s]) => {
    const profile = profiles.find((p) => p.id === profileId)!;
    const total = s.wins + s.losses;
    return {
      profileId,
      name: profile.name,
      wins: s.wins,
      losses: s.losses,
      winRate: total > 0 ? s.wins / total : 0,
      avgDurationMs: total > 0 ? s.totalMs / total : 0,
    };
  });
  standings.sort((a, b) => b.winRate - a.winRate || b.wins - a.wins);

  return { gameId, games, standings, transcripts };
}
