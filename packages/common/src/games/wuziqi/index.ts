import {
  registerGame,
  type GameDefinition,
  type GameView,
  type TurnInfo,
} from '../../framework.js';
import type {
  GameEvent,
  GameOptions,
  GameResult,
  PlayerId,
  PlayerInfo,
  Rng,
} from '../../types.js';

export const WZQ_SIZE = 15;

export type Stone = 0 | 1 | 2; // 0 空, 1 黑, 2 白

export interface WuziqiState {
  board: Stone[][];
  /** 当前轮到的玩家 id */
  current: PlayerId;
  players: PlayerInfo[]; // [黑, 白]
  lastMove: { row: number; col: number } | null;
  winLine: { row: number; col: number }[] | null;
  winner: PlayerId | null;
  moves: number;
}

export type WuziqiAction = { t: 'place'; row: number; col: number };

export interface WuziqiView extends GameView {
  game: 'wuziqi';
  board: Stone[][];
  current: PlayerId;
  lastMove: { row: number; col: number } | null;
  winLine: { row: number; col: number }[] | null;
  winner: PlayerId | null;
  /** 你执子（1 黑 / 2 白），旁观者为 0 */
  youAre: Stone;
  players: { id: PlayerId; name: string; color: Stone }[];
  moves: number;
}

function emptyBoard(): Stone[][] {
  return Array.from({ length: WZQ_SIZE }, () =>
    Array.from({ length: WZQ_SIZE }, () => 0 as Stone),
  );
}

function checkWin(
  board: Stone[][],
  row: number,
  col: number,
): { row: number; col: number }[] | null {
  const s = board[row]![col]!;
  if (s === 0) return null;
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ] as const;
  for (const [dr, dc] of dirs) {
    const line = [{ row, col }];
    for (let k = 1; k < 5; k++) {
      const r = row + dr * k;
      const c = col + dc * k;
      if (r < 0 || r >= WZQ_SIZE || c < 0 || c >= WZQ_SIZE) break;
      if (board[r]![c] !== s) break;
      line.push({ row: r, col: c });
    }
    for (let k = 1; k < 5; k++) {
      const r = row - dr * k;
      const c = col - dc * k;
      if (r < 0 || r >= WZQ_SIZE || c < 0 || c >= WZQ_SIZE) break;
      if (board[r]![c] !== s) break;
      line.unshift({ row: r, col: c });
    }
    if (line.length >= 5) return line;
  }
  return null;
}

export const wuziqi: GameDefinition<WuziqiState, WuziqiAction> = {
  meta: {
    id: 'wuziqi',
    name: '五子棋',
    tagline: '黑白对弈，五子连珠',
    minPlayers: 2,
    maxPlayers: 2,
    theme: '#f59e0b',
    rules:
      '## 五子棋\n\n15×15 棋盘，黑先白后，轮流落子。\n\n任意方向（横/竖/斜）先连成五子者胜。',
  },
  id: 'wuziqi',
  minPlayers: 2,
  maxPlayers: 2,
  defaultOptions: {},

  start(players: PlayerInfo[], _options: GameOptions, _rng: Rng): WuziqiState {
    const sorted = [...players].sort((a, b) => a.seat - b.seat);
    return {
      board: emptyBoard(),
      current: sorted[0]!.id,
      players: sorted,
      lastMove: null,
      winLine: null,
      winner: null,
      moves: 0,
    };
  },

  apply(state, action, from) {
    if (state.winner) throw new Error('对局已结束');
    if (from !== state.current) throw new Error('还没轮到你');
    if (action.t !== 'place') throw new Error('未知动作');
    const { row, col } = action;
    if (row < 0 || row >= WZQ_SIZE || col < 0 || col >= WZQ_SIZE)
      throw new Error('落子位置非法');
    if (state.board[row]![col] !== 0) throw new Error('该位置已有棋子');
    const board = state.board.map((r) => r.slice()) as Stone[][];
    const color: Stone = state.players[0]!.id === from ? 1 : 2;
    board[row]![col] = color;
    const winLine = checkWin(board, row, col);
    const next: WuziqiState = {
      ...state,
      board,
      current: state.players.find((p) => p.id !== from)!.id,
      lastMove: { row, col },
      winLine,
      winner: winLine ? from : null,
      moves: state.moves + 1,
    };
    const events: GameEvent[] = [
      { type: 'place', from, row, col, color },
      ...(winLine ? [{ type: 'win', from, line: winLine } as GameEvent] : []),
    ];
    return { state: next, events };
  },

  view(state, viewer): WuziqiView {
    const youAre: Stone = state.players[0]?.id === viewer ? 1 : state.players[1]?.id === viewer ? 2 : 0;
    return {
      game: 'wuziqi',
      phase: state.winner ? 'finished' : 'playing',
      board: state.board,
      current: state.current,
      lastMove: state.lastMove,
      winLine: state.winLine,
      winner: state.winner,
      youAre,
      players: state.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        color: (i === 0 ? 1 : 2) as Stone,
      })),
      moves: state.moves,
    };
  },

  turn(state): TurnInfo {
    if (state.winner) return { active: [], phase: 'finished', hint: '对局结束' };
    const color = state.players[0]!.id === state.current ? '黑' : '白';
    return { active: [state.current], phase: 'playing', hint: `请${color}方落子` };
  },

  legalActions(state, player): WuziqiAction[] {
    if (state.winner || player !== state.current) return [];
    const actions: WuziqiAction[] = [];
    for (let row = 0; row < WZQ_SIZE; row++) {
      for (let col = 0; col < WZQ_SIZE; col++) {
        if (state.board[row]![col] === 0) actions.push({ t: 'place', row, col });
      }
    }
    return actions;
  },

  result(state): GameResult | null {
    if (!state.winner) return null;
    return {
      winners: [state.winner],
      teams: {
        黑方: state.players[0] ? [state.players[0].id] : [],
        白方: state.players[1] ? [state.players[1].id] : [],
      },
      reason: '五子连珠',
    };
  },
};

registerGame(wuziqi);
