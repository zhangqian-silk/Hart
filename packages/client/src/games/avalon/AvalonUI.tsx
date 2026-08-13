import { useEffect, useMemo, useState } from 'react';
import { ROLE_INFO, type AvalonNightInfo, type AvalonView } from '@hart/common/games/avalon';
import { registerGameUI, type GameUIProps } from '../types';
import { Avatar } from '../../ui';

const THEME = '#8b5cf6';

/* ---------- 小部件 ---------- */

function nightLabel(role: AvalonView['yourRole']): string {
  if (role === 'merlin') return '你看到的坏人（莫德雷德除外）';
  if (role === 'percival') return '梅林候选（无法区分）';
  return '你的同伙';
}

function nightColor(kind: AvalonNightInfo['kind']): string {
  if (kind === 'evil') return '#f87171';
  if (kind === 'merlin-candidate') return '#c4b5fd';
  return '#fca5a5';
}

/** 身份牌正面（CSS 绘制，无图片） */
function RoleCardFront({ role, night }: { role: AvalonView['yourRole']; night: AvalonNightInfo[] }) {
  const info = ROLE_INFO[role]!;
  const good = info.side === 'good';
  return (
    <div
      className="w-56 h-80 rounded-2xl flex flex-col items-center justify-center gap-3 p-5 select-none"
      style={{
        background: good
          ? 'linear-gradient(160deg, #1e3a8a 0%, #2563eb 60%, #1e40af 100%)'
          : 'linear-gradient(160deg, #7f1d1d 0%, #dc2626 60%, #991b1b 100%)',
        border: '2px solid rgba(251,191,36,0.55)',
        boxShadow: '0 18px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.25)',
      }}
    >
      <div
        className="text-6xl"
        style={{ filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))' }}
      >
        {info.icon}
      </div>
      <div className="text-2xl font-bold tracking-widest text-white">{info.name}</div>
      <div
        className="text-xs px-2.5 py-0.5 rounded-full"
        style={{
          background: good ? 'rgba(96,165,250,0.25)' : 'rgba(248,113,113,0.25)',
          color: good ? '#bfdbfe' : '#fecaca',
        }}
      >
        {good ? '好人阵营' : '坏人阵营'}
      </div>
      <div className="text-[11px] leading-relaxed text-white/80 text-center">{info.desc}</div>
      {night.length > 0 && (
        <div className="w-full mt-1 border-t border-white/20 pt-2">
          <div className="text-[10px] text-white/60 mb-1">{nightLabel(role)}</div>
          <div className="flex flex-wrap gap-1 justify-center">
            {night.map((n) => (
              <span
                key={n.playerId}
                className="text-[11px] px-1.5 py-0.5 rounded bg-black/30"
                style={{ color: nightColor(n.kind) }}
              >
                {n.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 任务进度轨 */
function MissionTrack({ v }: { v: AvalonView }) {
  return (
    <div className="flex items-center gap-2.5">
      {v.missionSizes.map((size, i) => {
        const r = v.results[i];
        const isCurrent = i === v.mission && !v.winner;
        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className="flex items-center justify-center text-sm font-bold rounded-full transition-all"
              style={{
                width: 38,
                height: 38,
                color: r ? '#fff' : isCurrent ? '#e9d5ff' : '#94a3b8',
                background:
                  r === 'success'
                    ? 'linear-gradient(135deg,#3b82f6,#1d4ed8)'
                    : r === 'fail'
                      ? 'linear-gradient(135deg,#ef4444,#b91c1c)'
                      : 'rgba(255,255,255,0.06)',
                border: isCurrent ? `2px solid ${THEME}` : '2px solid rgba(255,255,255,0.12)',
                boxShadow: isCurrent ? `0 0 14px ${THEME}aa` : undefined,
              }}
            >
              {r === 'success' ? '✓' : r === 'fail' ? '✗' : size}
            </div>
            <span className="text-[10px] text-slate-500">
              {r === 'success' ? '成功' : r === 'fail' ? '失败' : `任务${i + 1}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- 主组件 ---------- */

function AvalonUI({ view, turn, result, me, players, send }: GameUIProps) {
  const v = view as unknown as AvalonView;
  const [flipped, setFlipped] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [showRole, setShowRole] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(null);

  // 切换视角时重置本地状态
  useEffect(() => {
    setFlipped(false);
    setCardOpen(false);
    setShowRole(false);
  }, [me]);
  // 阶段/任务推进时重置选择
  useEffect(() => {
    setSelected([]);
    setTarget(null);
  }, [v.phase, v.mission, v.leader]);

  const myRole = ROLE_INFO[v.yourRole]!;
  const isLeader = v.leader === me;
  const isAssassin = v.youAreAssassin;
  const need = v.missionSizes[v.mission] ?? 0;
  const nameOf = useMemo(() => {
    const map = new Map(players.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? id;
  }, [players]);

  const inProposal = (id: string) => v.proposal?.includes(id) ?? false;
  const inQuestTeam = (id: string) => v.questTeam?.includes(id) ?? false;
  const hasVoted = (id: string) => v.voted.includes(id);
  const hasSubmitted = (id: string) => v.questSubmitted.includes(id);

  const toggleSelect = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < need ? [...prev, id] : prev,
    );
  };

  const lastRec = v.history[v.history.length - 1] ?? null;

  return (
    <div
      className="w-[960px] max-w-full rounded-3xl p-5 flex flex-col gap-4"
      style={{
        background: 'radial-gradient(ellipse at 50% 0%, #2d1b5e 0%, #171033 55%, #120c26 100%)',
        border: '1px solid rgba(139,92,246,0.35)',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      }}
    >
      {/* 顶栏：标题 + 任务进度轨 + 状态 */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ background: THEME, boxShadow: `0 0 10px ${THEME}` }}
          />
          <span className="font-bold tracking-wide">阿瓦隆</span>
        </div>
        <MissionTrack v={v} />
        <div className="flex-1" />
        <div className="flex items-center gap-1.5" title="连续被否决的提名数（5 次坏人直接获胜）">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="inline-block w-2 h-2 rounded-sm"
              style={{ background: i < v.failedProposals ? '#ef4444' : 'rgba(255,255,255,0.12)' }}
            />
          ))}
          <span className="text-[10px] text-slate-500 ml-1">否决 {v.failedProposals}/5</span>
        </div>
        <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setShowRole(true)}>
          我的身份
        </button>
      </div>

      {/* 玩家座位 */}
      <div className="flex flex-wrap justify-center gap-3">
        {v.players.map((p) => {
          const roleInfo = p.role ? ROLE_INFO[p.role] : null;
          const clickable =
            (v.phase === 'propose' && isLeader) ||
            (v.phase === 'assassinate' && isAssassin && !v.winner);
          const selectedHere =
            (v.phase === 'propose' && isLeader && selected.includes(p.id)) ||
            (v.phase === 'assassinate' && isAssassin && target === p.id);
          return (
            <button
              key={p.id}
              disabled={!clickable}
              onClick={() => {
                if (v.phase === 'propose') toggleSelect(p.id);
                else if (v.phase === 'assassinate') setTarget(p.id);
              }}
              className="flex flex-col items-center gap-1.5 p-2 rounded-2xl transition-all"
              style={{
                cursor: clickable ? 'pointer' : 'default',
                background: selectedHere ? 'rgba(139,92,246,0.22)' : 'transparent',
                boxShadow: selectedHere ? `0 0 0 2px ${THEME}` : undefined,
              }}
            >
              <div className="relative">
                <div
                  className="rounded-full p-0.5"
                  style={{
                    background: p.isLeader
                      ? 'linear-gradient(135deg,#fbbf24,#d97706)'
                      : inProposal(p.id) || inQuestTeam(p.id)
                        ? `linear-gradient(135deg,${THEME},#6d28d9)`
                        : 'rgba(255,255,255,0.1)',
                  }}
                >
                  <Avatar name={p.name} size={46} />
                </div>
                {p.isLeader && (
                  <span className="absolute -top-1.5 -left-1.5 text-sm" title="队长">
                    👑
                  </span>
                )}
                {v.phase === 'vote' && hasVoted(p.id) && (
                  <span className="absolute -bottom-1 -right-1 text-[10px] bg-emerald-500 rounded-full w-4 h-4 flex items-center justify-center">
                    ✓
                  </span>
                )}
                {v.phase === 'quest' && inQuestTeam(p.id) && hasSubmitted(p.id) && (
                  <span className="absolute -bottom-1 -right-1 text-[10px] bg-emerald-500 rounded-full w-4 h-4 flex items-center justify-center">
                    ✓
                  </span>
                )}
                {v.assassination === p.id && (
                  <span className="absolute -top-1.5 -right-1.5 text-sm" title="被刺杀">
                    🗡️
                  </span>
                )}
              </div>
              <span className="text-xs text-slate-300 max-w-[76px] truncate">
                {p.name}
                {p.id === me ? '（你）' : ''}
              </span>
              {roleInfo && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full"
                  style={{
                    background: roleInfo.side === 'good' ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.2)',
                    color: roleInfo.side === 'good' ? '#93c5fd' : '#fca5a5',
                  }}
                >
                  {roleInfo.icon} {roleInfo.name}
                </span>
              )}
              {(inProposal(p.id) || inQuestTeam(p.id)) && !roleInfo && (
                <span className="text-[10px] text-violet-300">
                  {v.phase === 'quest' ? '任务中' : '队伍中'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 中央操作区 */}
      <div className="rounded-2xl bg-black/25 border border-white/10 p-5 min-h-[190px] flex flex-col justify-center">
        <div className="text-center text-sm text-slate-400 mb-3 h-5">
          {result ? result.reason ?? '对局结束' : turn.hint}
        </div>

        {/* 提名阶段 */}
        {v.phase === 'propose' && !result && (
          <>
            {isLeader ? (
              <>
                <div className="text-center text-slate-200 mb-3">
                  你是队长，选择 <span style={{ color: '#c4b5fd' }}>{need}</span> 名队员执行任务
                  <span className="text-xs text-slate-500 ml-2">已选 {selected.length}/{need}</span>
                </div>
                <div className="flex justify-center">
                  <button
                    className="btn px-6"
                    style={{
                      background: selected.length === need ? THEME : 'rgba(255,255,255,0.08)',
                      color: selected.length === need ? '#fff' : '#64748b',
                      cursor: selected.length === need ? 'pointer' : 'not-allowed',
                    }}
                    disabled={selected.length !== need}
                    onClick={() => send({ t: 'propose', team: selected })}
                  >
                    确认提名
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center text-slate-300 py-6">
                等待队长 <span className="text-violet-300">{nameOf(v.leader)}</span> 提名…
              </div>
            )}
          </>
        )}

        {/* 投票阶段 */}
        {v.phase === 'vote' && !result && (
          <>
            {v.proposal && (
              <div className="text-center text-xs text-slate-400 mb-3">
                提名队伍：
                {v.proposal.map((id) => nameOf(id)).join('、')}
              </div>
            )}
            {!hasVoted(me) ? (
              <div className="flex justify-center gap-3">
                <button
                  className="btn px-6 text-white"
                  style={{ background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' }}
                  onClick={() => send({ t: 'vote', approve: true })}
                >
                  ✓ 赞成
                </button>
                <button
                  className="btn px-6 text-white"
                  style={{ background: 'linear-gradient(135deg,#ef4444,#b91c1c)' }}
                  onClick={() => send({ t: 'vote', approve: false })}
                >
                  ✗ 反对
                </button>
              </div>
            ) : (
              <div className="text-center text-slate-300 py-4">
                你已投票，等待其他玩家…
                <span className="text-xs text-slate-500 ml-2">
                  （{v.voted.length}/{v.players.length} 已投）
                </span>
              </div>
            )}
          </>
        )}

        {/* 任务阶段 */}
        {v.phase === 'quest' && !result && (
          <>
            {v.questTeam && (
              <div className="text-center text-xs text-slate-400 mb-3">
                任务队伍：
                {v.questTeam.map((id) => nameOf(id)).join('、')}
              </div>
            )}
            {inQuestTeam(me) && !hasSubmitted(me) ? (
              <>
                <div className="flex justify-center gap-3">
                  <button
                    className="btn px-6 text-white"
                    style={{ background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)' }}
                    onClick={() => send({ t: 'quest', vote: 'success' })}
                  >
                    ✓ 任务成功
                  </button>
                  <button
                    className="btn px-6 text-white"
                    disabled={myRole.side === 'good'}
                    style={{
                      background:
                        myRole.side === 'good'
                          ? 'rgba(255,255,255,0.08)'
                          : 'linear-gradient(135deg,#ef4444,#b91c1c)',
                      color: myRole.side === 'good' ? '#64748b' : '#fff',
                    }}
                    onClick={() => send({ t: 'quest', vote: 'fail' })}
                  >
                    ✗ 任务失败
                  </button>
                </div>
                {myRole.side === 'good' && (
                  <div className="text-center text-[11px] text-slate-500 mt-2">
                    好人只能投任务成功
                  </div>
                )}
              </>
            ) : (
              <div className="text-center text-slate-300 py-4">
                {inQuestTeam(me)
                  ? '你已投票，等待其他队员…'
                  : '任务队员正在秘密投票…'}
              </div>
            )}
          </>
        )}

        {/* 刺杀阶段 */}
        {v.phase === 'assassinate' && !result && (
          <>
            {isAssassin ? (
              <>
                <div className="text-center text-slate-200 mb-2">
                  刺客，请选择一名玩家刺杀
                </div>
                <div className="text-center text-xs text-slate-400 mb-3">
                  {target ? `已选择：${nameOf(target)}` : '点击上方玩家选择目标'}
                </div>
                <div className="flex justify-center">
                  <button
                    className="btn px-6 text-white"
                    disabled={!target}
                    style={{
                      background: target ? 'linear-gradient(135deg,#dc2626,#991b1b)' : 'rgba(255,255,255,0.08)',
                      color: target ? '#fff' : '#64748b',
                    }}
                    onClick={() => target && send({ t: 'assassinate', target })}
                  >
                    🗡️ 确认刺杀
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center text-slate-300 py-6">刺客正在选择刺杀目标…</div>
            )}
          </>
        )}

        {/* 结算 */}
        {result && v.winner && (
          <div className="text-center py-2">
            <div
              className="text-2xl font-bold mb-1"
              style={{ color: v.winner === 'good' ? '#60a5fa' : '#f87171' }}
            >
              {v.winner === 'good' ? '🛡️ 好人阵营获胜' : '🗡️ 坏人阵营获胜'}
            </div>
            <div className="text-sm text-slate-400">
              {result.winners.includes(me) ? '你赢了 🎉' : '你输了'}
              {v.assassination && ` · 刺客刺杀了 ${nameOf(v.assassination)}`}
            </div>
          </div>
        )}

        {/* 最近一次投票/任务结果 */}
        {lastRec && !result && (
          <div className="mt-4 pt-3 border-t border-white/10 text-[11px] text-slate-500 flex flex-wrap justify-center gap-x-3 gap-y-1">
            <span>
              上次提名（任务{lastRec.index + 1}）：
              <span style={{ color: lastRec.passed ? '#93c5fd' : '#fca5a5' }}>
                {lastRec.passed ? '通过' : '被否决'}
              </span>
            </span>
            {lastRec.result && (
              <span>
                任务
                <span style={{ color: lastRec.result === 'success' ? '#93c5fd' : '#fca5a5' }}>
                  {lastRec.result === 'success' ? '成功' : '失败'}
                </span>
                （{lastRec.successCount} 张成功 / {lastRec.failCount} 张失败）
              </span>
            )}
            <span className="flex gap-1.5">
              {Object.entries(lastRec.votes).map(([id, ok]) => (
                <span key={id} style={{ color: ok ? '#93c5fd' : '#fca5a5' }}>
                  {nameOf(id)}{ok ? '✓' : '✗'}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>

      {/* 夜晚情报 + 对局记录 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-black/25 border border-white/10 p-3.5">
          <div className="text-xs font-semibold text-slate-300 mb-2">🌙 夜晚情报</div>
          {v.nightInfo.length === 0 ? (
            <div className="text-[11px] text-slate-500">你没有额外的夜晚信息</div>
          ) : (
            <>
              <div className="text-[10px] text-slate-500 mb-1.5">{nightLabel(v.yourRole)}</div>
              <div className="flex flex-wrap gap-1.5">
                {v.nightInfo.map((n) => (
                  <span
                    key={n.playerId}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-white/5"
                    style={{ color: nightColor(n.kind) }}
                  >
                    {n.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="rounded-2xl bg-black/25 border border-white/10 p-3.5">
          <div className="text-xs font-semibold text-slate-300 mb-2">📜 对局记录</div>
          {v.history.length === 0 ? (
            <div className="text-[11px] text-slate-500">暂无记录</div>
          ) : (
            <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
              {v.history.map((r, i) => (
                <div key={i} className="text-[11px] text-slate-400 flex flex-wrap gap-x-2">
                  <span className="text-slate-500">任务{r.index + 1}</span>
                  <span style={{ color: r.passed ? '#93c5fd' : '#fca5a5' }}>
                    {r.passed ? '通过' : '否决'}
                  </span>
                  {r.result && (
                    <span style={{ color: r.result === 'success' ? '#93c5fd' : '#fca5a5' }}>
                      {r.result === 'success' ? '成功' : '失败'}（{r.successCount}✓/{r.failCount}✗）
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 身份揭示覆盖层 */}
      {!flipped && (
        <div className="fixed inset-0 z-40 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-6 p-4">
          <div className="text-slate-300 text-sm tracking-widest">— 你的身份 —</div>
          <div style={{ perspective: 900 }}>
            <div
              className="relative transition-transform duration-700"
              style={{
                transformStyle: 'preserve-3d',
                transform: cardOpen ? 'rotateY(180deg)' : 'none',
              }}
            >
              {/* 牌背 */}
              <button
                className="w-56 h-80 rounded-2xl flex flex-col items-center justify-center gap-3"
                style={{
                  backfaceVisibility: 'hidden',
                  background:
                    'repeating-linear-gradient(45deg, #4c1d95 0 12px, #5b21b6 12px 24px), linear-gradient(160deg,#4c1d95,#312e81)',
                  border: '2px solid rgba(196,181,253,0.4)',
                  boxShadow: '0 18px 50px rgba(0,0,0,0.6)',
                }}
                onClick={() => setCardOpen(true)}
              >
                <span className="text-5xl opacity-90">🜲</span>
                <span className="text-sm text-violet-200 tracking-widest">点击翻牌</span>
              </button>
              {/* 牌面 */}
              <div
                className="absolute inset-0"
                style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
              >
                <RoleCardFront role={v.yourRole} night={v.nightInfo} />
              </div>
            </div>
          </div>
          <button
            className="btn px-8 text-white"
            style={{
              background: cardOpen ? THEME : 'rgba(255,255,255,0.08)',
              color: cardOpen ? '#fff' : '#64748b',
            }}
            disabled={!cardOpen}
            onClick={() => setFlipped(true)}
          >
            进入游戏
          </button>
        </div>
      )}

      {/* 身份回看弹窗 */}
      {showRole && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowRole(false)}
        >
          <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <RoleCardFront role={v.yourRole} night={v.nightInfo} />
            <button className="btn-ghost px-6 text-sm" onClick={() => setShowRole(false)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

registerGameUI('avalon', AvalonUI);
export default AvalonUI;
