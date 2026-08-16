import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PlayerModel, PlayerModelKind } from '@hart/common';
import { isValidPid, playerDir } from './player-store.js';
import { isMaskedSecret, maskSecret } from './secret.js';

/**
 * 玩家模型仓库（BYOK）。
 * 每个玩家的模型配置存 data/players/<pid>/models.json，含明文 API Key。
 * 对外读取一律脱敏；保存时按 • 占位符合并原值。
 */

const VALID_KINDS = new Set<PlayerModelKind>(['claude-code', 'codex', 'anthropic']);

function sanitize(raw: unknown): PlayerModel[] {
  if (!Array.isArray(raw)) throw new Error('models.json 格式错误：根节点应为数组');
  const seen = new Set<string>();
  const out: PlayerModel[] = [];
  for (const item of raw) {
    const c = item as Record<string, unknown>;
    if (!c || typeof c !== 'object') continue;
    const kind = typeof c.kind === 'string' && VALID_KINDS.has(c.kind as PlayerModelKind)
      ? (c.kind as PlayerModelKind)
      : 'anthropic';
    const id = typeof c.id === 'string' && c.id.trim() ? c.id : randomUUID();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: typeof c.label === 'string' && c.label.trim() ? c.label.slice(0, 30) : '未命名模型',
      kind,
      model: typeof c.model === 'string' ? c.model : '',
      ...(typeof c.apiKey === 'string' && c.apiKey ? { apiKey: c.apiKey } : {}),
      ...(typeof c.baseUrl === 'string' && c.baseUrl ? { baseUrl: c.baseUrl } : {}),
      ...(typeof c.effort === 'string' && c.effort ? { effort: c.effort } : {}),
      ...(typeof c.binPath === 'string' && c.binPath ? { binPath: c.binPath } : {}),
      ...(typeof c.timeoutMs === 'number' ? { timeoutMs: c.timeoutMs } : {}),
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
    });
  }
  return out;
}

/** 脱敏副本（apiKey → ••••xxxx） */
function masked(models: PlayerModel[]): PlayerModel[] {
  return models.map((m) => ({
    ...m,
    ...(m.apiKey ? { apiKey: maskSecret(m.apiKey) } : {}),
  }));
}

function modelsFile(pid: string): string {
  if (!isValidPid(pid)) throw new Error('非法 pid');
  return join(playerDir(pid), 'models.json');
}

/** 读取玩家模型（脱敏，对外接口用） */
export function listPlayerModels(pid: string): PlayerModel[] {
  try {
    const file = modelsFile(pid);
    if (existsSync(file)) {
      return masked(sanitize(JSON.parse(readFileSync(file, 'utf8'))));
    }
  } catch (e) {
    console.error(`[player-model-store] 读取 ${pid} models.json 失败:`, e);
  }
  return [];
}

/**
 * 全量保存玩家模型（脱敏值 • 占位符合并为原 key，空字符串清除）。
 * 返回脱敏后的列表。
 */
export function savePlayerModels(pid: string, raw: unknown): PlayerModel[] {
  const incoming = sanitize(raw);
  const old = listRawPlayerModels(pid);
  const oldKeys = new Map(old.filter((m) => m.apiKey).map((m) => [m.id, m.apiKey!]));
  const merged = incoming.map((m) => {
    if (!m.apiKey) return m;
    if (isMaskedSecret(m.apiKey)) {
      const prev = oldKeys.get(m.id);
      return prev ? { ...m, apiKey: prev } : { ...m, apiKey: undefined };
    }
    return m;
  });
  mkdirSync(playerDir(pid), { recursive: true });
  writeFileSync(modelsFile(pid), JSON.stringify(merged, null, 2) + '\n');
  return masked(merged);
}

/** 读取玩家模型（含明文 key，仅服务端内部使用） */
function listRawPlayerModels(pid: string): PlayerModel[] {
  try {
    const file = modelsFile(pid);
    if (existsSync(file)) {
      return sanitize(JSON.parse(readFileSync(file, 'utf8')));
    }
  } catch (e) {
    console.error(`[player-model-store] 读取 ${pid} models.json 失败:`, e);
  }
  return [];
}

/** 按 id 取玩家模型（含明文 key，仅服务端内部使用：房间创建 provider 时） */
export function getPlayerModel(pid: string, modelId: string): PlayerModel | undefined {
  return listRawPlayerModels(pid).find((m) => m.id === modelId);
}
