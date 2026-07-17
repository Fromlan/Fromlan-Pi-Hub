import { useMemo, useState } from "react";
import { useStore, groupByStatus, ISSUE_STATUSES } from "../store";
import { IssueCard } from "./IssueCard";
import { IssueCreateDialog } from "./IssueCreateDialog";
import type { IssueStatus } from "../../shared/types";

const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "进行中",
  in_review: "Review",
  done: "完成",
  blocked: "阻塞",
  cancelled: "取消",
};

export function KanbanPanel() {
  const issues = useStore((s) => s.issues);
  const setActiveIssue = useStore((s) => s.setActiveIssue);
  const [creating, setCreating] = useState(false);

  const grouped = useMemo(() => groupByStatus(issues), [issues]);

  // 拖拽：先在本地乐观更新 store，再 IPC；失败回滚 + setNotice
  const handleDrop = (id: string, target: IssueStatus) => {
    const cur = useStore.getState().issues.find((i) => i.id === id);
    if (!cur || cur.status === target) return;
    const prevStatus = cur.status;
    // 乐观更新
    useStore.getState().upsertIssue({
      ...cur,
      status: target,
      updatedAt: Date.now(),
    });
    window.issueAPI
      .setStatus(id, target)
      .then((r) => {
        if (!r.ok) {
          // 回滚
          const now = useStore.getState().issues.find((i) => i.id === id);
          if (now) {
            useStore.getState().upsertIssue({ ...now, status: prevStatus });
          }
          const msg = r.ok === false && "error" in r ? `改 status 失败: ${r.error}` : "改 status 失败";
          useStore.getState().setNotice(msg);
        }
      })
      .catch((e) => {
        const now = useStore.getState().issues.find((i) => i.id === id);
        if (now) {
          useStore.getState().upsertIssue({ ...now, status: prevStatus });
        }
        useStore
          .getState()
          .setNotice(`改 status 失败: ${(e as Error).message}`);
      });
  };

  return (
    <>
      <div className="kanban">
        <header className="kanban-toolbar">
          <h2>看板</h2>
          <button
            className="btn btn-primary"
            onClick={() => setCreating(true)}
          >
            ＋ 新建 Issue
          </button>
        </header>
        <div className="kanban-columns">
          {ISSUE_STATUSES.map((s) => (
            <div
              key={s}
              className={`kanban-col kanban-col-${s}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData("text/issue-id");
                if (id) handleDrop(id, s);
              }}
            >
              <header className="kanban-col-head">
                <span className={`status-dot status-${s}`} aria-hidden />
                <span className="kanban-col-title">{STATUS_LABEL[s]}</span>
                <span className="tabular kanban-col-count">
                  {grouped[s].length}
                </span>
              </header>
              <div className="kanban-col-list">
                {grouped[s].map((i) => (
                  <div
                    key={i.id}
                    draggable
                    onDragStart={(e) =>
                      e.dataTransfer.setData("text/issue-id", i.id)
                    }
                  >
                    <IssueCard issue={i} onOpen={() => setActiveIssue(i.id)} />
                  </div>
                ))}
                {grouped[s].length === 0 && (
                  <p className="kanban-col-empty">空</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {creating && <IssueCreateDialog onClose={() => setCreating(false)} />}
    </>
  );
}
