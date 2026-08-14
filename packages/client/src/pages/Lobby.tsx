import { useMemo, useState } from 'react';
import { listGames, type GameId, type GameMeta } from '@hart/common';
import { net } from '../net/client';
import { useGame } from '../store/game';
import { Modal } from '../ui';

const ICONS: Record<GameId, string> = {
  wuziqi: '⚫',
  doudizhu: '🃏',
  yiyelang: '🐺',
  avalon: '🛡️',
};

const GAME_THEMES: Record<GameId, { gradient: string; glow: string; pattern: string }> = {
  wuziqi: {
    gradient: 'from-amber-500/20 to-orange-600/10',
    glow: 'hover:shadow-amber-500/20',
    pattern: 'radial-gradient(circle at 30% 30%, rgba(245,158,11,0.15), transparent 60%)',
  },
  doudizhu: {
    gradient: 'from-blue-500/20 to-cyan-600/10',
    glow: 'hover:shadow-blue-500/20',
    pattern: 'radial-gradient(circle at 70% 30%, rgba(59,130,246,0.15), transparent 60%)',
  },
  yiyelang: {
    gradient: 'from-red-500/20 to-rose-600/10',
    glow: 'hover:shadow-red-500/20',
    pattern: 'radial-gradient(circle at 30% 70%, rgba(239,68,68,0.15), transparent 60%)',
  },
  avalon: {
    gradient: 'from-purple-500/20 to-violet-600/10',
    glow: 'hover:shadow-purple-500/20',
    pattern: 'radial-gradient(circle at 70% 70%, rgba(168,85,247,0.15), transparent 60%)',
  },
};

export default function Lobby() {
  const GAMES = listGames();
  const name = useGame((s) => s.name);
  const setName = useGame((s) => s.setName);
  const hello = useGame((s) => s.hello);
  const [filter, setFilter] = useState<number | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [rulesGame, setRulesGame] = useState<GameMeta | null>(null);

  const games = useMemo(
    () =>
      GAMES.filter(
        (g) => filter === null || (g.minPlayers <= filter && g.maxPlayers >= filter),
      ),
    [filter],
  );

  const createRoom = (game: GameId) => {
    if (!name.trim()) {
      useGame.getState().toastMsg('请先输入昵称');
      return;
    }
    net.send({ t: 'room.create', game });
  };

  const joinRoom = () => {
    if (!name.trim()) {
      useGame.getState().toastMsg('请先输入昵称');
      return;
    }
    if (joinCode.trim()) {
      net.send({ t: 'room.join', code: joinCode.trim().toUpperCase() });
    }
  };

  return (
    <div className="min-h-full flex flex-col items-center py-10 px-4">
      <header className="text-center mb-8">
        <h1 className="text-4xl font-black tracking-wide mb-2">
          <span className="bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300 bg-clip-text text-transparent">
            Hart 桌游
          </span>
        </h1>
        <p className="text-slate-400 text-sm">聚会不用带道具，打开网页就能玩</p>
      </header>

      <div className="glass px-4 py-3 flex items-center gap-3 mb-8 w-full max-w-md">
        <input
          className="input flex-1 bg-transparent border-0 focus:ring-0 px-1"
          placeholder="输入你的昵称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && hello()}
          maxLength={12}
        />
        <div className="flex gap-2">
          <input
            className="input w-28 text-center uppercase tracking-widest"
            placeholder="房间号"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            maxLength={4}
          />
          <button className="btn-ghost" onClick={joinRoom}>
            加入
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap justify-center">
        {[null, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <button
            key={n ?? 'all'}
            className={`btn px-3 py-1 text-xs rounded-full ${
              filter === n ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-300'
            }`}
            onClick={() => setFilter(n)}
          >
            {n === null ? '全部' : `${n} 人`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
        {games.map((g) => (
          <div
            key={g.id}
            className={`relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${GAME_THEMES[g.id].gradient} backdrop-blur-md p-5 flex items-center gap-4 transition-all duration-300 hover:scale-[1.02] hover:border-white/20 hover:shadow-xl ${GAME_THEMES[g.id].glow} group cursor-pointer`}
            onClick={() => createRoom(g.id)}
          >
            <div
              className="absolute inset-0 opacity-50"
              style={{ background: GAME_THEMES[g.id].pattern }}
            />
            <div className="relative z-10 w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 bg-white/10 border border-white/10 group-hover:scale-110 transition-transform">
              {ICONS[g.id]}
            </div>
            <div className="relative z-10 flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg">{g.name}</span>
                <span className="text-xs text-slate-400 bg-white/5 px-1.5 py-0.5 rounded-full">
                  {g.minPlayers === g.maxPlayers
                    ? `${g.minPlayers} 人`
                    : `${g.minPlayers}-${g.maxPlayers} 人`}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">{g.tagline}</p>
            </div>
            <div className="relative z-10 flex flex-col gap-1.5 shrink-0">
              <button
                className="btn-primary px-3 py-1.5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: g.theme }}
                onClick={(e) => { e.stopPropagation(); createRoom(g.id); }}
              >
                创建房间
              </button>
              <div className="flex gap-1.5">
                {g.id === 'wuziqi' && (
                  <a
                    href="/local/wuziqi?players=2"
                    className="btn-ghost px-3 py-1 text-xs flex-1 justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    本地
                  </a>
                )}
                <button
                  className="btn-ghost px-3 py-1 text-xs flex-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); setRulesGame(g); }}
                >
                  规则
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!rulesGame} onClose={() => setRulesGame(null)} title={rulesGame?.name ?? ''}>
        <pre className="whitespace-pre-wrap font-sans text-sm text-slate-300">
          {rulesGame?.rules}
        </pre>
      </Modal>
    </div>
  );
}
