#!/usr/bin/env tsx
/**
 * 多模型 × 多协议直连实测：真实对局上下文 + validateDecision 合法性校验。
 * 用法：ANTHROPIC_API_KEY=... npx tsx scripts/perf-models.ts
 */
import { createLocalHost, getGame, seededRng, type GameId, type PlayerInfo, type GameEvent } from '@hart/common';
import '@hart/common/games';
import { BUILTIN_PROFILES } from '../src/profiles.js';
import { OpenAiProvider } from '../src/provider/openai.js';
import { AnthropicProvider } from '../src/provider/anthropic.js';
import { roleOf, type AgentContext } from '../src/host.js';
import { MemoryStore } from '../src/memory.js';
import { validateDecision } from '../src/protocol.js';

const key = process.env.ANTHROPIC_API_KEY!;
const base = 'https://super-relay.byted.org';
const profile = BUILTIN_PROFILES[0]!;

interface BuiltCtx {
  ctx: AgentContext;
  legal: unknown[];
}

/** 用随机合法动作推进 setupMoves 步，制造真实中盘局面，返回下一玩家的决策上下文 */
function buildContext(gameId: GameId, setupMoves: number, seed: number): BuiltCtx {
  const count = gameId === 'wuziqi' ? 2 : 3;
  const players: PlayerInfo[] = Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`, name: `P${i + 1}`, seat: i,
  }));
  const host = createLocalHost(gameId, players, {}, seededRng(seed));
  const def = getGame(gameId)!;
  const memory = new MemoryStore(profile);
  const history: GameEvent[] = [];
  const rng = seededRng(seed + 1);

  let moves = 0;
  while (!host.result() && moves < setupMoves) {
    const turn = host.turn();
    const actors = turn.active.length > 0 ? turn.active : players.map((p) => p.id);
    for (const pid of actors) {
      if (host.result() || moves >= setupMoves) break;
      const legal = def.legalActions ? (def.legalActions(host.state, pid) as unknown[]) : [];
      if (legal.length === 0) continue;
      const action = legal[Math.floor(rng() * legal.length)]!;
      const events = host.act(action, pid);
      for (const e of events) { history.push(e); memory.noteEvent(e); }
      moves++;
    }
  }

  const turn = host.turn();
  const candidates = turn.active.length > 0
    ? turn.active
    : players.filter((p) => (def.legalActions ? def.legalActions(host.state, p.id).length > 0 : false)).map((p) => p.id);
  const you = candidates[0]!;
  const legal = def.legalActions ? (def.legalActions(host.state, you) as unknown[]) : [];
  const view = host.view(you);
  return {
    ctx: {
      game: gameId,
      you,
      role: roleOf(gameId, view),
      visibleState: view,
      turn,
      actions: legal,
      history,
      players,
      memory: memory.snapshot(players),
    },
    legal,
  };
}

interface Case {
  model: string;
  proto: 'openai' | 'anthropic';
  game: GameId;
  setup: number;
  note?: string;
}

const ALL_CASES: Case[] = [
  // ---- 0812 多轮 ----
  { model: 'model_api/experimental_0812', proto: 'openai', game: 'wuziqi', setup: 0, note: '开局' },
  { model: 'model_api/experimental_0812', proto: 'openai', game: 'wuziqi', setup: 8, note: '中盘' },
  { model: 'model_api/experimental_0812', proto: 'openai', game: 'doudizhu', setup: 8, note: '斗地主' },
  { model: 'model_api/experimental_0812', proto: 'anthropic', game: 'wuziqi', setup: 0, note: '开局' },
  { model: 'model_api/experimental_0812', proto: 'anthropic', game: 'wuziqi', setup: 8, note: '中盘' },
  // ---- 0812_256k ----
  { model: 'model_api/experimental_0812_256k', proto: 'openai', game: 'wuziqi', setup: 0 },
  // ---- deepseek ----
  { model: 'opensource/deepseek_v4_flash_0731', proto: 'openai', game: 'wuziqi', setup: 0, note: '开局' },
  { model: 'opensource/deepseek_v4_flash_0731', proto: 'openai', game: 'wuziqi', setup: 8, note: '中盘' },
  { model: 'opensource/deepseek_v4_flash_0731', proto: 'anthropic', game: 'wuziqi', setup: 0 },
  // ---- glm5.2 ----
  { model: 'opensource/glm5.2', proto: 'openai', game: 'wuziqi', setup: 0 },
  { model: 'opensource/glm5.2', proto: 'anthropic', game: 'wuziqi', setup: 0 },
  // ---- es1_orange_o48 基线 ----
  { model: 'model_hub/es1_orange_o48', proto: 'openai', game: 'wuziqi', setup: 0 },
  { model: 'model_hub/es1_orange_o48', proto: 'anthropic', game: 'wuziqi', setup: 0 },
  // ---- 0723 ----
  { model: 'model_api/experimental_0723', proto: 'openai', game: 'wuziqi', setup: 0 },
];

/** 单模型模板：双协议 × 开局/中盘/斗地主 */
function casesFor(model: string): Case[] {
  return [
    { model, proto: 'openai', game: 'wuziqi', setup: 0, note: '开局' },
    { model, proto: 'openai', game: 'wuziqi', setup: 8, note: '中盘' },
    { model, proto: 'openai', game: 'doudizhu', setup: 8, note: '斗地主' },
    { model, proto: 'anthropic', game: 'wuziqi', setup: 0, note: '开局' },
    { model, proto: 'anthropic', game: 'wuziqi', setup: 8, note: '中盘' },
    { model, proto: 'anthropic', game: 'doudizhu', setup: 8, note: '斗地主' },
  ];
}

// 用法：--model <子串> 只测指定模型（自动展开双协议 × 三局面）；不带参数跑全部内置用例
const modelArg = process.argv.indexOf('--model');
const CASES = modelArg >= 0 ? casesFor(process.argv[modelArg + 1]!) : ALL_CASES;

const results: Array<{ c: Case; secs: number; ok: boolean; detail: string }> = [];

for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i]!;
  const label = `[${i + 1}/${CASES.length}] ${c.model} / ${c.proto} / ${c.game}${c.note ? `(${c.note})` : ''}`;
  process.stdout.write(`${label} ... `);
  const t0 = Date.now();
  try {
    const { ctx, legal } = buildContext(c.game, c.setup, 100 + i);
    if (legal.length === 0) throw new Error('无合法动作（setup 异常）');
    const provider = c.proto === 'openai'
      ? new OpenAiProvider(profile, { apiKey: key, baseUrl: base, model: c.model, effort: 'off', timeoutMs: 240_000 })
      : new AnthropicProvider(profile, { apiKey: key, baseUrl: base, model: c.model, effort: 'off', timeoutMs: 240_000 });
    await provider.start();
    const decision = await provider.decide(ctx);
    const secs = (Date.now() - t0) / 1000;
    const v = validateDecision(decision, legal);
    const ok = v.ok;
    const detail = ok
      ? `${JSON.stringify(decision.action).slice(0, 80)} | ${(decision.reasoning ?? '').slice(0, 90)}`
      : `非法动作: ${JSON.stringify(decision.action).slice(0, 80)}（${v.error}）`;
    console.log(`${secs.toFixed(1)}s ${ok ? '✓' : '✗非法'} ${detail}`);
    results.push({ c, secs, ok, detail });
  } catch (e) {
    const secs = (Date.now() - t0) / 1000;
    const detail = `ERROR: ${(e as Error).message.slice(0, 150)}`;
    console.log(`${secs.toFixed(1)}s ✗ ${detail}`);
    results.push({ c, secs, ok: false, detail });
  }
}

console.log('\n================ 汇总 ================');
for (const r of results) {
  console.log(
    `${r.ok ? '✓' : '✗'} ${r.c.model} / ${r.c.proto.padEnd(9)} / ${r.c.game}${r.c.note ? `(${r.c.note})` : ''}  ${r.secs.toFixed(1)}s  ${r.detail.slice(0, 70)}`,
  );
}
const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} 通过`);
