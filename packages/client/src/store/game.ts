import { create } from 'zustand';
import type { AgentProfileInfo, PlayerId, RoomView } from '@hart/common';
import { net } from '../net/client';

interface GameState {
  connected: boolean;
  me: PlayerId | null;
  name: string;
  room: RoomView | null;
  /** 可选 Agent 档案（服务端 hello 后下发） */
  agentProfiles: AgentProfileInfo[];
  toast: string | null;
  setName: (name: string) => void;
  hello: () => void;
  setRoom: (room: RoomView | null) => void;
  /** 房主添加 AI 到指定座位（seat 省略时由服务端自动选座） */
  addAgent: (seat: number | undefined, profileId: string, providerKind?: string) => void;
  /** 房主移除座位上的 AI */
  removeAgent: (seat: number) => void;
  toastMsg: (msg: string) => void;
  clearToast: () => void;
}

export const useGame = create<GameState>((set, get) => ({
  connected: false,
  me: null,
  name: localStorage.getItem('hart-name') ?? '',
  room: null,
  agentProfiles: [],
  toast: null,
  setName: (name) => {
    localStorage.setItem('hart-name', name);
    set({ name });
  },
  hello: () => {
    const name = get().name.trim() || `玩家${Math.floor(Math.random() * 1000)}`;
    net.send({ t: 'hello', name });
  },
  setRoom: (room) => set({ room }),
  addAgent: (seat, profileId, providerKind) => {
    net.send({ t: 'room.add_agent', seat, profileId, providerKind });
  },
  removeAgent: (seat) => {
    net.send({ t: 'room.remove_agent', seat });
  },
  toastMsg: (msg) => {
    set({ toast: msg });
    setTimeout(() => set({ toast: null }), 2600);
  },
  clearToast: () => set({ toast: null }),
}));

/** 绑定网络消息到 store（App 启动时调用一次） */
export function bindNet(): void {
  net.onStatus = (connected) => useGame.setState({ connected });
  net.on((msg) => {
    switch (msg.t) {
      case 'welcome':
        useGame.setState({ me: msg.you, name: msg.name });
        break;
      case 'room.state':
        useGame.setState({ room: msg.room });
        break;
      case 'agent.profiles':
        useGame.setState({ agentProfiles: msg.profiles });
        break;
      case 'error':
        useGame.getState().toastMsg(msg.message);
        break;
      case 'room.event':
        // 游戏事件：交给当前游戏 UI 处理（动画/日志）
        break;
    }
  });
}
