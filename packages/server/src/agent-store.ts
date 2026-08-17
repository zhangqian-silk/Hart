import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_PROFILES } from '@hart/agent';
import type { AgentProfileInfo, GameId } from '@hart/common';
import { maskSecret } from './secret.js';

/**
 * Agent 配置持久化。
 * 配置文件 data/agents.json 保存所有 Agent（内置 + 自定义）的完整配置：
 * 提示词（persona/strategy/systemPrompt/gamePolicy）、适用游戏、Provider（cli/模型/effort 等）。
 * 首次启动时从 BUILTIN_PROFILES 播种。
 */

const DATA_DIR = join(process.cwd(), 'data');
const CONFIG_FILE = join(DATA_DIR, 'agents.json');

const BUILTIN_IDS = new Set(BUILTIN_PROFILES.map((p) => p.id));

const VALID_KINDS = new Set(['scripted', 'http', 'claude-code', 'codex', 'anthropic', 'openai']);
const VALID_GAMES: GameId[] = ['wuziqi', 'doudizhu', 'yiyelang', 'avalon'];

/** 内置 profile → 可编辑配置（默认 scripted provider，适用游戏取 gamePolicy 的 key） */
function builtinToConfig(p: (typeof BUILTIN_PROFILES)[number]): AgentProfileInfo {
  return {
    id: p.id,
    name: p.name,
    persona: p.persona,
    strategy: p.strategy,
    ...(p.systemPrompt ? { systemPrompt: p.systemPrompt } : {}),
    ...(p.gamePolicy ? { gamePolicy: p.gamePolicy } : {}),
    games: p.gamePolicy ? (Object.keys(p.gamePolicy) as GameId[]) : [],
    provider: { kind: 'scripted' },
    builtin: true,
  };
}

/** 内置默认配置（重置用） */
export function listBuiltinDefaults(): AgentProfileInfo[] {
  return BUILTIN_PROFILES.map(builtinToConfig);
}

function sanitize(raw: unknown): AgentProfileInfo[] {
  if (!Array.isArray(raw)) throw new Error('agents.json 格式错误：根节点应为数组');
  const seen = new Set<string>();
  const out: AgentProfileInfo[] = [];
  for (const item of raw) {
    const c = item as Record<string, unknown>;
    if (!c || typeof c.id !== 'string' || !c.id.trim()) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const games = Array.isArray(c.games)
      ? (c.games.filter((g) => VALID_GAMES.includes(g as GameId)) as GameId[])
      : [];
    const provider = (c.provider ?? { kind: 'scripted' }) as Record<string, unknown>;
    const kind = typeof provider.kind === 'string' && VALID_KINDS.has(provider.kind)
      ? provider.kind
      : 'scripted';
    out.push({
      id: c.id,
      name: typeof c.name === 'string' && c.name.trim() ? c.name : c.id,
      persona: typeof c.persona === 'string' ? c.persona : '',
      strategy: typeof c.strategy === 'string' ? c.strategy : '',
      ...(typeof c.systemPrompt === 'string' && c.systemPrompt ? { systemPrompt: c.systemPrompt } : {}),
      ...(c.gamePolicy && typeof c.gamePolicy === 'object' ? { gamePolicy: c.gamePolicy as AgentProfileInfo['gamePolicy'] } : {}),
      games,
      provider: {
        kind,
        ...(typeof provider.model === 'string' && provider.model ? { model: provider.model } : {}),
        ...(typeof provider.effort === 'string' && provider.effort ? { effort: provider.effort } : {}),
        ...(typeof provider.binPath === 'string' && provider.binPath ? { binPath: provider.binPath } : {}),
        ...(typeof provider.url === 'string' && provider.url ? { url: provider.url } : {}),
        ...(typeof provider.timeoutMs === 'number' ? { timeoutMs: provider.timeoutMs } : {}),
        ...(typeof provider.apiKey === 'string' && provider.apiKey ? { apiKey: provider.apiKey } : {}),
        ...(typeof provider.baseUrl === 'string' && provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
        ...(typeof provider.configDir === 'string' && provider.configDir ? { configDir: provider.configDir } : {}),
      },
      builtin: BUILTIN_IDS.has(c.id),
    });
  }
  return out;
}

/** 读取全部 Agent 配置（带内置标记）；文件不存在时播种并落盘 */
export function listAgentConfigs(): AgentProfileInfo[] {
  try {
    if (existsSync(CONFIG_FILE)) {
      return sanitize(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
    }
  } catch (e) {
    console.error('[agent-store] 读取 agents.json 失败，回退内置默认:', e);
  }
  const seeded = listBuiltinDefaults();
  try {
    saveAgentConfigs(seeded);
  } catch (e) {
    console.error('[agent-store] 播种 agents.json 失败:', e);
  }
  return seeded;
}

/** 全量保存 Agent 配置；apiKey 为脱敏占位（含 •）时沿用原值，空字符串清除 */
export function saveAgentConfigs(configs: AgentProfileInfo[]): void {
  const clean = sanitize(configs);
  const old = listAgentConfigs();
  const oldKeys = new Map(
    old.filter((c) => c.provider?.apiKey).map((c) => [c.id, c.provider!.apiKey!]),
  );
  const merged = clean.map((c) => {
    const key = c.provider?.apiKey;
    if (!key) return c;
    if (key.includes('•')) {
      const prev = oldKeys.get(c.id);
      const provider = { ...c.provider! };
      if (prev) provider.apiKey = prev;
      else delete provider.apiKey;
      return { ...c, provider };
    }
    return c;
  });
  mkdirSync(DATA_DIR, { recursive: true });
  // builtin 标记不持久化（运行时按 id 计算）
  const stripped = merged.map(({ builtin: _b, ...rest }) => rest);
  writeFileSync(CONFIG_FILE, JSON.stringify(stripped, null, 2) + '\n');
}

/** 按 id 查配置（room.addAgent 用，含明文凭据，仅服务端内部） */
export function getAgentConfig(id: string): AgentProfileInfo | undefined {
  return listAgentConfigs().find((c) => c.id === id);
}

/** 脱敏副本（apiKey → ••••xxxx），对外接口用 */
export function maskedAgentConfigs(configs: AgentProfileInfo[]): AgentProfileInfo[] {
  return configs.map((c) =>
    c.provider?.apiKey
      ? { ...c, provider: { ...c.provider, apiKey: maskSecret(c.provider.apiKey) } }
      : c,
  );
}
