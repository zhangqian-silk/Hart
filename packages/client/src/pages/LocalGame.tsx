import { useMemo, useState } from 'react';
import {
  createLocalHost,
  getGame,
  type GameId,
  type PlayerInfo,
} from '@hart/common';
import { gameUIs } from '../games';

/**
 * 本地试玩模式：/local/<gameId>?players=N
 * 用 LocalHost 在浏览器里直接跑游戏，可切换视角，便于开发/调试游戏 UI。
 */
export default function LocalGame({ gameId }: { gameId: GameId }) {
  const players = useMemo<PlayerInfo[]>(() => {
    const meta = getGame(gameId)?.meta;
    const requested = Number(new URLSearchParams(location.search).get('players'));
    const fallback = meta?.minPlayers ?? 3;
    const n = Number.isFinite(requested) && requested > 0
      ? Math.min(meta?.maxPlayers ?? requested, Math.max(meta?.minPlayers ?? 1, Math.floor(requested)))
      : fallback;
    return Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      name: `玩家${i + 1}`,
      seat: i,
    }));
  }, []);

  const [host, setHost] = useState(() => createLocalHost(gameId, players, {}, Math.random));
  const [viewer, setViewer] = useState(players[0]!.id);
  const [, force] = useState(0);

  const GameUI = gameUIs[gameId];
  if (!GameUI) return <div className="p-8 text-slate-400">未知游戏 {gameId}</div>;

  const refresh = () => force((x) => x + 1);

  return (
    <div className="min-h-full flex flex-col">
      <header className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-b border-white/10">
        <a href="/" className="btn-ghost px-3 py-1 text-xs">
          ← 大厅
        </a>
        <span className="text-sm text-slate-400 shrink-0">本地试玩</span>
        <div className="flex-1 min-w-4" />
        <div className="basis-full sm:basis-auto flex items-center justify-end gap-1.5 flex-wrap">
          <span className="text-xs text-slate-400 mr-1 shrink-0">视角：</span>
          {players.map((p) => (
            <button
              key={p.id}
              className={`btn px-2.5 sm:px-3 py-1 text-xs ${
                viewer === p.id ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-300'
              }`}
              onClick={() => setViewer(p.id)}
            >
              {p.name}
            </button>
          ))}
          <button
            className="btn-ghost px-3 py-1 text-xs ml-1"
            onClick={() => {
              setHost(createLocalHost(gameId, players, {}, Math.random));
              refresh();
            }}
          >
            重开
          </button>
        </div>
      </header>
      <main className="flex-1 flex items-start justify-center p-6 overflow-auto">
        <GameUI
          view={host.view(viewer)}
          turn={host.turn()}
          result={host.result()}
          me={viewer}
          players={players}
          send={(action) => {
            host.act(action, viewer);
            refresh();
          }}
        />
      </main>
    </div>
  );
}
