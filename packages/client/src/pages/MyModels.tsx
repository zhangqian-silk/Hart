import { useEffect, useState } from 'react';
import type { PlayerModel, PlayerModelKind } from '@hart/common';
import { useGame } from '../store/game';

const KIND_LABELS: Record<PlayerModelKind, string> = {
  anthropic: 'Anthropic API（直连）',
  'claude-code': 'Claude Code CLI',
  codex: 'Codex CLI',
};

const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

function emptyModel(): PlayerModel {
  return {
    id: crypto.randomUUID(),
    label: '新模型',
    kind: 'anthropic',
    model: '',
    apiKey: '',
    baseUrl: '',
    effort: '',
    binPath: '',
    timeoutMs: undefined,
    createdAt: Date.now(),
  };
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
      {children}
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export default function MyModels() {
  const toastMsg = useGame((s) => s.toastMsg);
  const pid = useGame((s) => s.pid);
  const [models, setModels] = useState<PlayerModel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; version?: string; error?: string } | null>(null);

  useEffect(() => {
    if (!pid) return;
    fetch(`/api/me/models?pid=${encodeURIComponent(pid)}`)
      .then((r) => r.json())
      .then((data: PlayerModel[]) => {
        setModels(data);
        setSelectedId(data[0]?.id ?? null);
        setLoaded(true);
      })
      .catch(() => toastMsg('加载模型配置失败'));
  }, [pid]);

  const selected = models.find((m) => m.id === selectedId) ?? null;

  const update = (patch: Partial<PlayerModel>) => {
    if (!selectedId) return;
    setModels((prev) => prev.map((m) => (m.id === selectedId ? { ...m, ...patch } : m)));
    setDirty(true);
  };

  const save = async () => {
    if (!pid) return;
    try {
      const res = await fetch(`/api/me/models?pid=${encodeURIComponent(pid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(models),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '保存失败');
      setModels(data);
      setDirty(false);
      toastMsg('已保存');
    } catch (e) {
      toastMsg(e instanceof Error ? e.message : '保存失败');
    }
  };

  const createModel = () => {
    const m = emptyModel();
    setModels((prev) => [...prev, m]);
    setSelectedId(m.id);
    setDirty(true);
  };

  const removeModel = (id: string) => {
    const target = models.find((m) => m.id === id);
    if (!target) return;
    if (!confirm(`删除模型「${target.label}」？`)) return;
    const rest = models.filter((m) => m.id !== id);
    setModels(rest);
    setSelectedId(rest[0]?.id ?? null);
    setDirty(true);
  };

  const checkCurrent = async () => {
    if (!selected) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch('/api/me/models/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selected),
      });
      const data = await res.json();
      setCheckResult(data);
    } catch {
      setCheckResult({ ok: false, error: '检测请求失败' });
    } finally {
      setChecking(false);
    }
  };

  if (!pid) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        正在连接服务器…
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 shrink-0">
        <a href="/" className="btn-ghost px-3 py-1.5 text-sm">← 大厅</a>
        <h1 className="text-lg font-bold flex-1">
          <span className="bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">
            我的模型
          </span>
        </h1>
        {dirty && <span className="text-xs text-amber-400">有未保存的修改</span>}
        <button className="btn-ghost px-3 py-1.5 text-sm" onClick={createModel}>+ 新建</button>
        <button className="btn-primary px-4 py-1.5 text-sm" onClick={save} disabled={!dirty}>
          保存
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 左侧列表 */}
        <aside className="w-64 shrink-0 border-r border-white/10 overflow-y-auto p-2 space-y-1">
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                m.id === selectedId
                  ? 'bg-emerald-500/20 border border-emerald-400/30'
                  : 'hover:bg-white/5 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">{m.label}</span>
                {m.apiKey ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 shrink-0">
                    已配 Key
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400 shrink-0">
                    无 Key
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                {KIND_LABELS[m.kind]} · {m.model || '未指定模型'}
              </div>
            </button>
          ))}
          {loaded && models.length === 0 && (
            <div className="text-center text-slate-500 text-sm py-8">
              还没有模型
              <button className="block mx-auto mt-2 btn-ghost px-3 py-1 text-xs" onClick={createModel}>
                + 新建模型
              </button>
            </div>
          )}
        </aside>

        {/* 右侧编辑表单 */}
        <main className="flex-1 overflow-y-auto p-6">
          {selected ? (
            <div className="max-w-2xl space-y-5">
              <section className="glass rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-300">模型配置</h2>
                  <button
                    className="btn-ghost px-3 py-1 text-xs"
                    onClick={checkCurrent}
                    disabled={checking}
                  >
                    {checking ? '检测中…' : '检测可用性'}
                  </button>
                </div>
                {checkResult && (
                  <div
                    className={`text-xs px-3 py-2 rounded-lg border ${
                      checkResult.ok
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-red-500/10 border-red-500/30 text-red-300'
                    }`}
                  >
                    {checkResult.ok ? `✓ ${checkResult.version ?? '可用'}` : `✗ ${checkResult.error}`}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="标签">
                    <input
                      className="input w-full"
                      value={selected.label}
                      onChange={(e) => update({ label: e.target.value })}
                      maxLength={30}
                      placeholder="例如：我的 opus"
                    />
                  </Field>
                  <Field label="类型">
                    <select
                      className="input w-full"
                      value={selected.kind}
                      onChange={(e) => update({ kind: e.target.value as PlayerModelKind })}
                    >
                      {(Object.keys(KIND_LABELS) as PlayerModelKind[]).map((k) => (
                        <option key={k} value={k}>{KIND_LABELS[k]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="模型">
                    <input
                      className="input w-full"
                      value={selected.model}
                      onChange={(e) => update({ model: e.target.value })}
                      placeholder={
                        selected.kind === 'anthropic'
                          ? 'claude-sonnet-5'
                          : selected.kind === 'claude-code'
                            ? 'opus / sonnet / haiku'
                            : 'gpt-5'
                      }
                    />
                  </Field>
                  <Field label="努力程度">
                    <select
                      className="input w-full"
                      value={selected.effort ?? ''}
                      onChange={(e) => update({ effort: e.target.value || undefined })}
                    >
                      {EFFORTS.map((e) => (
                        <option key={e} value={e}>{e || '默认'}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="API Key（仅保存于服务器，读取时脱敏）">
                    <input
                      type="password"
                      className="input w-full"
                      value={selected.apiKey ?? ''}
                      onChange={(e) => update({ apiKey: e.target.value || undefined })}
                      placeholder={selected.apiKey?.includes('•') ? `已保存（${selected.apiKey}）` : 'sk-ant-...'}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="API 端点（可选，默认官方）">
                    <input
                      className="input w-full"
                      value={selected.baseUrl ?? ''}
                      onChange={(e) => update({ baseUrl: e.target.value || undefined })}
                      placeholder="https://api.anthropic.com"
                    />
                  </Field>
                  {(selected.kind === 'claude-code' || selected.kind === 'codex') && (
                    <Field label="可执行文件路径（可选）">
                      <input
                        className="input w-full"
                        value={selected.binPath ?? ''}
                        onChange={(e) => update({ binPath: e.target.value || undefined })}
                        placeholder={selected.kind === 'claude-code' ? 'claude' : 'codex'}
                      />
                    </Field>
                  )}
                  <Field label="超时毫秒（可选）">
                    <input
                      type="number"
                      className="input w-full"
                      value={selected.timeoutMs ?? ''}
                      onChange={(e) =>
                        update({ timeoutMs: e.target.value ? Number(e.target.value) : undefined })
                      }
                      placeholder="120000"
                    />
                  </Field>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  模型保存在你的玩家身份下。在房间里添加 AI 时选择「我的模型」，
                  AI 将使用你的凭据进行决策——额度由你的 Key 承担。
                  {selected.kind === 'anthropic' &&
                    ' 直连模式不依赖 CLI，会话历史在服务端内存中维护，对局结束即清除。'}
                </p>
              </section>

              <div className="flex gap-3 pb-8">
                <button className="btn-primary px-5 py-2 text-sm" onClick={save} disabled={!dirty}>
                  保存修改
                </button>
                <button
                  className="px-4 py-2 text-sm rounded-xl bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/20 transition-colors"
                  onClick={() => removeModel(selected.id)}
                >
                  删除模型
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              {loaded ? '选择左侧模型进行编辑' : '加载中…'}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
