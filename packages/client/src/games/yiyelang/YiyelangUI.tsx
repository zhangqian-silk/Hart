import { useEffect, useState } from 'react';
import { registerGameUI, type GameUIProps } from '../types';
import { Avatar } from '../../ui';
import type { NightInfo, Role, YylView } from '@hart/common/games/yiyelang';

const ROLE_META: Record<Role, { name: string; emoji: string; team: string }> = {
  werewolf: { name: '狼人', emoji: '🐺', team: '狼人阵营' },
  minion: { name: '爪牙', emoji: '🦹', team: '狼人阵营' },
  mason: { name: '守夜人', emoji: '🔨', team: '村民阵营' },
  seer: { name: '预言家', emoji: '🔮', team: '村民阵营' },
  robber: { name: '强盗', emoji: '🗡️', team: '村民阵营' },
  troublemaker: { name: '捣蛋鬼', emoji: '😈', team: '村民阵营' },
  drunk: { name: '酒鬼', emoji: '🍺', team: '村民阵营' },
  insomniac: { name: '失眠者', emoji: '🌙', team: '村民阵营' },
  tanner: { name: '皮匠', emoji: '🥿', team: '第三方' },
  hunter: { name: '猎人', emoji: '🏹', team: '村民阵营' },
  villager: { name: '村民', emoji: '🧑‍🌾', team: '村民阵营' },
};

function RoleCard({ role, size = 64 }: { role: Role; size?: number }) {
  const m = ROLE_META[role]!;
  return (
    <div
      className="rounded-xl flex flex-col items-center justify-center bg-gradient-to-br from-rose-900/60 to-rose-950/80 border border-rose-500/30"
      style={{ width: size, height: size * 1.35 }}
    >
      <span style={{ fontSize: size * 0.45 }}>{m.emoji}</span>
      <span className="text-xs text-rose-200 mt-1">{m.name}</span>
    </div>
  );
}

function NightInfoView({ info }: { info: NightInfo }) {
  const lines: string[] = [];
  switch (info.kind) {
    case 'werewolf':
      lines.push(info.partner ? `你的狼人同伴：${info.partner}` : '你是唯一的狼人');
      if (info.centerCard) lines.push(`你查看的中央牌：${ROLE_META[info.centerCard]!.name}`);
      break;
    case 'minion':
      lines.push(`狼人是：${info.werewolves.join('、')}`);
      break;
    case 'mason':
      lines.push(info.partner ? `你的守夜人同伴：${info.partner}` : '你是唯一的守夜人');
      break;
    case 'seer':
      if (info.player) lines.push(`${info.player.id} 的身份是：${ROLE_META[info.player.role]!.name}`);
      if (info.center) lines.push(`中央两张牌：${ROLE_META[info.center[0]!]!.name}、${ROLE_META[info.center[1]!]!.name}`);
      break;
    case 'robber':
      lines.push(`你交换了 ${info.from} 的牌，你的新身份：${ROLE_META[info.newRole]!.name}`);
      break;
    case 'troublemaker':
      lines.push(`你交换了 ${info.a} 和 ${info.b} 的牌`);
      break;
    case 'drunk':
      lines.push(`你与中央第 ${info.centerIndex + 1} 张牌交换了（不知道是什么）`);
      break;
    case 'insomniac':
      lines.push(`你现在的身份是：${ROLE_META[info.role]!.name}`);
      break;
  }
  return (
    <div className="text-xs text-amber-200/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
      {lines.map((l: string, i: number) => (
        <div key={i}>🌙 {l}</div>
      ))}
    </div>
  );
}

