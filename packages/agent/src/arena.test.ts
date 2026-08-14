import { describe, expect, it } from 'vitest';
import '@hart/common/games';
import { runArena } from './arena.js';
import { replayTranscript, saveTranscript, loadTranscript } from './replay.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Arena 评估体系', () => {
  it('五子棋 arena：胜负统计自洽（每局恰好 1 胜 1 负）', async () => {
    const report = await runArena({
      gameId: 'wuziqi',
      games: 4,
      profileIds: ['rookie', 'sherlock'],
      seed: 123,
    });
    expect(report.games).toBe(4);
    const totalWins = report.standings.reduce((s, x) => s + x.wins, 0);
    const totalLosses = report.standings.reduce((s, x) => s + x.losses, 0);
    // 五子棋无平局：每局产生 1 胜 1 负
    expect(totalWins).toBe(4);
    expect(totalLosses).toBe(4);
    expect(report.transcripts.length).toBe(4);
  });

  it('斗地主 arena 能跑完并有胜负记录', async () => {
    const report = await runArena({ gameId: 'doudizhu', games: 3, seed: 7 });
    expect(report.games).toBe(3);
    const totalGames = report.standings.reduce((s, x) => s + x.wins + x.losses, 0);
    expect(totalGames).toBeGreaterThan(0);
  });
});

describe('Replay 回放（可复现性）', () => {
  it('五子棋对局重放胜者一致', async () => {
    const report = await runArena({
      gameId: 'wuziqi',
      games: 1,
      profileIds: ['rookie', 'sherlock'],
      seed: 99,
    });
    const t = report.transcripts[0]!;
    const r = replayTranscript(t);
    expect(r.ok).toBe(true);
    expect(r.eventsApplied).toBe(t.decisions.length);
  });

  it('斗地主（随机发牌）对局也能忠实重放', async () => {
    const report = await runArena({ gameId: 'doudizhu', games: 1, seed: 55 });
    const t = report.transcripts[0]!;
    const r = replayTranscript(t);
    expect(r.ok).toBe(true);
  });

  it('阿瓦隆（随机角色）对局也能忠实重放', async () => {
    const report = await runArena({ gameId: 'avalon', games: 1, seed: 21 });
    const t = report.transcripts[0]!;
    const r = replayTranscript(t);
    expect(r.ok).toBe(true);
  });

  it('斗地主对局 保存→加载→重放 往返一致（seed/options 已持久化）', async () => {
    const report = await runArena({ gameId: 'doudizhu', games: 1, seed: 88 });
    const t = report.transcripts[0]!;
    const dir = mkdtempSync(join(tmpdir(), 'hart-replay-'));
    const path = saveTranscript(t, dir);
    const loaded = loadTranscript(path);
    // 关键字段必须落盘
    expect(loaded.seed).toBe(t.seed);
    expect(loaded.options).toEqual(t.options ?? {});
    // 从磁盘加载后仍能忠实重放
    const r = replayTranscript(loaded);
    expect(r.ok).toBe(true);
  });
});
