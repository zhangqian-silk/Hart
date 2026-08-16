import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 系统级配置持久化。
 * 配置文件 data/system.json 保存：主题、各 CLI provider 的默认模型/effort/可执行路径、
 * 以及从 CLI 探测到的元数据（版本、可用模型、effort 列表），带 TTL 缓存。
 */

const DATA_DIR = join(process.cwd(), 'data');
const CONFIG_FILE = join(DATA_DIR, 'system.json');

/** 元数据缓存有效期：1 小时 */
export const META_TTL_MS = 60 * 60 * 1000;

export type ThemeName = 'dark' | 'light';

/** 从 CLI 探测到的 provider 元数据 */
export interface ProviderMeta {
  version?: string;
  models: string[];
  efforts: string[];
  /** 探测时间戳（ms） */
  fetchedAt: number;
  /** 探测失败时的错误信息 */
  error?: string;
}

/** 单个 provider 的系统级配置 */
export interface ProviderSystemConfig {
  /** 可执行文件路径（缺省取 PATH 中的命令） */
  binPath?: string;
  /** 系统默认模型（Agent 未单独配置时使用） */
  defaultModel?: string;
  /** 系统默认 effort */
  defaultEffort?: string;
  /** 探测到的元数据（缓存） */
  meta?: ProviderMeta;
}

export interface SystemConfig {
  theme: ThemeName;
  providers: {
    'claude-code': ProviderSystemConfig;
    'codex': ProviderSystemConfig;
    'http': { url?: string };
  };
}

const DEFAULT_CONFIG: SystemConfig = {
  theme: 'dark',
  providers: {
    'claude-code': { binPath: 'claude', defaultModel: '', defaultEffort: '' },
    'codex': { binPath: 'codex', defaultModel: '', defaultEffort: '' },
    'http': { url: '' },
  },
};

function sanitize(raw: unknown): SystemConfig {
  const c = (raw ?? {}) as Record<string, unknown>;
  const providers = (c.providers ?? {}) as Record<string, unknown>;
  const sanitizeProvider = (p: unknown): ProviderSystemConfig => {
    const o = (p ?? {}) as Record<string, unknown>;
    const meta = o.meta as ProviderMeta | undefined;
    return {
      ...(typeof o.binPath === 'string' && o.binPath ? { binPath: o.binPath } : {}),
      ...(typeof o.defaultModel === 'string' ? { defaultModel: o.defaultModel } : {}),
      ...(typeof o.defaultEffort === 'string' ? { defaultEffort: o.defaultEffort } : {}),
      ...(meta && typeof meta === 'object'
        ? {
            meta: {
              models: Array.isArray(meta.models) ? meta.models.filter((m) => typeof m === 'string') : [],
              efforts: Array.isArray(meta.efforts) ? meta.efforts.filter((e) => typeof e === 'string') : [],
              ...(typeof meta.version === 'string' ? { version: meta.version } : {}),
              ...(typeof meta.fetchedAt === 'number' ? { fetchedAt: meta.fetchedAt } : { fetchedAt: 0 }),
              ...(typeof meta.error === 'string' ? { error: meta.error } : {}),
            },
          }
        : {}),
    };
  };
  return {
    theme: c.theme === 'light' ? 'light' : 'dark',
    providers: {
      'claude-code': sanitizeProvider(providers['claude-code']),
      'codex': sanitizeProvider(providers['codex']),
      'http': {
        url: typeof (providers['http'] as Record<string, unknown> | undefined)?.url === 'string'
          ? ((providers['http'] as Record<string, unknown>).url as string)
          : '',
      },
    },
  };
}

/** 读取系统配置（文件不存在时返回默认值并落盘） */
export function getSystemConfig(): SystemConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return sanitize(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')));
    }
  } catch (e) {
    console.error('[system-store] 读取 system.json 失败，回退默认:', e);
  }
  try {
    saveSystemConfig(DEFAULT_CONFIG);
  } catch (e) {
    console.error('[system-store] 播种 system.json 失败:', e);
  }
  return structuredClone(DEFAULT_CONFIG);
}

/** 保存系统配置（合并 meta 后落盘） */
export function saveSystemConfig(config: SystemConfig): void {
  const clean = sanitize(config);
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2) + '\n');
}

/** 更新某个 provider 的元数据缓存 */
export function updateProviderMeta(kind: 'claude-code' | 'codex', meta: ProviderMeta): void {
  const config = getSystemConfig();
  config.providers[kind] = { ...config.providers[kind], meta };
  saveSystemConfig(config);
}

/** 元数据是否需要刷新（不存在或过期） */
export function metaStale(meta: ProviderMeta | undefined): boolean {
  if (!meta) return true;
  return Date.now() - meta.fetchedAt > META_TTL_MS;
}
