#!/usr/bin/env tsx
/**
 * Claude Code Agent 实测：用 ClaudeCodeProvider 下五子棋。
 * 用法：pnpm --filter @hart/agent claude-test [--rounds 2] [--max-moves 40] [--model sonnet]
 */
import { createLocalHost, getGame, seededRng, type PlayerInfo } from '@hart/common';
import '@hart/common/games';
import { getProfile } from '../src/profiles.js';
import { ScriptedProvider } from '../src/provider/scripted.js';
import { ClaudeCodeProvider } from '../src/provider/cli.js';
import { roleOf, type AgentContext } from '../src/host.js';
import { MemoryStore } from '../src/memory.js';
import { validateDecision } from '../src/protocol.js';

const args = process.argv.slice(2);
const roundsArg = args.indexOf('--rounds');
const maxMovesArg = args.indexOf('--max-moves');
const modelArg = args.indexOf('--model');
const rounds = roundsArg >= 0 ? parseInt(args[roundsArg + 1]!, 10) : 2;
const maxMoves = maxMovesArg >= 0 ? parseInt(args[maxMovesArg + 1]!, 10) : 40;
const model = modelArg >= 0 ? args[modelArg + 1] : undefined;

async function playRound(round: number): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`第 ${round + 1} 轮：Claude（黑）vs 脚本AI（白）`);
  console.log('='.repeat(60));

  const profile = getProfile('sherlock')!;
  const claude = new ClaudeCodeProvider(profile, {
    timeoutMs: 180_000,
    extraArgs: model ? ['--model', model] : [],
  });
  const scripted = new ScriptedProvider(getProfile('rookie')!);

  const players: PlayerInfo[] = [
    { id: 'claude', name: 'Claude', seat: 0 },
    { id: 'script', name: '脚本AI', seat: 1 },
  ];
  const host = createLocalHost('wuziqi', players, {}, seededRng(42 + round));
  const def = getGame('wuziqi')!;
  const memory = new MemoryStore(profile);
  const history: Parameters<typeof memory.noteEvent>[0][] = [];

  let moves = 0;
  const start = Date.now();

  while (!host.result() && moves < maxMoves) {
    const turn = host.turn();
    if (turn.active.length === 0) break;
    const current = turn.active[0]!;
    const isClaude = current === 'claude';
    const view = host.view(current);
    const legal = def.legalActions!(host.state, current) as { t: string; row: number; col: number }[];

    if (isClaude) {
      const ctx: AgentContext = {
        game: 'wuziqi',
        you: current,
        role: roleOf('wuziqi', view),
        visibleState: view,
        turn,
        actions: legal,
        history,
        players,
        memory: memory.snapshot(players),
      };
      process.stdout.write(`  [${moves + 1}] Claude 思考中...`);
      const t0 = Date.now();
      try {
        const decision = await claude.decide(ctx);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const action = decision.action as { row: number; col: number };
        console.log(` 落子 (${action.row},${action.col}) ${elapsed}s`);
        if (decision.reasoning) {
          console.log(`    理由: ${decision.reasoning.slice(0, 120)}`);
        }
        const events = host.act(decision.action, current);
        for (const e of events) {
          history.push(e);
          memory.noteEvent(e);
        }
      } catch (e) {
        console.log(` 失败: ${e instanceof Error ? e.message : e}`);
        // 失败时随机下一个合法位置
        const fallback = legal[Math.floor(Math.random() * legal.length)]!;
        console.log(`    兜底: 落子 (${fallback.row},${fallback.col})`);
        host.act(fallback, current);
      }
    } else {
      const ctx: AgentContext = {
        game: 'wuziqi',
        you: current,
        role: roleOf('wuziqi', view),
        visibleState: view,
        turn,
        actions: legal,
        history,
        players,
        memory: memory.snapshot(players),
      };
      const decision = await scripted.decide(ctx);
      const action = decision.action as { row: number; col: number };
      console.log(`  [${moves + 1}] 脚本AI 落子 (${action.row},${action.col})`);
      const events = host.act(decision.action, current);
      for (const e of events) history.push(e);
    }
    moves++;
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  const result = host.result();
  if (result) {
    const winner = result.winners[0] === 'claude' ? 'Claude 胜' : '脚本AI 胜';
    console.log(`\n  结果: ${winner}（${result.reason}），共 ${moves} 手，耗时 ${duration}s`);
  } else {
    console.log(`\n  结果: 未分胜负（达到 ${maxMoves} 手上限），耗时 ${duration}s`);
  }
}

async function main() {
  console.log(`Claude Code Agent 实测（${rounds} 轮，每轮最多 ${maxMoves} 手）`);
  if (model) console.log(`模型: ${model}`);
  for (let i = 0; i < rounds; i++) {
    await playRound(i);
  }
  console.log('\n全部完成');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
