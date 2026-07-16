import { useEffect, useMemo, useState } from "react";
import type { ModelInfo, AgentMeta } from "../../shared/types";

export function NewSessionDialog({ onClose }: { onClose: () => void }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [provider, setProvider] = useState("");
  const [modelId, setModelId] = useState("");
  const [cwd, setCwd] = useState("");
  const [title, setTitle] = useState("");
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [agentName, setAgentName] = useState<string>(""); // "" = 全局
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [list, home, agentList] = await Promise.all([
        window.appAPI.getModels(),
        window.appAPI.getHomeDir(),
        window.agentAPI.list(),
      ]);
      if (!alive) return;
      setModels(list);
      setCwd(home);
      if (list[0]) {
        setProvider(list[0].provider);
        setModelId(list[0].id);
      }
      setAgents(agentList);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const providers = useMemo(
    () => Array.from(new Set(models.map((m) => m.provider))),
    [models]
  );
  const modelsForProvider = useMemo(
    () => models.filter((m) => m.provider === provider),
    [models, provider]
  );

  const start = async () => {
    if (!provider || !modelId) return;
    setStarting(true);
    setError(null);
    const trimmedCwd = cwd.trim();
    // cwd 字段若填写则需存在且为目录；不填则交给 pi 自行决定（沿用 homedir）
    if (trimmedCwd) {
      const probe = await window.appAPI.pathStat?.(trimmedCwd);
      // 若主进程未实现 pathStat，跳过本地校验，交给 pi 失败时报错
      if (probe && !probe.ok) {
        setStarting(false);
        setError(`工作目录不可用：${probe.error}`);
        return;
      }
    }
    const r = await window.sessionAPI.start({
      provider,
      model: modelId,
      cwd: trimmedCwd || undefined,
      title: title.trim() || undefined,
      agentName: agentName || undefined,
    });
    setStarting(false);
    if (r.ok) onClose();
    else setError(r.error);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>新建会话</h2>
        {loading ? (
          <p className="dialog-loading">正在读取可用模型…</p>
        ) : models.length === 0 ? (
          <p className="dialog-error">
            未找到可用模型。请先用 <code>pi</code> 配置至少一个 provider 的 API key
            （<code>~/.pi/agent/auth.json</code>）。
          </p>
        ) : (
          <>
            <label>
              Provider
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  const first = models.find((m) => m.provider === e.target.value);
                  setModelId(first?.id ?? "");
                }}
              >
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模型
              <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
                {modelsForProvider.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Agent
              <select
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                title="选择后将关闭全局 ~/.pi/agent/ 加载，只用该 agent 自己的 prompts/skills/extensions"
              >
                <option value="">（全局 ~/.pi/agent/）</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                    {a.description ? ` — ${a.description}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              工作目录 (cwd)
              <div className="dialog-row">
                <input
                  type="text"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                  placeholder="会话的工作目录"
                />
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    const picked = await window.appAPI.pickDirectory();
                    if (picked) setCwd(picked);
                  }}
                >
                  浏览…
                </button>
              </div>
            </label>
            <label>
              标题（可选）
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="默认用模型名"
              />
            </label>
            {error && <p className="dialog-error">{error}</p>}
          </>
        )}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={start}
            disabled={loading || starting || models.length === 0 || !modelId}
          >
            {starting ? "启动中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
