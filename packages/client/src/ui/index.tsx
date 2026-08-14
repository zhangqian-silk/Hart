import type { ReactNode } from 'react';
import type { AgentSeatInfo } from '@hart/common';

export function Avatar({ name, color, size = 40 }: { name: string; color?: string; size?: number }) {
  const hue = color ?? `hsl(${(name.charCodeAt(0) * 37) % 360} 70% 55%)`;
  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${hue}, ${hue}88)`,
        fontSize: size * 0.42,
      }}
    >
      {name.slice(0, 1)}
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
      className={`flex flex-col items-center gap-1.5 transition-all ${
        active ? 'scale-105' : ''
      }`}
    >
      <div
        className={`relative rounded-2xl p-1 ${
          active ? 'ring-2 ring-amber-300 shadow-lg shadow-amber-300/30' : ''
        } ${!online && name ? 'opacity-40' : ''}`}
      >
        {agent ? (
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-2xl shadow-lg shadow-indigo-500/30">
            🤖
          </div>
        ) : name ? (
          <Avatar name={name} size={48} />
        ) : (
          <div className="w-12 h-12 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center text-white/30 text-xl">
            +
          </div>
        )}
        {agent && (
          <span className="absolute -top-1.5 -left-1.5 text-[10px] bg-indigo-500 text-white rounded-full px-1.5 py-0.5 font-bold leading-none">
            AI
          </span>
        )}
        {isHost && (
          <span className="absolute -top-1.5 -right-1.5 text-xs bg-amber-400 text-black rounded-full px-1.5 py-0.5 font-bold">
            房主
          </span>
        )}
        {ready && (
          <span className="absolute -bottom-1.5 -right-1.5 text-xs bg-emerald-500 rounded-full w-5 h-5 flex items-center justify-center">
            ✓
          </span>
        )}
      </div>
      <span className="text-xs text-slate-300 max-w-[72px] truncate">
        {agent ? agent.profileName : name ?? '虚位以待'}
      </span>
      {agent && (
        <span className="text-[10px] text-indigo-300/90 bg-indigo-500/15 border border-indigo-400/20 rounded-full px-1.5 py-px leading-tight">
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
    default: 'bg-white/10 text-slate-300',
    green: 'bg-emerald-500/20 text-emerald-300',
    red: 'bg-rose-500/20 text-rose-300',
    amber: 'bg-amber-500/20 text-amber-300',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${tones[tone]}`}>{children}</span>
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
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
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
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 bg-rose-500/90 text-white px-4 py-2 rounded-xl shadow-lg text-sm animate-pulse">
      {message}
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
