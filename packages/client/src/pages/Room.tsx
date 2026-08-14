import { useEffect, useRef, useState } from 'react';
import { getGame, type GameMeta, type RoomView } from '@hart/common';
import { net } from '../net/client';
import { useGame } from '../store/game';
import { Avatar, Badge, Modal, Seat } from '../ui';
import { gameUIs } from '../games';

export default function Room() {
  const room = useGame((s) => s.room);
  const me = useGame((s) => s.me);
  const setRoom = useGame((s) => s.setRoom);
  const agentProfiles = useGame((s) => s.agentProfiles);
  const addAgent = useGame((s) => s.addAgent);
  const removeAgent = useGame((s) => s.removeAgent);
  const [chat, setChat] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [room?.chat.length]);

  if (!room) return null;
  const meta = getGame(room.game)?.meta as GameMeta | undefined;
  const mySeat = room.seats.find((s) => s.player?.id === me);
  const isHost = room.host === me;
  const playing = room.status !== 'waiting';
  const GameUI = gameUIs[room.game];

  const sendChat = () => {
    if (chat.trim()) {
      net.send({ t: 'room.chat', text: chat.trim() });
      setChat('');
    }
  };

  const leaveRoom = () => {
    net.send({ t: 'room.leave' });
    // 服务端会从房间成员中移除当前会话，但不会再向离开的会话广播 room.state。
    // 先清理本地状态，确保点击离开后立即回到大厅。
    setRoom(null);
  };

  return (
    <div className="min-h-full flex flex-col">
      {/* 顶栏 */}
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/10 bg-white/[0.02] backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <button className="btn-ghost px-3 py-1 text-xs" onClick={leaveRoom}>
            ← 离开
          </button>
          <span className="font-bold">{meta?.name}</span>
          <Badge tone="amber">房间 {room.code}</Badge>
          <button
            className="text-xs text-slate-400 hover:text-white transition-colors"
            onClick={() => navigator.clipboard?.writeText(room.code)}
            title="复制房间号"
          >
            📋 复制
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setShowRules(true)}>
            规则
          </button>
          {isHost && !playing && (
            <>
              <button
                className="btn-ghost px-3 py-1 text-xs"
                onClick={() => setShowAddAgent(true)}
              >
                🤖 添加 AI
              </button>
              <button
                className="btn-primary px-4 py-1 text-xs"
                onClick={() => net.send({ t: 'room.start' })}
              >
                开始游戏
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 max-w-7xl w-full mx-auto">
        {/* 主区 */}
        <div className={`flex-1 flex flex-col items-center justify-center rounded-3xl min-h-[460px] ${playing ? '' : 'felt-table py-8'}`}>
          {!playing ? (
            <WaitingRoom
              seats={room.seats}
              me={me!}
              isHost={isHost}
              meta={meta}
              onRemoveAgent={removeAgent}
            />
          ) : (
            <div className="relative w-full flex flex-col items-center">
              {GameUI &&
                room.gameState && (
                  <GameUI
                    view={room.gameState.view}
                    turn={room.gameState.turn}
                    result={room.gameState.result}
                    me={me!}
                    players={room.seats.filter((s) => s.player).map((s, i) => ({
                      id: s.player!.id,
                      name: s.player!.name,
                      seat: i,
                    }))}
                    send={(action) => net.send({ t: 'game.action', action })}
                  />
                )}
              {room.status === 'finished' && (
                <div className="mt-6 flex gap-3">
                  {isHost && (
                    <button
                      className="btn-primary"
                      onClick={() => net.send({ t: 'room.start' })}
                    >
                      再来一局
                    </button>
                  )}
                  <button className="btn-ghost" onClick={leaveRoom}>
                    返回大厅
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 侧栏：座位 + 聊天 */}
        <aside className="w-full lg:w-72 flex flex-col gap-4">
          <div className="glass p-4">
            <h3 className="text-xs font-semibold text-slate-400 mb-3 flex items-center gap-1.5 uppercase tracking-wide">
              <span aria-hidden>👥</span> 玩家
              <span className="ml-auto normal-case text-slate-500">
                {room.seats.filter((s) => s.player).length}/{room.seats.length}
              </span>
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {room.seats.map((s) => (
                <Seat
                  key={s.seat}
                  name={s.player?.name}
                  ready={s.ready}
                  isHost={s.isHost}
                  online={s.online}
                  agent={s.agent}
                />
              ))}
            </div>
          </div>
          <div className="glass p-4 flex-1 flex flex-col min-h-[200px]">
            <h3 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1.5 uppercase tracking-wide">
              <span aria-hidden>💬</span> 聊天
            </h3>
            <div ref={chatRef} className="flex-1 overflow-y-auto space-y-1.5 mb-2 max-h-64">
              {room.chat.length === 0 && (
                <p className="text-xs text-slate-600 py-4 text-center">还没有消息，打个招呼吧～</p>
              )}
              {room.chat.map((m) => (
                <div key={m.id} className="text-xs">
                  {m.system ? (
                    <span className="text-slate-500 italic">· {m.text}</span>
                  ) : (
                    <>
                      <span className="text-indigo-300 font-medium">{m.name}：</span>
                      <span className="text-slate-300">{m.text}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className="input flex-1 text-xs"
                placeholder="说点什么…"
                value={chat}
                onChange={(e) => setChat(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                maxLength={200}
              />
              <button className="btn-ghost px-3 py-1 text-xs" onClick={sendChat}>
                发送
              </button>
            </div>
          </div>
        </aside>
      </div>

      <Modal open={showRules} onClose={() => setShowRules(false)} title={meta?.name ?? ''}>
        <pre className="whitespace-pre-wrap font-sans text-sm text-slate-300">{meta?.rules}</pre>
      </Modal>

      <Modal open={showAddAgent} onClose={() => setShowAddAgent(false)} title="添加 AI 玩家">
        <div className="space-y-2">
          {agentProfiles.length === 0 && (
            <p className="text-sm text-slate-400">暂无可用 AI 档案</p>
          )}
          {agentProfiles.map((p) => (
            <button
              key={p.id}
              className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition"
              onClick={() => {
                addAgent(undefined, p.id);
                setShowAddAgent(false);
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">🤖</span>
                <span className="font-medium text-sm">{p.name}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">{p.persona}</p>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function WaitingRoom({
  seats,
  me,
  isHost,
  meta,
  onRemoveAgent,
}: {
  seats: RoomView['seats'];
  me: string;
  isHost: boolean;
  meta?: GameMeta;
  onRemoveAgent?: (seat: number) => void;
}) {
  const mySeat = seats.find((s) => s.player?.id === me);
  return (
    <div className="flex flex-col items-center gap-7 px-4">
      <div className="text-center">
        <div className="text-4xl mb-2">⏳</div>
        <h2 className="text-2xl font-bold mb-1">{meta?.name} · 等待玩家</h2>
        <p className="text-slate-400 text-sm">
          已入座 {seats.filter((s) => s.player).length} / {meta?.maxPlayers} 人
          {meta ? ` · 至少 ${meta.minPlayers} 人开始` : ''}
        </p>
      </div>
      <div className="flex gap-4 flex-wrap justify-center max-w-2xl">
        {seats.map((s) => (
          <div
            key={s.seat}
            className="relative"
          >
            <button
              disabled={!!s.player && s.player.id !== me}
              onClick={() => net.send({ t: 'room.sit', seat: s.seat })}
              className="disabled:cursor-default hover:enabled:-translate-y-0.5 transition-transform"
            >
              <Seat
                name={s.player?.name}
                ready={s.ready}
                isHost={s.isHost}
                online={s.online}
                active={s.player?.id === me}
                agent={s.agent}
              />
            </button>
            {isHost && s.agent && (
              <button
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-500/90 text-white text-xs flex items-center justify-center hover:bg-rose-500 ring-2 ring-ink-950 z-10"
                onClick={() => onRemoveAgent?.(s.seat)}
                title="移除 AI"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-3 items-center">
        {mySeat && !isHost && (
          <button
            className={`${mySeat.ready ? 'btn-ghost' : 'btn-primary'} px-8 py-2.5`}
            onClick={() => net.send({ t: 'room.ready', ready: !mySeat.ready })}
          >
            {mySeat.ready ? '取消准备' : '✓ 准备'}
          </button>
        )}
        {isHost && (
          <p className="text-xs text-slate-500 self-center">房主已自动准备，人齐后点右上角「开始游戏」</p>
        )}
      </div>
    </div>
  );
}
