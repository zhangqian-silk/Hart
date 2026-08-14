#!/usr/bin/env tsx
/**
 * Claude Code 通用游戏实测：Claude vs 脚本AI，任意游戏。
 * 用法：pnpm --filter @hart/agent claude-game -- --game avalon [--rounds 1] [--max-steps 30]
 */
import { createLocalHost, getGame, seededRng, type GameId, type PlayerInfo } from '@hart/common';
import '@hart/common/games';
import { getProfile, BUILTIN_PROFILES } from '../src/profiles.js';
import { ScriptedProvider } from '../src/provider/scripted.js';
import { ClaudeCodeProvider } from '../src/provider/cli.js';
import { roleOf, type AgentContext } from '../src/host.js';
import { MemoryStore } from '../src/memory.js';
import { validateDecision } from '../src/protocol.js';
import { saveTranscript } from '../src/replay.js';
import type { DecisionRecord, GameTranscript } from '../src/host.js';
import type { GameEvent } from '@hart/common';

const args = process.argv.slice(2);
const gameArg = args.indexOf('--game');
const roundsArg = args.indexOf('--rounds');
const maxStepsArg = args.indexOf('--max-steps');
const gameId = (gameArg >= 0 ? args[gameArg + 1] : 'wuziqi') as GameId;
const rounds = roundsArg >= 0 ? parseInt(args[roundsArg + 1]!, 10) : 1;
const maxSteps = maxStepsArg >= 0 ? parseInt(args[maxStepsArg + 1]!, 10) : 30;

/** 全局统计：Claude 决策合法率 */
let claudeLegal = 0;
let claudeFallback = 0;

const PLAYER_COUNT: Record<GameId, number> = {
  wuziqi: 2,
  doudizhu: 3,
  yiyelang: 5,
  avalon: 5,
};

async function playRound(round: number): Promise<void> {
  const profile = getProfile('sherlock')!;
  const claude = new ClaudeCodeProvider(profile, { timeoutMs: 180_000 });
  const scriptedProfiles = BUILTIN_PROFILES.filter((p) => p.id !== 'sherlock');
  const scripteds = scriptedProfiles.map((p) => new ScriptedProvider(p));

  const count = PLAYER_COUNT[gameId];
  const players: PlayerInfo[] = Array.from({ length: count }, (_, i) => ({
    id: i === 0 ? 'claude' : `ai${i}`,
    name: i === 0 ? 'Claude' : `AI-${scriptedProfiles[(i - 1) % scriptedProfiles.length]!.name}`,
    seat: i,
  }));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`第 ${round + 1} 轮：${gameId} — Claude + ${count - 1} 个脚本AI`);
  console.log('='.repeat(60));

  const host = createLocalHost(gameId, players, {}, seededRng(42 + round));
  const def = getGame(gameId)!;
  const memory = new MemoryStore(profile);
  const history: Parameters<typeof memory.noteEvent>[0][] = [];
  let steps = 0;
  const start = Date.now();

  const decisions: DecisionRecord[] = [];
  const allEvents: GameEvent[] = [];

  /** 让某玩家行动一步：Claude 走真实 CLI，其余走脚本；记录决策与合法性 */
  const takeTurn = async (pid: string): Promise<void> => {
    const p = players.find((pl) => pl.id === pid)!;
    const isClaude = pid === 'claude';
    const view = host.view(pid);
    const legal = def.legalActions ? (def.legalActions(host.state, pid) as unknown[]) : [];
    if (legal.length === 0) return;
    const ctx: AgentContext = {
      game: gameId,
      you: pid,
      role: roleOf(gameId, view),
      visibleState: view,
      turn: host.turn(),
      actions: legal,
      history,
      players,
      memory: memory.snapshot(players),
    };
    if (isClaude) {
      process.stdout.write(`  [${steps + 1}] Claude(${ctx.role}) 思考中...`);
      const t0 = Date.now();
      try {
        const decision = await claude.decide(ctx);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const v = validateDecision(decision, legal);
        let action = decision.action;
        let ok = true;
        if (!v.ok) {
          ok = false;
          claudeFallback++;
          action = legal[Math.floor(Math.random() * legal.length)]!;
          console.log(` ${elapsed}s（非法，兜底）`);
        } else {
          claudeLegal++;
          console.log(` ${elapsed}s`);
          console.log(`    动作: ${JSON.stringify(action).slice(0, 100)}`);
          if (decision.reasoning) console.log(`    理由: ${decision.reasoning.slice(0, 150)}`);
        }
        decisions.push({ player: pid, action, reasoning: decision.reasoning, ok, fallback: !ok });
        const events = host.act(action, pid);
        for (const e of events) { history.push(e); allEvents.push(e); memory.noteEvent(e); }
      } catch (e) {
        console.log(` 失败: ${e instanceof Error ? e.message.slice(0, 100) : e}`);
        claudeFallback++;
        const fb = legal[Math.floor(Math.random() * legal.length)]!;
        decisions.push({ player: pid, action: fb, ok: false, fallback: true, error: String(e) });
        const events = host.act(fb, pid);
        for (const e of events) { history.push(e); allEvents.push(e); memory.noteEvent(e); }
      }
    } else {
      const provider = scripteds[(players.indexOf(p) - 1 + scripteds.length) % scripteds.length]!;
      const decision = await provider.decide(ctx);
      decisions.push({ player: pid, action: decision.action, ok: true });
      const events = host.act(decision.action, pid);
      for (const e of events) { history.push(e); allEvents.push(e); }
    }
    steps++;
  };

  while (!host.result() && steps < maxSteps) {
    const turn = host.turn();
    let actors = turn.active;
    if (actors.length === 0) {
      // 同时行动阶段：所有有合法动作的玩家依次行动
      actors = players
        .filter((p) => (def.legalActions ? def.legalActions(host.state, p.id).length > 0 : false))
        .map((p) => p.id);
      if (actors.length === 0) break;
    }
    for (const pid of actors) {
      if (host.result()) break;
      await takeTurn(pid);
    }
  }

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  const result = host.result();
  if (result) {
    const claudeWon = result.winners.includes('claude');
    console.log(`\n  结果: ${claudeWon ? 'Claude 胜' : 'AI 胜'}（${result.reason ?? ''}），${steps} 步，${duration}s`);
  } else {
    console.log(`\n  结果: 未分胜负（${steps} 步上限），${duration}s`);
  }

  // 保存对局录像（真实 Claude 对局的证据）
  const transcript: GameTranscript = {
    gameId,
    players,
    startedAt: start,
    durationMs: Date.now() - start,
    events: allEvents,
    decisions,
    result,
    seed: 42 + round,
    options: {},
  };
  const path = saveTranscript(transcript, 'data/claude-games');
  console.log(`  录像已保存: ${path}`);
}

async function main() {
  console.log(`Claude Code 实测：${gameId}（${rounds} 轮，每轮最多 ${maxSteps} 步）`);
  for (let i = 0; i < rounds; i++) {
    await playRound(i);
  }
  const total = claudeLegal + claudeFallback;
  console.log('\n全部完成');
  console.log(
    `Claude 决策统计：合法 ${claudeLegal}/${total}` +
      (total > 0 ? `（${((claudeLegal / total) * 100).toFixed(0)}%），兜底 ${claudeFallback}` : ''),
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
