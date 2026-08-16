import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * 玩家身份持久化。
 * 玩家 id（pid）由客户端生成并在 hello 时上报，服务端校验后落盘
 * data/players/<pid>.json。无账号体系：pid 即身份，持有者即可管理自己的模型。
 */

const DATA_DIR = join(process.cwd(), 'data');
const PLAYERS_DIR = join(DATA_DIR, 'players');

/** pid 合法性：仅允许 URL/路径安全的字符，防止目录穿越 */
const PID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function isValidPid(pid: unknown): pid is string {
  return typeof pid === 'string' && PID_RE.test(pid);
}

/** 生成新 pid（客户端首次访问时用） */
export function newPid(): string {
  return randomUUID();
}

/** 玩家记录目录（已校验 pid，路径安全） */
export function playerDir(pid: string): string {
  if (!isValidPid(pid)) throw new Error('非法 pid');
  return join(PLAYERS_DIR, pid);
}

export interface PlayerRecord {
  pid: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
}

/** 上报/刷新玩家身份；返回玩家记录 */
export function upsertPlayer(pid: string, name: string): PlayerRecord {
  if (!isValidPid(pid)) throw new Error('非法 pid');
  const file = join(playerDir(pid), 'player.json');
  const now = Date.now();
  let record: PlayerRecord;
  if (existsSync(file)) {
    try {
      const prev = JSON.parse(readFileSync(file, 'utf8')) as Partial<PlayerRecord>;
      record = {
        pid,
        name: name || prev.name || '玩家',
        firstSeen: typeof prev.firstSeen === 'number' ? prev.firstSeen : now,
        lastSeen: now,
      };
    } catch {
      record = { pid, name: name || '玩家', firstSeen: now, lastSeen: now };
    }
  } else {
    record = { pid, name: name || '玩家', firstSeen: now, lastSeen: now };
  }
  mkdirSync(playerDir(pid), { recursive: true });
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
  return record;
}
