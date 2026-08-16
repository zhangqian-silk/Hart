import { useEffect, useMemo, useState } from 'react';
import { listGames, type GameId, type AgentProfileInfo, type AgentProviderInfo } from '@hart/common';
import { useGame } from '../store/game';
import { adminHeaders } from '../net/admin';

const PROVIDER_KINDS = [
  { value: 'scripted', label: '内置启发式（离线）' },
  { value: 'claude-code', label: 'Claude Code CLI' },
  { value: 'codex', label: 'Codex CLI' },
  { value: 'anthropic', label: 'Anthropic API（直连）' },
  { value: 'http', label: 'HTTP Webhook' },
];

interface ProviderMeta {
  version?: string;
  models: string[];
  efforts: string[];
  fetchedAt: number;
  error?: string;
}
interface SystemConfig {
  theme: string;
  providers: {
    'claude-code': { binPath?: string; defaultModel?: string; defaultEffort?: string; meta?: ProviderMeta };
    'codex': { binPath?: string; defaultModel?: string; defaultEffort?: string; meta?: ProviderMeta };
    'http': { url?: string };
  };
}

const GAME_LABELS: Record<GameId, string> = {
  wuziqi: '五子棋',
  doudizhu: '斗地主',
  yiyelang: '一夜狼',
  avalon: '阿瓦隆',
};

const GAME_ORDER: GameId[] = ['wuziqi', 'doudizhu', 'yiyelang', 'avalon'];

