/** 玩家 ID（连接级唯一） */
export type PlayerId = string;
/** 房间号（人类可读，如 "A3F9"） */
export type RoomCode = string;

export type GameId = 'wuziqi' | 'doudizhu' | 'yiyelang' | 'avalon';

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  /** 座位号 0..n-1 */
  seat: number;
}

export type GameOptions = Record<string, unknown>;

/** 终局结果 */
export interface GameResult {
  /** 获胜玩家 id 列表 */
  winners: PlayerId[];
  /** 可选：阵营划分，便于 UI 展示 */
  teams?: Record<string, PlayerId[]>;
  /** 结束原因（如 "黑方五连" / "地主出完"） */
  reason?: string;
}

/** 对局内事件（用于日志/动画），type 由游戏自定义 */
export interface GameEvent {
  type: string;
  [k: string]: unknown;
}

/** 随机源：返回 [0,1) */
export type Rng = () => number;

/** 可种子化的随机源（便于测试/回放） */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
