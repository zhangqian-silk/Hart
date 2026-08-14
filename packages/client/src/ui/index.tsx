import type { ReactNode } from 'react';
import type { AgentSeatInfo } from '@hart/common';

/** 从昵称派生一对稳定的 HSL 颜色，用于头像渐变（修复了旧实现 hsl+"88" 的非法值 bug） */
function avatarColors(name: string): [string, string] {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  const h2 = (h + 38) % 360;
  return [`hsl(${h} 62% 52%)`, `hsl(${h2} 58% 40%)`];
}

/** 取昵称首个「字符」（正确处理中文与 emoji 代理对） */
function initial(name: string): string {
  return [...name][0] ?? '?';
}

export function Avatar({ name, color, size = 40 }: { name: string; color?: string; size?: number }) {
  const [c1, c2] = avatarColors(name);
  const bg = color
    ? `linear-gradient(135deg, ${color}, ${color})`
    : `linear-gradient(135deg, ${c1}, ${c2})`;
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white shrink-0 ring-1 ring-white/15"
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: size * 0.4,
        textShadow: '0 1px 2px rgba(0,0,0,0.35)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 6px rgba(0,0,0,0.3)',
      }}
    >
      {initial(name)}
    </div>
  );
}

/** AI 机器人头像（与真人头像同尺寸体系） */
export function AgentAvatar({ size = 48 }: { size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 ring-1 ring-indigo-300/30"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 12px rgba(99,102,241,0.35)',
      }}
    >
      🤖
    </div>
  );
}

export function Seat({
  name,
  ready,
  isHost,
  online,
  active,
  agent,
  children,
}: {
  name?: string;
  ready?: boolean;
  isHost?: boolean;
  online?: boolean;
  active?: boolean;
  /** AI 座位信息：存在时显示 🤖 头像、档案名、provider 标签与思考状态 */
  agent?: AgentSeatInfo;
  children?: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-1.5 transition-all duration-200 ${
        active ? 'scale-105' : ''
      }`}
    >
      <div
        className={`relative rounded-full p-0.5 ${
          active ? 'ring-2 ring-amber-300 shadow-lg shadow-amber-300/30' : ''
        } ${!online && name ? 'opacity-40' : ''}`}
      >
        {agent ? (
          <AgentAvatar size={48} />
        ) : name ? (
          <Avatar name={name} size={48} />
        ) : (
          <div className="w-12 h-12 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center text-white/30 text-xl hover:border-white/35 hover:text-white/50 transition-colors">
            +
          </div>
        )}
        {agent && (
          <span className="absolute -top-1 -left-1 text-[9px] bg-indigo-500 text-white rounded-full px-1.5 py-0.5 font-bold leading-none ring-2 ring-ink-950">
            AI
          </span>
        )}
        {isHost && (
          <span className="absolute -top-1.5 -right-1.5 text-[10px] bg-amber-400 text-black rounded-full px-1.5 py-0.5 font-bold leading-none ring-2 ring-ink-950">
            房主
          </span>
        )}
        {ready && (
          <span className="absolute -bottom-1 -right-1 text-xs bg-emerald-500 text-white rounded-full w-5 h-5 flex items-center justify-center ring-2 ring-ink-950">
            ✓
          </span>
        )}
      </div>
      <span className="text-xs text-slate-200 max-w-[80px] truncate font-medium">
        {agent ? agent.profileName : name ?? '虚位以待'}
      </span>
      {agent && (
        <span className="text-[10px] text-indigo-200/90 bg-indigo-500/15 border border-indigo-400/25 rounded-full px-1.5 py-px leading-tight">
          {agent.kind}
        </span>
      )}
      {agent?.status === 'thinking' ? (
        <span className="flex items-center gap-1 text-[10px] text-amber-300 animate-pulse">
          思考中
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-amber-300 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-1 rounded-full bg-amber-300 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1 h-1 rounded-full bg-amber-300 animate-bounce" style={{ animationDelay: '300ms' }} />
          </span>
        </span>
      ) : null}
      {children}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'green' | 'red' | 'amber' }) {
  const tones: Record<string, string> = {
    default: 'bg-white/10 text-slate-300 border border-white/10',
    green: 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/25',
    red: 'bg-rose-500/15 text-rose-300 border border-rose-400/25',
    amber: 'bg-amber-500/15 text-amber-300 border border-amber-400/25',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${tones[tone]}`}>{children}</span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 fade-in-up"
      onClick={onClose}
    >
      <div
        className="glass max-w-lg w-full max-h-[80vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button className="text-slate-400 hover:text-white text-xl leading-none" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="prose prose-invert prose-sm max-w-none">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] fade-in-up">
      <div className="flex items-center gap-2 bg-rose-500/95 text-white px-4 py-2 rounded-xl shadow-lg shadow-rose-900/40 text-sm border border-rose-300/30">
        <span aria-hidden>⚠</span>
        {message}
      </div>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
    </div>
  );
}
