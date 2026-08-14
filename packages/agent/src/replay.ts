import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalHost, getGame, seededRng, type GameId, type PlayerInfo } from '@hart/common';
import type { GameTranscript } from './host.js';

/**
 * 回放系统（V8: Event Replay）。
 * 保存/加载对局记录，并重放验证。
 */

export interface ReplayFile {
  gameId: GameId;
  players: PlayerInfo[];
  events: GameTranscript['events'];
  decisions: GameTranscript['decisions'];
  result: GameTranscript['result'];
  /** 随机种子（重放随机开局的对局必需） */
  seed: number;
  /** 开局选项（重放必需） */
  options: GameTranscript['options'];
  startedAt: number;
  durationMs: number;
  savedAt: string;
}

/** 保存对局记录到目录 */
export function saveTranscript(
  transcript: GameTranscript,
  dir: string,
): string {
  mkdirSync(dir, { recursive: true });
  const file = join(
    dir,
    `${transcript.gameId}-${transcript.startedAt}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  const data: ReplayFile = {
    gameId: transcript.gameId,
    players: transcript.players,
    events: transcript.events,
    decisions: transcript.decisions,
    result: transcript.result,
    seed: transcript.seed,
    options: transcript.options ?? {},
    startedAt: transcript.startedAt,
    durationMs: transcript.durationMs,
    savedAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/** 加载对局记录 */
export function loadTranscript(path: string): ReplayFile {
  return JSON.parse(readFileSync(path, 'utf-8')) as ReplayFile;
}

/** 列出目录中的所有回放 */
export function listReplays(dir: string): ReplayFile[] {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    return files.map((f) => loadTranscript(join(dir, f)));
  } catch {
    return [];
  }
}

export interface ReplayResult {
  ok: boolean;
  error?: string;
  finalResult: GameTranscript['result'];
  eventsApplied: number;
}

/**
 * 重放对局：用决策序列重新创建游戏并逐步 apply，验证结果一致。
 */
export function replayTranscript(transcript: GameTranscript): ReplayResult {
  const def = getGame(transcript.gameId);
  if (!def) return { ok: false, error: '未知游戏', finalResult: null, eventsApplied: 0 };
  // 用原对局的 seed 与 options 重建，保证发牌/角色分配一致（Event Replay 的前提）。
  const host = createLocalHost(
    transcript.gameId,
    transcript.players,
    transcript.options ?? {},
    seededRng(transcript.seed),
  );
  let eventsApplied = 0;
  try {
    // 重放全部已执行动作（含 fallback；记录里的 action 就是实际执行的动作）。
    for (const decision of transcript.decisions) {
      host.act(decision.action, decision.player);
      eventsApplied++;
    }
    const finalResult = host.result();
    const originalWinners = transcript.result?.winners ?? [];
    const replayWinners = finalResult?.winners ?? [];
    const match =
      originalWinners.length === replayWinners.length &&
      originalWinners.every((w) => replayWinners.includes(w));
    return {
      ok: match,
      error: match ? undefined : '胜者不一致',
      finalResult,
      eventsApplied,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : '重放失败',
      finalResult: null,
      eventsApplied,
    };
  }
}
