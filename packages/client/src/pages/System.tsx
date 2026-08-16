import { useEffect, useState } from 'react';
import { useGame } from '../store/game';

interface ProviderMeta {
  version?: string;
  models: string[];
  efforts: string[];
  fetchedAt: number;
  error?: string;
}

interface ProviderSystemConfig {
  binPath?: string;
  defaultModel?: string;
  defaultEffort?: string;
  meta?: ProviderMeta;
}

interface SystemConfig {
  theme: 'dark' | 'light';
  providers: {
    'claude-code': ProviderSystemConfig;
    'codex': ProviderSystemConfig;
    'http': { url?: string };
  };
}

const PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code CLI',
  'codex': 'Codex CLI',
};

const CLI_KINDS = ['claude-code', 'codex'] as const;

function fmtTime(ts: number): string {
  if (!ts) return '未探测';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
      {children}
    </label>
  );
}

/** 模型选择：下拉 + 自定义输入 */
function ModelSelect({
  value,
  models,
  onChange,
  placeholder,
}: {
  value: string;
  models: string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const isCustom = value !== '' && !models.includes(value);
  return (
    <input
      className="input w-full"
      list="model-options"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? '选择或输入模型'}
    />
  );
}

export default function System() {
  const toastMsg = useGame((s) => s.toastMsg);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/system')
      .then((r) => r.json())
      .then((data: SystemConfig) => {
        setConfig(data);
        setLoaded(true);
        applyTheme(data.theme);
      })
      .catch(() => toastMsg('加载系统配置失败'));
  }, []);

  const applyTheme = (theme: 'dark' | 'light') => {
    document.documentElement.dataset.theme = theme;
  };

  const update = (patch: Partial<SystemConfig>) => {
    if (!config) return;
    setConfig({ ...config, ...patch });
    setDirty(true);
  };

  const updateProvider = (kind: string, patch: Partial<ProviderSystemConfig>) => {
    if (!config) return;
    setConfig({
      ...config,
      providers: {
        ...config.providers,
        [kind]: { ...config.providers[kind as 'claude-code' | 'codex'], ...patch },
      },
    });
    setDirty(true);
  };

  const setTheme = (theme: 'dark' | 'light') => {
    applyTheme(theme);
    update({ theme });
  };

  const save = async () => {
    if (!config) return;
    try {
      const res = await fetch('/api/system', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '保存失败');
      setConfig(data);
      setDirty(false);
      toastMsg('已保存');
    } catch (e) {
      toastMsg(e instanceof Error ? e.message : '保存失败');
    }
  };

  const refreshMeta = async (kind?: string) => {
    setRefreshing(kind ?? 'all');
    try {
      const res = await fetch('/api/system/refresh-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind ? { kind } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '刷新失败');
      setConfig(data.config);
      const results = data.results as Record<string, { ok: boolean; error?: string }>;
      const failed = Object.entries(results).filter(([, v]) => !v.ok);
      if (failed.length > 0) {
        toastMsg(`部分探测失败: ${failed.map(([k, v]) => `${k}: ${v.error}`).join(', ')}`);
      } else {
        toastMsg('探测完成');
      }
    } catch (e) {
      toastMsg(e instanceof Error ? e.message : '刷新失败');
    } finally {
      setRefreshing(null);
    }
  };

  if (!loaded || !config) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        加载中…
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 shrink-0">
        <a href="/" className="btn-ghost px-3 py-1.5 text-sm">← 大厅</a>
        <h1 className="text-lg font-bold flex-1">
          <span className="bg-gradient-to-r from-indigo-300 to-purple-300 bg-clip-text text-transparent">
            系统设置
          </span>
        </h1>
        {dirty && <span className="text-xs text-amber-400">有未保存的修改</span>}
        <button className="btn-primary px-4 py-1.5 text-sm" onClick={save} disabled={!dirty}>
          保存
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-5 pb-8">
          {/* 主题 */}
          <section className="glass rounded-2xl p-5">
            <h2 className="text-sm font-bold text-slate-300 mb-4">外观</h2>
            <div className="flex gap-3">
              {(['dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                    config.theme === t
                      ? 'border-indigo-400/50 bg-indigo-500/15 shadow shadow-indigo-500/10'
                      : 'border-white/10 hover:border-white/25 bg-white/5'
                  }`}
                >
                  <span className="text-2xl">{t === 'dark' ? '🌙' : '☀️'}</span>
                  <div className="text-left">
                    <div className="text-sm font-semibold">{t === 'dark' ? '暗色' : '亮色'}</div>
                    <div className="text-[11px] text-slate-500">
                      {t === 'dark' ? '桌游夜氛围' : '明亮清爽'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* CLI Providers */}
          {CLI_KINDS.map((kind) => {
            const p = config.providers[kind];
            const meta = p.meta;
            const isRefreshing = refreshing === kind || refreshing === 'all';
            return (
              <section key={kind} className="glass rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-bold text-slate-300">{PROVIDER_LABELS[kind]}</h2>
                    {meta?.version && (
                      <span className="text-[11px] text-slate-500">v{meta.version}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">
                      {meta?.error ? `探测失败: ${meta.error}` : `上次探测: ${fmtTime(meta?.fetchedAt ?? 0)}`}
                    </span>
                    <button
                      className="btn-ghost px-3 py-1 text-xs"
                      onClick={() => refreshMeta(kind)}
                      disabled={isRefreshing}
                    >
                      {isRefreshing ? '探测中…' : '刷新元数据'}
                    </button>
                  </div>
                </div>

                {meta?.error && (
                  <div className="text-xs px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300">
                    ✗ {meta.error}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>可执行文件路径</Label>
                    <input
                      className="input w-full"
                      value={p.binPath ?? ''}
                      onChange={(e) => updateProvider(kind, { binPath: e.target.value })}
                      placeholder={kind === 'claude-code' ? 'claude' : 'codex'}
                    />
                  </div>
                  <div>
                    <Label>默认 Effort</Label>
                    <select
                      className="input w-full"
                      value={p.defaultEffort ?? ''}
                      onChange={(e) => updateProvider(kind, { defaultEffort: e.target.value })}
                    >
                      <option value="">不指定（CLI 默认）</option>
                      {(meta?.efforts ?? []).map((e) => (
                        <option key={e} value={e}>{e}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <Label>默认模型</Label>
                  <div className="flex gap-2">
                    <select
                      className="input flex-1"
                      value={(p.defaultModel ?? '') && (meta?.models ?? []).includes(p.defaultModel ?? '') ? p.defaultModel : '__custom__'}
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          updateProvider(kind, { defaultModel: e.target.value });
                        }
                      }}
                    >
                      <option value="">不指定（CLI 默认）</option>
                      {(meta?.models ?? []).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      {(p.defaultModel ?? '') && !(meta?.models ?? []).includes(p.defaultModel ?? '') && (
                        <option value="__custom__">自定义: {p.defaultModel}</option>
                      )}
                      {(!(p.defaultModel ?? '') || (meta?.models ?? []).includes(p.defaultModel ?? '')) && (
                        <option value="__custom__">自定义输入…</option>
                      )}
                    </select>
                    <input
                      className="input w-48"
                      value={p.defaultModel ?? ''}
                      onChange={(e) => updateProvider(kind, { defaultModel: e.target.value })}
                      placeholder="自定义模型"
                    />
                  </div>
                </div>

                {/* 探测到的可选值 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>可用 Effort（CLI 探测）</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {(meta?.efforts ?? []).length > 0 ? (
                        meta!.efforts.map((e) => (
                          <span key={e} className="chip text-[11px]">{e}</span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">未探测</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label>可用模型（CLI 探测）</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {(meta?.models ?? []).length > 0 ? (
                        meta!.models.map((m) => (
                          <span key={m} className="chip text-[11px]">{m}</span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500">未探测</span>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}

          {/* HTTP Provider */}
          <section className="glass rounded-2xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-300">HTTP Webhook</h2>
            <div>
              <Label>Webhook URL</Label>
              <input
                className="input w-full"
                value={config.providers.http.url ?? ''}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    providers: { ...config.providers, http: { url: e.target.value } },
                  })
                }
                placeholder="https://example.com/agent"
              />
            </div>
          </section>

          {/* 一键刷新全部 */}
          <div className="flex justify-center pb-4">
            <button
              className="btn-ghost px-5 py-2 text-sm"
              onClick={() => refreshMeta()}
              disabled={refreshing !== null}
            >
              {refreshing === 'all' ? '探测中…' : '探测全部 CLI 元数据'}
            </button>
          </div>
        </div>
      </div>

      {/* 隐藏的 datalist 供 ModelSelect 用（预留） */}
      <datalist id="model-options" />
    </div>
  );
}
