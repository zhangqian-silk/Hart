import { spawn } from 'node:child_process';

export interface ProviderCheckResult {
  ok: boolean;
  version?: string;
  error?: string;
}

/** 跑 `<bin> --version`，5s 超时 */
function checkCli(bin: string, timeoutMs = 5000): Promise<ProviderCheckResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
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

/** 检测 provider 配置是否可用 */
export async function checkProvider(config: {
  kind: string;
  binPath?: string;
  url?: string;
}): Promise<ProviderCheckResult> {
  switch (config.kind) {
    case 'scripted':
      return { ok: true, version: '内置启发式，无需外部依赖' };
    case 'claude-code':
      return checkCli(config.binPath || 'claude');
    case 'codex':
      return checkCli(config.binPath || 'codex');
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
