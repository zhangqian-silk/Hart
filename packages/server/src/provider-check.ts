import { spawn } from 'node:child_process';

export interface ProviderCheckResult {
  ok: boolean;
  version?: string;
  error?: string;
}

export interface ProviderCheckConfig {
  kind: string;
  binPath?: string;
  url?: string;
  /** API Key（CLI 注入子进程 env；anthropic 走 x-api-key） */
  apiKey?: string;
  /** 自定义端点（anthropic 用） */
  baseUrl?: string;
  /** 模型（anthropic 用，仅展示） */
  model?: string;
}

/** 跑 `<bin> --version`，5s 超时 */
function checkCli(
  bin: string,
  env?: Record<string, string>,
  timeoutMs = 5000,
): Promise<ProviderCheckResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(env ?? {}) },
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: `超时（${timeoutMs}ms）` });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `无法启动 ${bin}: ${e.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, version: (out || err).trim() || 'ok' });
      } else {
        resolve({ ok: false, error: `${bin} 退出码 ${code}: ${err.slice(-200)}` });
      }
    });
  });
}

/** 探测 Anthropic 兼容端点：GET /v1/models，8s 超时 */
async function checkAnthropic(config: ProviderCheckConfig): Promise<ProviderCheckResult> {
  if (!config.apiKey) return { ok: false, error: '未配置 API Key' };
  const base = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${base}/v1/models`, {
      method: 'GET',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      return { ok: true, version: `鉴权通过（HTTP ${res.status}）` };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `API Key 无效或无权限（HTTP ${res.status}）` };
    }
    return { ok: false, error: `端点返回 HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '连接失败' };
  }
}

/** 检测 provider 配置是否可用 */
export async function checkProvider(config: ProviderCheckConfig): Promise<ProviderCheckResult> {
  switch (config.kind) {
    case 'scripted':
      return { ok: true, version: '内置启发式，无需外部依赖' };
    case 'claude-code':
      return checkCli(config.binPath || 'claude', {
        ...(config.apiKey ? { ANTHROPIC_API_KEY: config.apiKey } : {}),
        ...(config.baseUrl ? { ANTHROPIC_BASE_URL: config.baseUrl } : {}),
      });
    case 'codex':
      return checkCli(config.binPath || 'codex', {
        ...(config.apiKey ? { OPENAI_API_KEY: config.apiKey } : {}),
      });
    case 'anthropic':
      return checkAnthropic(config);
    case 'http': {
      if (!config.url) return { ok: false, error: '未配置 URL' };
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(config.url, { method: 'GET', signal: controller.signal });
        clearTimeout(timer);
        // 任何 HTTP 响应都说明服务可达（webhook 可能不支持 GET）
        return { ok: true, version: `可达（HTTP ${res.status}）` };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '连接失败' };
      }
    }
    default:
      return { ok: false, error: `未知 provider 类型: ${config.kind}` };
  }
}
