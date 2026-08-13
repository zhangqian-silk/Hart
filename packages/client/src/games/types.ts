import type { ComponentType } from 'react';
import type { GameId, GameResult, GameView, PlayerId, PlayerInfo, TurnInfo } from '@hart/common';

/** 游戏 UI 组件统一入参（所有游戏 UI 共用） */
export interface GameUIProps {
  /** 你的视角游戏状态 */
  view: GameView;
  turn: TurnInfo;
  result: GameResult | null;
  me: PlayerId;
  /** 座位序玩家列表 */
  players: PlayerInfo[];
  /** 发送游戏动作 */
  send: (action: unknown) => void;
}

export type GameUIComponent = ComponentType<GameUIProps>;

export const gameUIs: Partial<Record<GameId, GameUIComponent>> = {};

export function registerGameUI(id: GameId, comp: GameUIComponent): void {
  gameUIs[id] = comp;
}
