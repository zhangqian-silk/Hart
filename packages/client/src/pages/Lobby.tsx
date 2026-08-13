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
            className="glass p-5 flex items-center gap-4 hover:bg-white/10 transition-colors group"
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl shrink-0"
              style={{ background: `${g.theme}22`, boxShadow: `0 0 24px ${g.theme}44` }}
            >
              {ICONS[g.id]}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg">{g.name}</span>
                <span className="text-xs text-slate-400">
                  {g.minPlayers === g.maxPlayers
                    ? `${g.minPlayers} 人`
                    : `${g.minPlayers}-${g.maxPlayers} 人`}
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">{g.tagline}</p>
            </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <button
                  className="btn-primary px-3 py-1.5 text-xs"
                  style={{ background: g.theme }}
                  onClick={() => createRoom(g.id)}
                >
                  创建房间
                </button>
                <div className="flex gap-1.5">
                  {g.id === 'wuziqi' && (
                    <a
                      href="/local/wuziqi?players=2"
                      className="btn-ghost px-3 py-1 text-xs flex-1 justify-center"
                    >
                      本地对战
                    </a>
                  )}
                  <button
                    className="btn-ghost px-3 py-1 text-xs flex-1"
                    onClick={() => setRulesGame(g)}
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
