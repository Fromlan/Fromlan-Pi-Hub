import { useState } from "react";
import { useStore } from "../store";
import { AssigneePicker } from "./AssigneePicker";
import { ProjectPicker } from "./ProjectPicker";
import { PRIORITY_LABEL, STATUS_LABEL } from "../../shared/labels";
import type { IssuePriority, IssueStatus, Assignee } from "../../shared/types";

const STATUSES: IssueStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
];

const PRIORITIES: IssuePriority[] = ["urgent", "high", "medium", "low"];

export function IssueCreateDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<IssuePriority>("medium");
  const [status, setStatus] = useState<IssueStatus>("todo");
  const [assignee, setAssignee] = useState<Assignee>({
    kind: "agent",
    id: "",
  });
  const projectFilterId = useStore((s) => s.projectFilterId);
  const [projectId, setProjectId] = useState<string | undefined>(
    projectFilterId ?? undefined
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) {
      setError("标题不能为空");
      return;
    }
    setSubmitting(true);
    setError(null);
    const r = await window.issueAPI.create({
      title: title.trim(),
      description: description.trim() || undefined,
      priority,
      status,
      assignee: assignee.id ? assignee : { kind: "human", id: "default" },
      projectId,
    });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    // store 自动通过 onCreated 广播补一条;这里只切视图
    useStore.getState().setActiveIssue(r.issue.id);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>新建 Issue</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="modal-body">
          <label className="form-row">
            <span className="form-label">标题 *</span>
            <input
              autoFocus
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="一句话描述这个 issue…"
            />
          </label>
          <label className="form-row">
            <span className="form-label">描述</span>
            <textarea
              className="form-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="背景、验收标准、约束…(可选)"
            />
          </label>
          <div className="form-row form-row-grid">
            <label>
              <span className="form-label">状态</span>
              <select
                className="form-input"
                value={status}
                onChange={(e) => setStatus(e.target.value as IssueStatus)}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="form-label">优先级</span>
              <select
                className="form-input"
                value={priority}
                onChange={(e) => setPriority(e.target.value as IssuePriority)}
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
              <AssigneePicker value={assignee} onChange={setAssignee} />
            </label>
            <label>
              <span className="form-label">项目</span>
              <ProjectPicker value={projectId} onChange={setProjectId} />
            </label>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="modal-foot">
          <button className="btn" onClick={onClose} disabled={submitting}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={submitting || !title.trim()}
          >
            {submitting ? "创建中…" : "创建"}
          </button>
        </footer>
      </div>
    </div>
  );
}
