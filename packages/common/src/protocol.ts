import type { GameEvent, GameId, GameOptions, GameResult, PlayerId, RoomCode } from './types.js';
import type { GameView, TurnInfo } from './framework.js';

export interface SeatInfo {
  seat: number;
  player: { id: PlayerId; name: string } | null;
  ready: boolean;
  online: boolean;
  isHost: boolean;
}

export interface ChatMsg {
  id: number;
  from: PlayerId;
  name: string;
  text: string;
  ts: number;
  system?: boolean;
}

export interface RoomGameState {
  view: GameView;
  turn: TurnInfo;
  result: GameResult | null;
}

/** 房间视图（服务端按连接定制 game 部分后下发） */
export interface RoomView {
  code: RoomCode;
  game: GameId;
  host: PlayerId;
  seats: SeatInfo[];
  options: GameOptions;
  status: 'waiting' | 'playing' | 'finished';
  chat: ChatMsg[];
  /** 对局中：你个人视角的游戏状态 */
  gameState?: RoomGameState;
}

export type ClientMsg =
  | { t: 'hello'; name: string }
  | { t: 'room.create'; game: GameId }
  | { t: 'room.join'; code: RoomCode }
  | { t: 'room.leave' }
  | { t: 'room.sit'; seat: number }
  | { t: 'room.stand' }
  | { t: 'room.ready'; ready: boolean }
  | { t: 'room.chat'; text: string }
  | { t: 'room.options'; options: GameOptions }
  | { t: 'room.start' }
  | { t: 'game.action'; action: unknown };

export type ServerMsg =
  | { t: 'welcome'; you: PlayerId; name: string }
  | { t: 'room.state'; room: RoomView }
  | { t: 'room.event'; event: GameEvent }
  | { t: 'error'; message: string };
