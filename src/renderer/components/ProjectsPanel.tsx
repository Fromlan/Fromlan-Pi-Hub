import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import {
  PANEL_LABEL,
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  HUMAN_ME_LABEL,
} from "../../shared/labels";
import type {
  Assignee,
  IssuePriority,
  Project,
  ProjectStatus,
} from "../../shared/types";

const PROJECT_STATUSES: ProjectStatus[] = [
  "planned",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
];

const PRIORITIES: IssuePriority[] = ["urgent", "high", "medium", "low"];

/** Multica 进度：done / (linked − cancelled)；backlog 计分母不计分子。 */
export function projectProgress(
  issues: { status: string; projectId?: string }[],
  projectId: string
): { done: number; total: number; pct: number } {
  const linked = issues.filter((i) => i.projectId === projectId);
  const total = linked.filter((i) => i.status !== "cancelled").length;
  const done = linked.filter((i) => i.status === "done").length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

export function ProjectsPanel() {
  const projects = useStore((s) => s.projects);
  const setProjects = useStore((s) => s.setProjects);
  const upsertProject = useStore((s) => s.upsertProject);
  const removeProject = useStore((s) => s.removeProject);
  const issues = useStore((s) => s.issues);
  const agents = useStore((s) => s.agents);
  const setNotice = useStore((s) => s.setNotice);
  const setProjectFilterId = useStore((s) => s.setProjectFilterId);
  const setViewMode = useStore((s) => s.setViewMode);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [defaultCwd, setDefaultCwd] = useState("");

  useEffect(() => {
    window.projectAPI.list().then(setProjects);
    window.agentAPI.list().then((list) => useStore.getState().setAgents(list));
    return window.projectAPI.onChanged((p) => {
      if ("deleted" in p && p.deleted) removeProject(p.id);
      else upsertProject(p as Project);
    });
  }, [setProjects, upsertProject, removeProject]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;
  const progress = useMemo(
    () => (selected ? projectProgress(issues, selected.id) : null),
    [issues, selected]
  );
  const linkedIssues = useMemo(
    () =>
      selected
        ? issues.filter((i) => i.projectId === selected.id)
        : [],
    [issues, selected]
  );

  const create = async () => {
    if (!name.trim()) {
      setNotice("请填写项目名称");
      return;
    }
    const r = await window.projectAPI.create({
      name: name.trim(),
      description: description.trim() || undefined,
      icon: icon.trim() || undefined,
      defaultCwd: defaultCwd.trim() || undefined,
    });
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    upsertProject(r.project);
    setSelectedId(r.project.id);
    setCreating(false);
    setName("");
    setDescription("");
    setIcon("");
    setDefaultCwd("");
  };

  const saveSelected = async (patch: Partial<Project>) => {
    if (!selected) return;
    const r = await window.projectAPI.update(selected.id, patch);
    if (r.ok) upsertProject(r.project);
    else setNotice(r.error);
  };

  const pickCwd = async () => {
    const dir = await window.appAPI.pickDirectory();
    if (!dir) return;
    if (creating) setDefaultCwd(dir);
    else void saveSelected({ defaultCwd: dir });
  };

  const openInKanban = () => {
    if (!selected) return;
    setProjectFilterId(selected.id);
    setViewMode("kanban");
  };

  const leadValue = (lead?: Assignee) => {
    if (!lead?.id) return "";
    return `${lead.kind}:${lead.id}`;
  };

  const parseLead = (v: string): Assignee | undefined => {
    if (!v) return undefined;
    const [kind, ...rest] = v.split(":");
    const id = rest.join(":");
    if (kind === "human" || kind === "agent") return { kind, id };
    return undefined;
  };

  return (
    <div className="squads-panel projects-panel">
      <aside className="squads-list">
        <header className="squads-list-head">
          <h2>{PANEL_LABEL.projects}</h2>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            新建
          </button>
        </header>
        <ul>
          {projects.map((p) => {
            const prog = projectProgress(issues, p.id);
            return (
              <li key={p.id}>
                <button
                  className={`squads-item${selectedId === p.id ? " active" : ""}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <strong>
                    {p.icon ? `${p.icon} ` : ""}
                    {p.name}
                  </strong>
                  <span className="muted">
                    {PROJECT_STATUS_LABEL[p.status]} · {prog.pct}%
                  </span>
                </button>
              </li>
            );
          })}
          {projects.length === 0 && <li className="muted">还没有项目</li>}
        </ul>
      </aside>

      <main className="squads-detail">
        {creating ? (
          <div className="squads-form">
            <h3>新建项目</h3>
            <label className="form-row">
              <span className="form-label">名称</span>
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="form-row">
              <span className="form-label">图标（可选 emoji）</span>
              <input
                className="form-input"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🚀"
              />
            </label>
            <label className="form-row">
              <span className="form-label">描述</span>
              <textarea
                className="form-input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="form-row">
              <span className="form-label">默认工作目录</span>
              <div className="form-row-inline">
                <input
                  className="form-input"
                  value={defaultCwd}
                  onChange={(e) => setDefaultCwd(e.target.value)}
                  placeholder="派活时优先使用此 cwd"
                />
                <button type="button" className="btn" onClick={pickCwd}>
                  选择…
                </button>
              </div>
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
        ) : selected && progress ? (
          <div className="squads-form">
            <h3>
              {selected.icon ? `${selected.icon} ` : ""}
              {selected.name}
            </h3>
            <p className="muted">
              项目是 Issue 分组容器；删除项目不会删除 Issue。
            </p>

            <div className="project-progress">
              <div className="project-progress-bar">
                <div
                  className="project-progress-fill"
                  style={{ width: `${progress.pct}%` }}
                />
              </div>
              <span className="muted tabular">
                {progress.done}/{progress.total} · {progress.pct}%
              </span>
            </div>

            <label className="form-row">
              <span className="form-label">名称</span>
              <input
                className="form-input"
                value={selected.name}
                onChange={(e) => void saveSelected({ name: e.target.value })}
              />
            </label>
            <div className="form-row form-row-grid">
              <label>
                <span className="form-label">图标</span>
                <input
                  className="form-input"
                  value={selected.icon ?? ""}
                  onChange={(e) => void saveSelected({ icon: e.target.value })}
                  placeholder="emoji"
                />
              </label>
              <label>
                <span className="form-label">状态</span>
                <select
                  className="form-input"
                  value={selected.status}
                  onChange={(e) =>
                    void saveSelected({
                      status: e.target.value as ProjectStatus,
                    })
                  }
                >
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="form-label">优先级</span>
                <select
                  className="form-input"
                  value={selected.priority}
                  onChange={(e) =>
                    void saveSelected({
                      priority: e.target.value as IssuePriority,
                    })
                  }
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="form-label">负责人</span>
                <select
                  className="form-input"
                  value={leadValue(selected.lead)}
                  onChange={(e) =>
                    void saveSelected({ lead: parseLead(e.target.value) })
                  }
                >
                  <option value="">— 未指定 —</option>
                  <option value="human:default">{HUMAN_ME_LABEL}</option>
                  {agents.map((a) => (
                    <option key={a.name} value={`agent:${a.name}`}>
                      @{a.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="form-row">
              <span className="form-label">描述</span>
              <textarea
                className="form-input"
                rows={3}
                value={selected.description ?? ""}
                onChange={(e) =>
                  void saveSelected({ description: e.target.value })
                }
              />
            </label>
            <label className="form-row">
              <span className="form-label">默认工作目录</span>
              <div className="form-row-inline">
                <input
                  className="form-input"
                  value={selected.defaultCwd ?? ""}
                  onChange={(e) =>
                    void saveSelected({ defaultCwd: e.target.value })
                  }
                  placeholder="对齐 Multica local_directory"
                />
                <button type="button" className="btn" onClick={pickCwd}>
                  选择…
                </button>
              </div>
            </label>

            <div className="form-actions">
              <button className="btn btn-primary" onClick={openInKanban}>
                在看板中查看 Issues（{linkedIssues.length}）
              </button>
            </div>

            {linkedIssues.length > 0 && (
              <ul className="project-issue-list">
                {linkedIssues.slice(0, 20).map((i) => (
                  <li key={i.id}>
                    <button
                      type="button"
                      className="linkish"
                      onClick={() =>
                        useStore.getState().setActiveIssue(i.id)
                      }
                    >
                      {i.key} {i.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="form-actions form-actions-danger">
              <button
                className="btn btn-danger"
                onClick={async () => {
                  if (
                    !confirm(
                      `删除项目「${selected.name}」？\n关联的 Issue 只会取消归属，不会被删除。`
                    )
                  ) {
                    return;
                  }
                  const r = await window.projectAPI.delete(selected.id);
                  if (r.ok) {
                    removeProject(selected.id);
                    setSelectedId(null);
                    void window.issueAPI.list().then((list) =>
                      useStore.getState().setIssues(list)
                    );
                    setNotice("项目已删除");
                  } else {
                    setNotice(r.error ?? "删除失败");
                  }
                }}
              >
                删除项目
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <p>选择或新建一个项目</p>
          </div>
        )}
      </main>
    </div>
  );
}
