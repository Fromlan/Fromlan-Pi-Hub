import { useEffect, useState } from "react";
import cronstrue from "cronstrue";
import "cronstrue/locales/zh_CN";
import { useStore } from "../store";
import type { Autopilot, AutopilotRun, IssuePriority } from "../../shared/types";

function describeCron(cron: string): string {
  try {
    return cronstrue.toString(cron, { locale: "zh_CN" });
  } catch {
    return "无效 cron";
  }
}

export function AutopilotsPanel() {
  const agents = useStore((s) => s.agents);
  const setNotice = useStore((s) => s.setNotice);
  const [list, setList] = useState<Autopilot[]>([]);
  const [runs, setRuns] = useState<AutopilotRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    agentName: "",
    cron: "0 9 * * 1-5",
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    prompt: "生成今日站会摘要 {{date}}",
    mode: "create_issue" as "create_issue" | "run_only",
    priority: "medium" as IssuePriority,
  });

  const refresh = async () => {
    const aps = await window.autopilotAPI.list();
    setList(aps);
    if (selectedId) {
      setRuns(await window.autopilotAPI.runs(selectedId));
    }
  };

  useEffect(() => {
    void refresh();
    window.agentAPI.list().then((a) => useStore.getState().setAgents(a));
    return window.autopilotAPI.onChanged(() => {
      void refresh();
    });
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setRuns([]);
      return;
    }
    window.autopilotAPI.runs(selectedId).then(setRuns);
  }, [selectedId]);

  const selected = list.find((a) => a.id === selectedId) ?? null;

  const create = async () => {
    const r = await window.autopilotAPI.create({
      name: form.name.trim(),
      agentName: form.agentName,
      schedule: { cron: form.cron.trim(), tz: form.tz },
      prompt: form.prompt,
      mode: form.mode,
      priority: form.priority,
      enabled: true,
    });
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    setCreating(false);
    setSelectedId(r.autopilot.id);
    await refresh();
  };

  return (
    <div className="autopilots-panel">
      <aside className="autopilots-list">
        <header className="autopilots-list-head">
          <h2>Autopilots</h2>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            新建
          </button>
        </header>
        <ul>
          {list.map((a) => (
            <li key={a.id}>
              <button
                className={`autopilots-item${selectedId === a.id ? " active" : ""}`}
                onClick={() => setSelectedId(a.id)}
              >
                <strong>{a.name}</strong>
                <span className="muted">
                  {a.enabled ? "启用" : "停用"} · {a.agentName}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="muted">还没有 Autopilot</li>}
        </ul>
      </aside>

      <main className="autopilots-detail">
        {creating ? (
          <div className="autopilots-form">
            <h3>新建 Autopilot</h3>
            <label className="form-row">
              <span className="form-label">名称</span>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="form-row">
              <span className="form-label">Agent</span>
              <select
                className="form-input"
                value={form.agentName}
                onChange={(e) =>
                  setForm({ ...form, agentName: e.target.value })
                }
              >
                <option value="">—</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span className="form-label">Cron</span>
              <input
                className="form-input"
                value={form.cron}
                onChange={(e) => setForm({ ...form, cron: e.target.value })}
              />
              <span className="muted">{describeCron(form.cron)}</span>
            </label>
            <label className="form-row">
              <span className="form-label">时区</span>
              <input
                className="form-input"
                value={form.tz}
                onChange={(e) => setForm({ ...form, tz: e.target.value })}
              />
            </label>
            <label className="form-row">
              <span className="form-label">模式</span>
              <select
                className="form-input"
                value={form.mode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    mode: e.target.value as "create_issue" | "run_only",
                  })
                }
              >
                <option value="create_issue">创建 Issue 并派活</option>
                <option value="run_only">直接跑（仍建轻量 Issue）</option>
              </select>
            </label>
            <label className="form-row">
              <span className="form-label">Prompt</span>
              <textarea
                className="form-input"
                rows={4}
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              />
            </label>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={create}>
                创建
              </button>
              <button className="btn" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          </div>
        ) : selected ? (
          <div className="autopilots-form">
            <h3>{selected.name}</h3>
            <p className="muted">{describeCron(selected.schedule.cron)}</p>
            <p className="muted">
              Agent: {selected.agentName} · {selected.mode} ·{" "}
              {selected.enabled ? "启用" : "停用"}
            </p>
            <div className="form-actions">
              <button
                className="btn btn-primary"
                onClick={async () => {
                  const r = await window.autopilotAPI.runNow(selected.id);
                  if (!r.ok) setNotice(r.error);
                  else {
                    setNotice("已手动触发");
                    setRuns(await window.autopilotAPI.runs(selected.id));
                  }
                }}
              >
                Run now
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const r = await window.autopilotAPI.update(selected.id, {
                    enabled: !selected.enabled,
                  });
                  if (r.ok) await refresh();
                }}
              >
                {selected.enabled ? "停用" : "启用"}
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  if (!confirm("删除此 Autopilot？")) return;
                  await window.autopilotAPI.delete(selected.id);
                  setSelectedId(null);
                  await refresh();
                }}
              >
                删除
              </button>
            </div>
            <h4>触发日志</h4>
            <ul className="autopilot-runs">
              {runs.map((r) => (
                <li key={r.id}>
                  <time>{new Date(r.firedAt).toLocaleString()}</time>
                  <span className={`run-status run-${r.status}`}>{r.status}</span>
                  {r.issueId && <span className="muted">issue</span>}
                  {r.error && <span className="error-text">{r.error}</span>}
                </li>
              ))}
              {runs.length === 0 && <li className="muted">尚无触发记录</li>}
            </ul>
          </div>
        ) : (
          <div className="empty-state">
            <p>选择或新建 Autopilot</p>
          </div>
        )}
      </main>
    </div>
  );
}
