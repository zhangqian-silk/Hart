import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ProviderMeta } from './system-store.js';

/**
 * 从 CLI 自身的配置/缓存文件探测 provider 元数据（版本、可用模型、effort 列表）。
 *
 * - Codex: 读 ~/.codex/models_cache.json（CLI 定期从 API 拉取的模型列表，含每个模型支持的 effort）
 * - Claude Code: 读 ~/.claude/settings.json 的模型环境变量 + 解析 --help 的 effort 可选值
 * - 两者都解析 --version 取版本号；配置文件不存在时回退到策展列表
 */

/** 策展兜底列表（CLI 配置文件缺失时） */
const FALLBACK: Record<string, { models: string[]; efforts: string[] }> = {
  'claude-code': {
    models: ['fable', 'opus', 'sonnet', 'haiku'],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  'codex': {
    models: ['gpt-5', 'gpt-5-codex', 'o3'],
    efforts: ['minimal', 'low', 'medium', 'high', 'ultra'],
  },
};

function runCmd(bin: string, args: string[], timeoutMs = 8000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`超时（${timeoutMs}ms）`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} 退出码 ${code}: ${stderr.slice(-300)}`));
    });
  });
}

/** 从 --help 输出中解析 effort 可选值 */
function parseEffortsFromHelp(help: string): string[] {
  // claude: --effort <level>  (low, medium, high, xhigh, max)
  const m = help.match(/--effort[^\n]*\n?\s*\(([^)]+)\)/i);
  if (m) {
    const vals = m[1]!.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (vals.length > 0) return vals;
  }
  // codex: model_reasoning_effort 相关描述
  const m2 = help.match(/model_reasoning_effort[^\n]*/i);
  if (m2) {
    const vals = m2[0].match(/(minimal|low|medium|high|ultra|xhigh|max)/gi);
    if (vals && vals.length > 0) return [...new Set(vals.map((v) => v.toLowerCase()))];
  }
  return [];
}

/** 从 --help 输出中提取 claude 模型别名 */
function parseClaudeModelsFromHelp(help: string): string[] {
  // "Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet')"
  const m = help.match(/alias[^)]*\(([^)]+)\)/i);
  if (m) {
    const aliases = m[1]!.match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, '')) ?? [];
    if (aliases.length > 0) return aliases;
  }
  // "model's full name (e.g. 'claude-fable-5')"
  const m2 = help.match(/full name[^)]*\(([^)]+)\)/i);
  if (m2) {
    const names = m2[1]!.match(/'([^']+)'/g)?.map((s) => s.replace(/'/g, '')) ?? [];
    return names;
  }
  return [];
}

/* ---- Codex: 读 models_cache.json ---- */

interface CodexModelsCache {
  fetched_at?: string;
  client_version?: string;
  models: Array<{
    slug: string;
    display_name?: string;
    default_reasoning_level?: string;
    supported_reasoning_levels?: Array<{ effort: string; description?: string }>;
  }>;
}

function readCodexModelsCache(): { models: string[]; efforts: string[]; cacheFetchedAt?: string } | null {
  const cachePath = join(homedir(), '.codex', 'models_cache.json');
  if (!existsSync(cachePath)) return null;
  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf8')) as CodexModelsCache;
    if (!Array.isArray(data.models) || data.models.length === 0) return null;
    const models = data.models.map((m) => m.slug).filter(Boolean);
    const efforts = [
      ...new Set(
        data.models.flatMap((m) =>
          (m.supported_reasoning_levels ?? []).map((r) => r.effort).filter(Boolean),
        ),
      ),
    ];
    return { models, efforts, cacheFetchedAt: data.fetched_at };
  } catch {
    return null;
  }
}

/* ---- Claude Code: 读 settings.json 模型环境变量 ---- */

function readClaudeSettingsModels(): string[] {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return [];
  try {
    const data = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      env?: Record<string, string>;
      model?: string;
    };
    const env = data.env ?? {};
    const models: string[] = [];
    // 别名 → 环境变量映射
    const aliasEnv: Record<string, string> = {
      opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
      sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      fable: 'ANTHROPIC_DEFAULT_FABLE_MODEL',
    };
    for (const [alias, envKey] of Object.entries(aliasEnv)) {
      const actual = env[envKey];
      if (actual) {
        models.push(alias);
        if (actual !== alias && !models.includes(actual)) models.push(actual);
      }
    }
    // 子代理模型
    if (env.CLAUDE_CODE_SUBAGENT_MODEL && !models.includes(env.CLAUDE_CODE_SUBAGENT_MODEL)) {
      models.push(env.CLAUDE_CODE_SUBAGENT_MODEL);
    }
    // settings 里的 model 字段（别名）
    if (data.model && !models.includes(data.model)) {
      models.unshift(data.model);
    }
    return [...new Set(models)];
  } catch {
    return [];
  }
}

/* ---- 统一入口 ---- */

export async function fetchProviderMeta(
  kind: 'claude-code' | 'codex',
  binPath?: string,
): Promise<ProviderMeta> {
  const bin = binPath || (kind === 'claude-code' ? 'claude' : 'codex');
  const fallback = FALLBACK[kind] ?? { models: [], efforts: [] };
  const fetchedAt = Date.now();

  // 版本号
  let version = '';
  try {
    const { stdout, stderr } = await runCmd(bin, ['--version']);
    version = (stdout || stderr).trim();
  } catch {
    // --version 失败也继续
  }

  // 模型列表：优先 CLI 自身配置/缓存
  let models: string[] = [];
  let efforts: string[] = [];

  if (kind === 'codex') {
    const cache = readCodexModelsCache();
    if (cache) {
      models = cache.models;
      efforts = cache.efforts;
    }
  } else if (kind === 'claude-code') {
    models = readClaudeSettingsModels();
  }

  // effort：解析 --help（两个 CLI 都适用）
  if (efforts.length === 0) {
    try {
      const { stdout } = await runCmd(bin, ['--help']);
      efforts = parseEffortsFromHelp(stdout);
      // claude 模型：也从 --help 提取别名
      if (kind === 'claude-code' && models.length === 0) {
        models = parseClaudeModelsFromHelp(stdout);
      }
    } catch {
      // --help 失败用兜底
    }
  }

  // 兜底
  if (models.length === 0) models = fallback.models;
  if (efforts.length === 0) efforts = fallback.efforts;

  return {
    version: version || undefined,
    models,
    efforts,
    fetchedAt,
  };
}
