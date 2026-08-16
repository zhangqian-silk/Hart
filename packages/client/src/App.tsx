import { useEffect } from 'react';
import { useGame, bindNet } from './store/game';
import { net } from './net/client';
import Lobby from './pages/Lobby';
import Room from './pages/Room';
import LocalGame from './pages/LocalGame';
import Agents from './pages/Agents';
import System from './pages/System';
import MyModels from './pages/MyModels';
import type { GameId } from '@hart/common';
import { Toast } from './ui';

export default function App() {
  const room = useGame((s) => s.room);
  const toast = useGame((s) => s.toast);
  const connected = useGame((s) => s.connected);

  const localMatch = location.pathname.match(/^\/local\/(\w+)/);
  const localGame = localMatch?.[1] as GameId | undefined;
  const isAgents = location.pathname === '/agents';
  const isSystem = location.pathname === '/system';
  const isModels = location.pathname === '/models';

  useEffect(() => {
    bindNet();
    net.connect();
    const onOpen = () => useGame.getState().hello();
    net.onStatus = (c) => {
      useGame.setState({ connected: c });
      if (c) onOpen();
    };
    // 启动时拉取系统配置并应用主题
    fetch('/api/system')
      .then((r) => r.json())
      .then((data: { theme?: string }) => {
        if (data.theme === 'light' || data.theme === 'dark') {
          document.documentElement.dataset.theme = data.theme;
        }
      })
      .catch(() => {});
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
      ) : isAgents ? (
        <Agents />
      ) : isSystem ? (
        <System />
      ) : isModels ? (
        <MyModels />
      ) : room ? (
        <Room />
      ) : (
        <Lobby />
      )}
      <Toast message={toast} />
    </div>
  );
}
