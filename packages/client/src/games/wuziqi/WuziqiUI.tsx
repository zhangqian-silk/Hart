import { useMemo, useState } from 'react';
import { registerGameUI, type GameUIProps } from '../types';
import type { WuziqiView } from '@hart/common/games/wuziqi';

const SIZE = 15;
const CELL = 30;
const PAD = 18;
const BOARD_PX = CELL * (SIZE - 1) + PAD * 2;

const STAR_POINTS = [3, 7, 11];

function WuziqiUI({ view, turn, result, me, send }: GameUIProps) {
  const v = view as unknown as WuziqiView;
  const myTurn = turn.active.includes(me) && !result;
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const winSet = useMemo(
    () => new Set((v.winLine ?? []).map((p) => `${p.row},${p.col}`)),
    [v.winLine],
  );

  const myColor = v.youAre;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-3 h-8">
        {result ? (
          <span
            className={`text-lg font-bold ${
              result.winners.includes(me) ? 'text-amber-300' : 'text-slate-400'
            }`}
          >
            {result.winners.includes(me) ? '🎉 你赢了' : '对局结束'}
          </span>
        ) : (
          <>
            <span
              className="inline-block w-4 h-4 rounded-full"
              style={{
                background:
                  v.current === v.players[0]?.id
                    ? 'radial-gradient(circle at 35% 30%, #555, #000)'
                    : 'radial-gradient(circle at 35% 30%, #fff, #ccc)',
              }}
            />
            <span className="text-slate-200">{turn.hint ?? ''}</span>
          </>
        )}
      </div>

      <div
        className="relative rounded-2xl"
        style={{
          width: BOARD_PX,
          height: BOARD_PX,
          background: 'linear-gradient(135deg, #e0ac69, #c68e45)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.25)',
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* 网格线 */}
        <svg
          className="absolute"
          style={{ left: PAD, top: PAD }}
          width={CELL * (SIZE - 1)}
          height={CELL * (SIZE - 1)}
        >
          {Array.from({ length: SIZE }, (_, i) => (
            <g key={i}>
              <line x1={0} y1={i * CELL} x2={CELL * (SIZE - 1)} y2={i * CELL} stroke="rgba(0,0,0,0.55)" strokeWidth={1} />
              <line x1={i * CELL} y1={0} x2={i * CELL} y2={CELL * (SIZE - 1)} stroke="rgba(0,0,0,0.55)" strokeWidth={1} />
            </g>
          ))}
          {STAR_POINTS.flatMap((r) =>
            STAR_POINTS.map((c) => (
              <circle key={`${r}-${c}`} cx={c * CELL} cy={r * CELL} r={3} fill="rgba(0,0,0,0.6)" />
            )),
          )}
        </svg>

        {/* 棋子 + 点击层 */}
        {v.board.map((row, r) =>
          row.map((cell, c) => {
            const x = PAD + c * CELL;
            const y = PAD + r * CELL;
            const isLast = v.lastMove?.row === r && v.lastMove?.col === c;
            const isWin = winSet.has(`${r},${c}`);
            const isHover = myTurn && cell === 0 && hover?.r === r && hover?.c === c;
            return (
              <div
                key={`${r}-${c}`}
                className="absolute"
                style={{ left: x - CELL / 2, top: y - CELL / 2, width: CELL, height: CELL }}
                onMouseEnter={() => setHover({ r, c })}
                onClick={() => myTurn && cell === 0 && send({ t: 'place', row: r, col: c })}
              >
                {isHover && (
                  <div
                    className="absolute rounded-full opacity-50"
                    style={{
                      left: 3,
                      top: 3,
                      width: CELL - 6,
                      height: CELL - 6,
                      background:
                        myColor === 1
                          ? 'radial-gradient(circle at 35% 30%, #555, #000)'
                          : 'radial-gradient(circle at 35% 30%, #fff, #ccc)',
                    }}
                  />
                )}
                {cell !== 0 && (
                  <div
                    className="absolute rounded-full"
                    style={{
                      left: 2,
                      top: 2,
                      width: CELL - 4,
                      height: CELL - 4,
                      background:
                        cell === 1
                          ? 'radial-gradient(circle at 35% 30%, #666, #000)'
                          : 'radial-gradient(circle at 35% 30%, #fff, #bbb)',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.45)',
                      ...(isWin ? { boxShadow: '0 0 0 3px #ef4444, 0 2px 5px rgba(0,0,0,0.45)' } : {}),
                    }}
                  />
                )}
                {isLast && (
                  <div
                    className="absolute rounded-full bg-red-500 pointer-events-none"
                    style={{ left: CELL / 2 - 3, top: CELL / 2 - 3, width: 6, height: 6 }}
                  />
                )}
              </div>
            );
          }),
        )}
      </div>

      <div className="flex gap-6 text-sm">
        {v.players.map((p) => (
          <span
            key={p.id}
            className={`flex items-center gap-2 ${
              p.id === v.current && !result ? 'text-amber-300' : 'text-slate-400'
            }`}
          >
            <span
              className="inline-block w-3.5 h-3.5 rounded-full"
              style={{
                background:
                  p.color === 1
                    ? 'radial-gradient(circle at 35% 30%, #555, #000)'
                    : 'radial-gradient(circle at 35% 30%, #fff, #ccc)',
              }}
            />
            {p.name}
            {p.id === me ? '（你）' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

registerGameUI('wuziqi', WuziqiUI);
export default WuziqiUI;
