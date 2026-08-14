#!/usr/bin/env tsx
/**
 * Arena CLI：对四款游戏跑自对弈评估，打印排行榜。
 * 用法：pnpm --filter @hart/agent arena [--games wuziqi,doudizhu,yiyelang,avalon] [--rounds 10]
 */
import { runArena } from '../src/arena.js';
import { saveTranscript } from '../src/replay.js';
import { join } from 'node:path';
import '@hart/common/games';

async function main() {
  const args = process.argv.slice(2);
  const gamesArg = args.indexOf('--games');
  const roundsArg = args.indexOf('--rounds');
  const gameIds = gamesArg >= 0 ? args[gamesArg + 1]!.split(',') : ['wuziqi', 'doudizhu', 'yiyelang', 'avalon'];
  const rounds = roundsArg >= 0 ? parseInt(args[roundsArg + 1]!, 10) : 10;

  const replayDir = join(process.cwd(), 'data', 'arena');

  for (const gameId of gameIds) {
    console.log(`\n=== ${gameId} (${rounds} 局) ===`);
    const report = await runArena({
      gameId: gameId as never,
      games: rounds,
      seed: 42,
    });
    console.table(
      report.standings.map((s) => ({
        档案: s.name,
        胜: s.wins,
        负: s.losses,
        胜率: (s.winRate * 100).toFixed(1) + '%',
        平均用时: s.avgDurationMs.toFixed(0) + 'ms',
      })),
    );
    // 保存前 3 局回放
    for (const t of report.transcripts.slice(0, 3)) {
      saveTranscript(t, replayDir);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