function emptyAgent(id: string): AgentProfileInfo {
  return {
    id,
    name: '新 Agent',
    persona: '',
    strategy: '',
    systemPrompt: '',
    gamePolicy: {},
    games: [],
    provider: { kind: 'scripted' },
    builtin: false,
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

export default function Agents() {
  const toastMsg = useGame((s) => s.toastMsg);
  const [agents, setAgents] = useState<AgentProfileInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ ok: boolean; version?: string; error?: string } | null>(null);
  const [sysConfig, setSysConfig] = useState<SystemConfig | null>(null);
  const games = useMemo(() => listGames(), []);

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((data: AgentProfileInfo[]) => {
        setAgents(data);
        setSelectedId(data[0]?.id ?? null);
        setLoaded(true);
      })
      .catch(() => toastMsg('加载 Agent 配置失败'));
    fetch('/api/system')
      .then((r) => r.json())
      .then((data: SystemConfig) => setSysConfig(data))
      .catch(() => {});
  }, []);

  const selected = agents.find((a) => a.id === selectedId) ?? null;

  const update = (patch: Partial<AgentProfileInfo>) => {
    if (!selectedId) return;
    setAgents((prev) => prev.map((a) => (a.id === selectedId ? { ...a, ...patch } : a)));
    setDirty(true);
  };

  const updateProvider = (patch: Partial<AgentProviderInfo>) => {
    if (!selected?.provider) return;
    update({ provider: { ...selected.provider, ...patch } });
  };

  const toggleGame = (g: GameId) => {
    if (!selected) return;
    const cur = selected.games ?? [];
    const next = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g];
    update({ games: next });
  };

  const setGamePolicy = (g: GameId, text: string) => {
    if (!selected) return;
    const gp = { ...(selected.gamePolicy ?? {}) };
    if (text.trim()) gp[g] = text;
    else delete gp[g];
    update({ gamePolicy: gp });
  };

  const save = async () => {
    try {
      const res = await fetch('/api/agents', {
        method: 'PUT',
        headers: adminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(agents),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? '保存失败');
      setAgents(data);
      setDirty(false);
      toastMsg('已保存');
    } catch (e) {
      toastMsg(e instanceof Error ? e.message : '保存失败');
    }
  };

  const createAgent = () => {
    const id = `custom-${Date.now().toString(36)}`;
    const agent = emptyAgent(id);
    setAgents((prev) => [...prev, agent]);
    setSelectedId(id);
    setDirty(true);
  };

  const resetBuiltin = async (id: string) => {
    try {
      const res = await fetch('/api/agents/defaults');
      const defaults: AgentProfileInfo[] = await res.json();
      const def = defaults.find((d) => d.id === id);
      if (!def) return;
      setAgents((prev) => prev.map((a) => (a.id === id ? def : a)));
      setDirty(true);
      toastMsg('已重置为默认（需保存生效）');
    } catch {
      toastMsg('重置失败');
    }
  };

  const removeAgent = (id: string) => {
    const target = agents.find((a) => a.id === id);
    if (!target) return;
    if (target.builtin) {
      resetBuiltin(id);
      return;
    }
    if (!confirm(`删除 Agent「${target.name}」？此操作不可撤销。`)) return;
    const rest = agents.filter((a) => a.id !== id);
    setAgents(rest);
    setSelectedId(rest[0]?.id ?? null);
    setDirty(true);
  };

  const checkCurrentProvider = async () => {
    if (!selected?.provider) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch('/api/agents/check-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: selected.provider.kind,
          binPath: selected.provider.binPath || sysProvider?.binPath,
          url: selected.provider.url,
          apiKey: selected.provider.apiKey,
          baseUrl: selected.provider.baseUrl,
          model: selected.provider.model,
        }),
      });
      const data = await res.json();
      setCheckResult(data);
    } catch {
      setCheckResult({ ok: false, error: '检测请求失败' });
    } finally {
      setChecking(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
        加载中…
      </div>
    );
  }

  const kind = selected?.provider?.kind ?? 'scripted';
  const isCli = kind === 'claude-code' || kind === 'codex';
  const sysMeta = isCli ? sysConfig?.providers[kind as 'claude-code' | 'codex']?.meta : undefined;
  const sysProvider = isCli ? sysConfig?.providers[kind as 'claude-code' | 'codex'] : undefined;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 px-5 py-3 border-b border-white/10 shrink-0">
        <a href="/" className="btn-ghost px-3 py-1.5 text-sm">← 大厅</a>
        <h1 className="text-lg font-bold flex-1">
          <span className="bg-gradient-to-r from-indigo-300 to-purple-300 bg-clip-text text-transparent">
            Agent 配置
          </span>
        </h1>
        {dirty && <span className="text-xs text-amber-400">有未保存的修改</span>}
        <button className="btn-ghost px-3 py-1.5 text-sm" onClick={createAgent}>+ 新建</button>
        <button className="btn-primary px-4 py-1.5 text-sm" onClick={save} disabled={!dirty}>
          保存
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* 左侧列表 */}
        <aside className="w-64 shrink-0 border-r border-white/10 overflow-y-auto p-2 space-y-1">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                a.id === selectedId
                  ? 'bg-indigo-500/20 border border-indigo-400/30'
                  : 'hover:bg-white/5 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm truncate">{a.name}</span>
                {a.builtin && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400 shrink-0">
                    内置
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                {(a.games ?? []).length > 0
                  ? (a.games ?? []).map((g) => GAME_LABELS[g]).join(' / ')
                  : '全部游戏'}
                {' · '}
                {PROVIDER_KINDS.find((k) => k.value === (a.provider?.kind ?? 'scripted'))?.label ??
                  a.provider?.kind}
              </div>
            </button>
          ))}
          {agents.length === 0 && (
            <div className="text-center text-slate-500 text-sm py-8">
              暂无 Agent
              <button className="block mx-auto mt-2 btn-ghost px-3 py-1 text-xs" onClick={createAgent}>
                + 新建 Agent
              </button>
            </div>
          )}
        </aside>

        {/* 右侧编辑表单 */}
        <main className="flex-1 overflow-y-auto p-6">
          {selected ? (
            <div className="max-w-2xl space-y-5">
              {/* 基本信息 */}
              <section className="glass rounded-2xl p-5 space-y-4">
                <h2 className="text-sm font-bold text-slate-300">基本信息</h2>
                <Field label="名称">
                  <input
                    className="input w-full"
                    value={selected.name}
                    onChange={(e) => update({ name: e.target.value })}
                    maxLength={20}
                  />
                </Field>
                <Field label="人格（Persona）">
                  <textarea
                    className="input w-full h-20 resize-y"
                    value={selected.persona}
                    onChange={(e) => update({ persona: e.target.value })}
                    placeholder="例如：冷静的分析型玩家，擅长概率计算…"
                  />
                </Field>
                <Field label="策略（Strategy）">
                  <textarea
                    className="input w-full h-20 resize-y"
                    value={selected.strategy}
                    onChange={(e) => update({ strategy: e.target.value })}
                    placeholder="例如：优先防守，关键时刻果断出击…"
                  />
                </Field>
                <Field label="System Prompt（可选，覆盖默认提示词）">
                  <textarea
                    className="input w-full h-28 resize-y font-mono text-xs"
                    value={selected.systemPrompt ?? ''}
                    onChange={(e) => update({ systemPrompt: e.target.value || undefined })}
                    placeholder="留空则使用 persona + strategy + gamePolicy 自动拼装"
                  />
                </Field>
              </section>

              {/* 适用游戏 */}
              <section className="glass rounded-2xl p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-slate-300">适用游戏</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    不选 = 适用于全部游戏；选中后仅在对应游戏中可选
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {games.map((g) => {
                    const active = (selected.games ?? []).includes(g.id);
                    return (
                      <button
                        key={g.id}
                        onClick={() => toggleGame(g.id)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          active
                            ? 'bg-indigo-500 text-white shadow shadow-indigo-500/30'
                            : 'bg-white/5 text-slate-300 hover:bg-white/10'
                        }`}
                      >
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 按游戏策略 */}
              <section className="glass rounded-2xl p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-slate-300">按游戏策略细则（Game Policy）</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    每个游戏的专属策略提示，留空则不追加
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {GAME_ORDER.map((g) => (
                    <Field key={g} label={GAME_LABELS[g]}>
                      <textarea
                        className="input w-full h-24 resize-y text-xs"
                        value={selected.gamePolicy?.[g] ?? ''}
                        onChange={(e) => setGamePolicy(g, e.target.value)}
                        placeholder={`${GAME_LABELS[g]}专属策略…`}
                      />
                    </Field>
                  ))}
                </div>
              </section>

              {/* Provider 配置 */}
              <section className="glass rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-300">执行能力（Provider）</h2>
                  <button
                    className="btn-ghost px-3 py-1 text-xs"
                    onClick={checkCurrentProvider}
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
                <Field label="类型">
                  <select
                    className="input w-full"
                    value={kind}
                    onChange={(e) => update({ provider: { kind: e.target.value } })}
                  >
                    {PROVIDER_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                </Field>

                {isCli && (
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="模型（--model）">
                      <div className="flex gap-2">
                        <select
                          className="input flex-1"
                          value={
                            (selected.provider?.model ?? '') &&
                            (sysMeta?.models ?? []).includes(selected.provider?.model ?? '')
                              ? selected.provider!.model!
                              : (selected.provider?.model ?? '') ? '__custom__' : ''
                          }
                          onChange={(e) => {
                            if (e.target.value !== '__custom__') {
                              updateProvider({ model: e.target.value || undefined });
                            }
                          }}
                        >
                          <option value="">
                            {sysProvider?.defaultModel ? `系统默认: ${sysProvider.defaultModel}` : '不指定（CLI 默认）'}
                          </option>
                          {(sysMeta?.models ?? []).map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                          {(selected.provider?.model ?? '') &&
                            !(sysMeta?.models ?? []).includes(selected.provider?.model ?? '') && (
                              <option value="__custom__">自定义: {selected.provider!.model}</option>
                            )}
                          {(!(selected.provider?.model ?? '') ||
                            (sysMeta?.models ?? []).includes(selected.provider?.model ?? '')) && (
                            <option value="__custom__">自定义输入…</option>
                          )}
                        </select>
                        <input
                          className="input w-40"
                          value={selected.provider?.model ?? ''}
                          onChange={(e) => updateProvider({ model: e.target.value || undefined })}
                          placeholder="自定义"
                        />
                      </div>
                    </Field>
                    <Field label="努力程度（--effort）">
                      <select
                        className="input w-full"
                        value={selected.provider?.effort ?? ''}
                        onChange={(e) => updateProvider({ effort: e.target.value || undefined })}
                      >
                        <option value="">
                          {sysProvider?.defaultEffort ? `系统默认: ${sysProvider.defaultEffort}` : '默认'}
                        </option>
                        {(sysMeta?.efforts ?? []).map((e) => (
                          <option key={e} value={e}>{e}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="可执行文件路径（可选）">
                      <input
                        className="input w-full"
                        value={selected.provider?.binPath ?? ''}
                        onChange={(e) => updateProvider({ binPath: e.target.value || undefined })}
                        placeholder={sysProvider?.binPath || (kind === 'claude-code' ? 'claude' : 'codex')}
                      />
                    </Field>
                    <Field label="超时（毫秒）">
                      <input
                        type="number"
                        className="input w-full"
                        value={selected.provider?.timeoutMs ?? ''}
                        onChange={(e) =>
                          updateProvider({
                            timeoutMs: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        placeholder={kind === 'claude-code' ? '180000' : '120000'}
                      />
                    </Field>
                    <Field label="API Key（可选，覆盖宿主机凭据）">
                      <input
                        type="password"
                        className="input w-full"
                        value={selected.provider?.apiKey ?? ''}
                        onChange={(e) => updateProvider({ apiKey: e.target.value || undefined })}
                        placeholder={
                          selected.provider?.apiKey?.includes('•')
                            ? `已保存（${selected.provider.apiKey}）`
                            : 'sk-ant-...'
                        }
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="API 端点（可选）">
                      <input
                        className="input w-full"
                        value={selected.provider?.baseUrl ?? ''}
                        onChange={(e) => updateProvider({ baseUrl: e.target.value || undefined })}
                        placeholder="https://api.anthropic.com"
                      />
                    </Field>
                    {kind === 'claude-code' && (
                      <Field label="配置目录（可选，多账号隔离）">
                        <input
                          className="input w-full"
                          value={selected.provider?.configDir ?? ''}
                          onChange={(e) => updateProvider({ configDir: e.target.value || undefined })}
                          placeholder="CLAUDE_CONFIG_DIR，如 /data/keys/acct-1"
                        />
                      </Field>
                    )}
                  </div>
                )}

                {kind === 'anthropic' && (
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="模型">
                      <input
                        className="input w-full"
                        value={selected.provider?.model ?? ''}
                        onChange={(e) => updateProvider({ model: e.target.value || undefined })}
                        placeholder="claude-sonnet-5"
                      />
                    </Field>
                    <Field label="努力程度">
                      <select
                        className="input w-full"
                        value={selected.provider?.effort ?? ''}
                        onChange={(e) => updateProvider({ effort: e.target.value || undefined })}
                      >
                        <option value="">默认</option>
                        {['low', 'medium', 'high', 'xhigh', 'max'].map((e) => (
                          <option key={e} value={e}>{e}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="API Key">
                      <input
                        type="password"
                        className="input w-full"
                        value={selected.provider?.apiKey ?? ''}
                        onChange={(e) => updateProvider({ apiKey: e.target.value || undefined })}
                        placeholder={
                          selected.provider?.apiKey?.includes('•')
                            ? `已保存（${selected.provider.apiKey}）`
                            : 'sk-ant-...'
                        }
                        autoComplete="off"
                      />
                    </Field>
                    <Field label="API 端点（可选，默认官方）">
                      <input
                        className="input w-full"
                        value={selected.provider?.baseUrl ?? ''}
                        onChange={(e) => updateProvider({ baseUrl: e.target.value || undefined })}
                        placeholder="https://api.anthropic.com"
                      />
                    </Field>
                    <Field label="超时（毫秒）">
                      <input
                        type="number"
                        className="input w-full"
                        value={selected.provider?.timeoutMs ?? ''}
                        onChange={(e) =>
                          updateProvider({
                            timeoutMs: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        placeholder="120000"
                      />
                    </Field>
                  </div>
                )}

                {kind === 'http' && (
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Webhook URL">
                      <input
                        className="input w-full"
                        value={selected.provider?.url ?? ''}
                        onChange={(e) => updateProvider({ url: e.target.value || undefined })}
                        placeholder="https://example.com/agent"
                      />
                    </Field>
                    <Field label="超时（毫秒）">
                      <input
                        type="number"
                        className="input w-full"
                        value={selected.provider?.timeoutMs ?? ''}
                        onChange={(e) =>
                          updateProvider({
                            timeoutMs: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        placeholder="30000"
                      />
                    </Field>
                  </div>
                )}

                {kind === 'scripted' && (
                  <p className="text-[11px] text-slate-500">
                    内置启发式 provider，无需额外配置，离线可用。
                  </p>
                )}
              </section>

              {/* 操作按钮 */}
              <div className="flex gap-3 pb-8">
                <button className="btn-primary px-5 py-2 text-sm" onClick={save} disabled={!dirty}>
                  保存修改
                </button>
                {selected.builtin ? (
                  <button
                    className="btn-ghost px-4 py-2 text-sm"
                    onClick={() => resetBuiltin(selected.id)}
                  >
                    重置为默认
                  </button>
                ) : (
                  <button
                    className="px-4 py-2 text-sm rounded-xl bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/20 transition-colors"
                    onClick={() => removeAgent(selected.id)}
                  >
                    删除 Agent
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              选择左侧 Agent 进行编辑
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