function YiyelangUI({ view, turn, result, me, players, send }: GameUIProps) {
  const v = view as unknown as YylView;
  const [picked, setPicked] = useState<string[]>([]);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (v.phase !== 'day' || !v.day) return;
    const tick = () => setCountdown(Math.max(0, Math.ceil((v.day!.endsAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [v.phase, v.day?.endsAt]);

  const myRole = v.myRole;
  const myMeta = ROLE_META[myRole]!;

  const togglePick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const nightAction = () => {
    const role = v.myOriginalRole;
    if (!v.night?.myTurn) return null;
    const others = players.filter((p) => p.id !== me);
    const ack = (
      <button className="btn-primary" onClick={() => send({ t: 'night', choice: { kind: 'ack' } })}>
        确认
      </button>
    );
    switch (role) {
      case 'werewolf':
        return (
          <div className="flex flex-col gap-2 items-center">
            <p className="text-sm text-slate-300">确认你的狼人同伴信息{!v.nightInfo.length ? '（独狼可查看中央一张牌）' : ''}</p>
            <div className="flex gap-2">
              {ack}
              {!v.nightInfo.length && (
                <>
                  {[0, 1, 2].map((i) => (
                    <button key={i} className="btn-ghost text-xs" onClick={() => send({ t: 'night', choice: { kind: 'viewCenter', index: i } })}>
                      看中央 {i + 1}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        );
      case 'minion':
      case 'mason':
      case 'insomniac':
        return ack;
      case 'seer':
        return (
          <div className="flex flex-col gap-2 items-center">
            <p className="text-sm text-slate-300">查看一名玩家的牌，或中央两张牌</p>
            <div className="flex gap-2 flex-wrap justify-center">
              {others.map((p) => (
                <button key={p.id} className="btn-ghost text-xs" onClick={() => send({ t: 'night', choice: { kind: 'seerPlayer', player: p.id } })}>
                  看 {p.name}
                </button>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              {[0, 1, 2].map((a) =>
                [0, 1, 2].filter((b) => b > a).map((b) => (
                  <button key={`${a}${b}`} className="btn-ghost text-xs" onClick={() => send({ t: 'night', choice: { kind: 'seerCenter', a, b } })}>
                    中央 {a + 1}+{b + 1}
                  </button>
                )),
              )}
            </div>
          </div>
        );
      case 'robber':
        return (
          <div className="flex flex-col gap-2 items-center">
            <p className="text-sm text-slate-300">选择一名玩家交换身份牌</p>
            <div className="flex gap-2 flex-wrap justify-center">
              {others.map((p) => (
                <button key={p.id} className="btn-ghost text-xs" onClick={() => send({ t: 'night', choice: { kind: 'rob', player: p.id } })}>
                  交换 {p.name}
                </button>
              ))}
            </div>
          </div>
        );
      case 'troublemaker':
        return (
          <div className="flex flex-col gap-2 items-center">
            <p className="text-sm text-slate-300">选择两名玩家交换他们的牌（已选 {picked.length}/2）</p>
            <div className="flex gap-2 flex-wrap justify-center">
              {others.map((p) => (
                <button
                  key={p.id}
                  className={`btn text-xs ${picked.includes(p.id) ? 'bg-rose-500 text-white' : 'bg-white/5 text-slate-300'}`}
                  onClick={() => togglePick(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <button
              className="btn-primary"
              disabled={picked.length !== 2}
              onClick={() => send({ t: 'night', choice: { kind: 'swap', a: picked[0]!, b: picked[1]! } })}
            >
              交换
            </button>
          </div>
        );
      case 'drunk':
        return (
          <div className="flex flex-col gap-2 items-center">
            <p className="text-sm text-slate-300">选择中央一张牌交换（不看）</p>
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <button key={i} className="btn-ghost text-xs" onClick={() => send({ t: 'night', choice: { kind: 'drink', index: i } })}>
                  中央 {i + 1}
                </button>
              ))}
            </div>
          </div>
        );
      default:
        return (
          <button className="btn-ghost" onClick={() => send({ t: 'night', choice: { kind: 'skip' } })}>
            跳过（无夜晚行动）
          </button>
        );
    }
  };

  return (
    <div className="w-full max-w-3xl flex flex-col items-center gap-5">
      {/* 我的身份 */}
      <div className="flex items-center gap-3">
        <RoleCard role={myRole} size={56} />
        <div>
          <div className="text-sm text-slate-400">你的身份</div>
          <div className="font-bold text-lg">{myMeta.emoji} {myMeta.name}</div>
          <div className="text-xs text-slate-500">{myMeta.team}</div>
        </div>
      </div>

      {/* 阶段提示 */}
      <div className="text-center">
        <div className="text-slate-200 font-medium">{turn.hint}</div>
      </div>

      {/* 夜晚 */}
      {v.phase === 'night' && v.night && (
        <div className="w-full glass p-5 flex flex-col items-center gap-4">
          <div className="text-xs text-slate-400">
            夜晚 {v.night.index + 1}/{v.night.steps.length}
            {v.night.role && ` · ${ROLE_META[v.night.role]!.emoji} ${ROLE_META[v.night.role]!.name} 行动中`}
          </div>
          {v.night.myTurn ? nightAction() : <div className="text-slate-500 text-sm">等待其他玩家行动…</div>}
          {v.nightInfo.length > 0 && (
            <div className="w-full flex flex-col gap-1.5">
              {v.nightInfo.map((info: NightInfo, i: number) => (
                <NightInfoView key={i} info={info} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 白天讨论 */}
      {v.phase === 'day' && v.day && (
        <div className="w-full glass p-5 flex flex-col items-center gap-4">
          <div className="text-3xl font-bold text-amber-300">{countdown}s</div>
          <p className="text-sm text-slate-400">讨论时间！说服大家你是好人，找出狼人。</p>
          <button
            className={v.day.ready ? 'btn-ghost' : 'btn-primary'}
            onClick={() => send({ t: 'endDiscussion' })}
          >
            {v.day.ready ? '已准备' : '我准备好了'}（{v.day.readyCount}/{v.day.total}）
          </button>
        </div>
      )}

      {/* 投票 */}
      {v.phase === 'voting' && v.voting && (
        <div className="w-full glass p-5 flex flex-col items-center gap-4">
          <div className="text-sm text-slate-400">投票选出你认为是狼人的玩家（{v.voting.votedCount}/{v.voting.total} 已投）</div>
          <div className="flex gap-3 flex-wrap justify-center">
            {players.map((p) => (
              <button
                key={p.id}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                  v.voting?.myVote === p.id
                    ? 'border-rose-500 bg-rose-500/20'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
                onClick={() => send({ t: 'vote', target: p.id })}
              >
                <Avatar name={p.name} size={40} />
                <span className="text-xs">{p.name}</span>
              </button>
            ))}
            <button
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                v.voting?.myVote === null ? 'border-slate-500 bg-slate-500/20' : 'border-white/10 bg-white/5'
              }`}
              onClick={() => send({ t: 'vote', target: null })}
            >
              <div className="w-10 h-10 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center text-slate-400">∅</div>
              <span className="text-xs">弃权</span>
            </button>
          </div>
        </div>
      )}

      {/* 猎人 */}
      {v.phase === 'hunt' && v.hunt && (
        <div className="w-full glass p-5 flex flex-col items-center gap-4">
          <div className="text-sm text-slate-300">🏹 猎人出局，选择一名玩家带走</div>
          {v.hunt.myTurn ? (
            <div className="flex gap-3 flex-wrap justify-center">
              {players.filter((p) => !v.reveal?.out.includes(p.id)).map((p) => (
                <button key={p.id} className="btn-ghost text-xs" onClick={() => send({ t: 'hunt', target: p.id })}>
                  {p.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-slate-500 text-sm">等待猎人选择…</div>
          )}
        </div>
      )}

      {/* 结算 */}
      {v.phase === 'done' && v.reveal && v.outcome && (
        <div className="w-full glass p-5 flex flex-col items-center gap-5">
          <div className="text-xl font-bold">
            {v.outcome.winner === 'village' && '🎉 村民阵营获胜！'}
            {v.outcome.winner === 'wolves' && '🐺 狼人阵营获胜！'}
            {v.outcome.winner === 'tanner' && '🥿 皮匠独自获胜！'}
          </div>
          <div className="text-sm text-slate-400">{v.outcome.reason}</div>
          <div className="flex gap-4 flex-wrap justify-center">
            {players.map((p) => {
              const role = v.reveal!.hands[p.id]!;
              const isOut = v.reveal!.out.includes(p.id);
              return (
                <div key={p.id} className={`flex flex-col items-center gap-1 ${isOut ? 'opacity-50' : ''}`}>
                  <RoleCard role={role} size={48} />
                  <span className="text-xs">{p.name}{isOut ? '（出局）' : ''}</span>
                </div>
              );
            })}
          </div>
          <div className="text-xs text-slate-500">
            中央牌：{v.reveal.center.map((r: Role) => ROLE_META[r]!.name).join('、')}
          </div>
        </div>
      )}

      {/* 玩家列表 */}
      <div className="flex gap-3 flex-wrap justify-center">
        {players.map((p) => (
          <div key={p.id} className="flex items-center gap-1.5 text-xs text-slate-400">
            <Avatar name={p.name} size={24} />
            {p.name}
            {p.id === me && '（你）'}
          </div>
        ))}
      </div>
    </div>
  );
}

registerGameUI('yiyelang', YiyelangUI);
export default YiyelangUI;
