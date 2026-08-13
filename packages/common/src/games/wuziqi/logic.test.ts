import { describe, expect, it } from 'vitest';
import { seededRng } from '../../types.js';
import { wuziqi, WZQ_SIZE, type WuziqiState } from './index.js';

const players = [
  { id: 'A', name: '甲', seat: 0 },
  { id: 'B', name: '乙', seat: 1 },
];

function newGame(): WuziqiState {
  return wuziqi.start(players, {}, seededRng(42));
}

describe('五子棋', () => {
  it('黑先白后，轮流落子', () => {
    let s = newGame();
    expect(s.current).toBe('A');
    s = wuziqi.apply(s, { t: 'place', row: 7, col: 7 }, 'A').state;
    expect(s.current).toBe('B');
    expect(s.board[7]![7]).toBe(1);
    s = wuziqi.apply(s, { t: 'place', row: 0, col: 0 }, 'B').state;
    expect(s.board[0]![0]).toBe(2);
  });

  it('不能在已有棋子处落子', () => {
    let s = newGame();
    s = wuziqi.apply(s, { t: 'place', row: 7, col: 7 }, 'A').state;
    expect(() => wuziqi.apply(s, { t: 'place', row: 7, col: 7 }, 'B')).toThrow();
  });

  it('未轮到的玩家不能落子', () => {
    const s = newGame();
    expect(() => wuziqi.apply(s, { t: 'place', row: 0, col: 0 }, 'B')).toThrow();
  });

  it('横五连获胜', () => {
    let s = newGame();
    // A 黑在 7 行连 5 子，B 白在别处应
    const a: [number, number][] = [[7, 3], [7, 4], [7, 5], [7, 6], [7, 7]];
    const b: [number, number][] = [[0, 0], [0, 1], [0, 2], [0, 3]];
    for (let i = 0; i < 4; i++) {
      s = wuziqi.apply(s, { t: 'place', row: a[i]![0], col: a[i]![1] }, 'A').state;
      s = wuziqi.apply(s, { t: 'place', row: b[i]![0], col: b[i]![1] }, 'B').state;
    }
    s = wuziqi.apply(s, { t: 'place', row: a[4]![0], col: a[4]![1] }, 'A').state;
    expect(s.winner).toBe('A');
    expect(s.winLine).toHaveLength(5);
    expect(wuziqi.result(s)?.winners).toEqual(['A']);
  });

it('斜五连获胜', () => {
    let s = newGame();
    const a: [number, number][] = [[3, 3], [4, 4], [5, 5], [6, 6], [7, 7]];
    const b: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4]];
    for (let i = 0; i < 4; i++) {
      s = wuziqi.apply(s, { t: 'place', row: a[i]![0], col: a[i]![1] }, 'A').state;
      s = wuziqi.apply(s, { t: 'place', row: b[i]![0], col: b[i]![1] }, 'B').state;
    }
    s = wuziqi.apply(s, { t: 'place', row: a[4]![0], col: a[4]![1] }, 'A').state;
    expect(s.winner).toBe('A');
  });

  it('视图隐藏对手秘密（五子棋无秘密，但 youAre 正确）', () => {
    let s = newGame();
    s = wuziqi.apply(s, { t: 'place', row: 7, col: 7 }, 'A').state;
    const v = wuziqi.view(s, 'B') as unknown as { youAre: number; board: number[][] };
    expect(v.youAre).toBe(2);
    expect(v.board[7]![7]).toBe(1);
  });

  it('棋盘 15 路', () => {
    const s = newGame();
    expect(s.board).toHaveLength(WZQ_SIZE);
    expect(s.board[0]).toHaveLength(WZQ_SIZE);
  });
});
