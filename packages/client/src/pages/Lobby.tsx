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
    <div className="min-h-full flex flex-col items-center py-10 sm:py-14 px-4">
      <header className="text-center mb-8">
        <div className="inline-flex items-center gap-2 mb-3 text-[11px] tracking-widest uppercase text-indigo-300/80 bg-indigo-500/10 border border-indigo-400/20 rounded-full px-3 py-1">
          🐴 在线桌游合集
        </div>
        <h1 className="text-5xl font-black tracking-tight mb-2">
          <span className="bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300 bg-clip-text text-transparent">
            Hart 桌游
          </span>
        </h1>
        <p className="text-slate-400 text-sm">聚会不用带道具，打开网页就能玩</p>
        <div className="flex items-center justify-center gap-2 mt-3">
          <a
            href="/agents"
            className="inline-flex items-center gap-1.5 text-xs text-indigo-300/80 hover:text-indigo-200 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-400/20 rounded-full px-3 py-1 transition-colors"
          >
            🤖 Agent 配置
          </a>
          <a
            href="/system"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-3 py-1 transition-colors"
          >
            ⚙️ 系统设置
          </a>
        </div>
      </header>

      <div className="glass p-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-8 w-full max-w-lg">
        <div className="flex items-center gap-2 flex-1 px-2">
          <span className="text-slate-500 text-sm shrink-0" aria-hidden>👤</span>
          <input
            className="flex-1 bg-transparent border-0 outline-none text-sm text-slate-100 placeholder:text-slate-500 py-2"
            placeholder="输入你的昵称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && hello()}
            maxLength={12}
            aria-label="昵称"
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <input
            className="input w-28 text-center uppercase tracking-widest"
            placeholder="房间号"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            maxLength={4}
            aria-label="房间号"
          />
          <button className="btn-primary px-5" onClick={joinRoom}>
            加入
          </button>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap justify-center">
        {[null, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <button
            key={n ?? 'all'}
            className={`btn px-3.5 py-1 text-xs rounded-full ${
              filter === n
                ? 'bg-indigo-500 text-white shadow shadow-indigo-500/30'
                : 'bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
            onClick={() => setFilter(n)}
          >
            {n === null ? '全部' : `${n} 人`}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-3xl">
        {games.map((g, i) => (
          <div
            key={g.id}
            className={`card-in relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br ${GAME_THEMES[g.id].gradient} backdrop-blur-md p-5 flex flex-col gap-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:shadow-xl ${GAME_THEMES[g.id].glow} group`}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div
              className="absolute inset-0 opacity-60 pointer-events-none"
              style={{ background: GAME_THEMES[g.id].pattern }}
            />
            <div className="relative z-10 flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0 bg-white/10 border border-white/15 group-hover:scale-105 transition-transform"
                style={{ boxShadow: `0 6px 20px ${g.theme}22` }}
              >
                {ICONS[g.id]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-lg leading-tight">{g.name}</span>
                  <span className="chip whitespace-nowrap text-[11px] py-0" style={{ color: g.theme }}>
                    {g.minPlayers === g.maxPlayers
                      ? `${g.minPlayers} 人`
                      : `${g.minPlayers}-${g.maxPlayers} 人`}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1 line-clamp-2">{g.tagline}</p>
              </div>
            </div>
            <div className="relative z-10 flex gap-2">
              <button
                className="btn-primary flex-1 py-2 text-sm"
                style={{
                  background: `linear-gradient(to bottom, ${g.theme}, ${g.theme}cc)`,
                  boxShadow: `0 8px 20px ${g.theme}40`,
                }}
                onClick={() => createRoom(g.id)}
              >
                创建房间
              </button>
              {g.id === 'wuziqi' && (
                <a
                  href="/local/wuziqi?players=2"
                  className="btn-ghost px-4 py-2 text-sm"
                >
                  本地
                </a>
              )}
              <button
                className="btn-ghost px-4 py-2 text-sm"
                onClick={() => setRulesGame(g)}
              >
                规则
              </button>
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
