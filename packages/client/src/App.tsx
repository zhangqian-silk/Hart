import { useEffect } from 'react';
import { useGame, bindNet } from './store/game';
import { net } from './net/client';
import Lobby from './pages/Lobby';
import Room from './pages/Room';
import LocalGame from './pages/LocalGame';
import type { GameId } from '@hart/common';
import { Toast } from './ui';

export default function App() {
  const room = useGame((s) => s.room);
  const toast = useGame((s) => s.toast);
  const connected = useGame((s) => s.connected);

  const localMatch = location.pathname.match(/^\/local\/(\w+)/);
  const localGame = localMatch?.[1] as GameId | undefined;

  useEffect(() => {
    bindNet();
    net.connect();
    const onOpen = () => useGame.getState().hello();
    net.onStatus = (c) => {
      useGame.setState({ connected: c });
      if (c) onOpen();
    };
  }, []);

  return (
    <div className="h-full flex flex-col">
      {!connected && (
        <div className="bg-amber-500/20 text-amber-300 text-xs text-center py-1">
          连接中…
        </div>
      )}
      {localGame ? (
        <LocalGame key={localGame} gameId={localGame} />
      ) : room ? (
        <Room />
      ) : (
        <Lobby />
      )}
      <Toast message={toast} />
    </div>
  );
}
