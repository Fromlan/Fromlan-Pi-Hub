import { useMemo, useState } from "react";
import { useStore } from "../store";
import type { Task, TaskStatus, TaskTrigger } from "../../shared/types";

const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "排队",
  dispatched: "已派活",
  running: "执行中",
  completed: "完成",
  failed: "失败",
  cancelled: "取消",
};

const TRIGGER_LABEL: Record<TaskTrigger, string> = {
  assign: "Assign",
  status: "Status",
  rerun: "Rerun",
  create: "Create",
  mention: "Mention",
  cron: "Cron",
  squad_leader: "Squad",
  squad_member: "Squad",
  retry: "Retry",
};

const REASON_LABEL: Record<string, string> = {
  timeout: "超时",
  runtime_offline: "离线",
  runtime_recovery: "恢复",
  agent_error: "Agent",
  unknown: "未知",
};

function fmtTime(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

interface Props {
  issueId: string;
}

export function TaskHistory({ issueId }: Props) {
  const tasks = useStore((s) => s.tasks);
  const setNotice = useStore((s) => s.setNotice);
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      tasks
        .filter((t) => t.issueId === issueId)
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt),
    [tasks, issueId]
  );

  const retryRow = async (_task: Task) => {
    setRerunningId(_task.id);
    const r = await window.issueAPI.rerun(issueId);
    setRerunningId(null);
    if (!r.ok) {
      setNotice(`重试失败：${r.error}`);
      return;
    }
    if (r.skipped) setNotice(`未派活：${r.skipped}`);
    else setNotice("已重新派活");
  };

  return (
    <section className="task-history">
      <header className="task-history-head">
        <h3>Task 历史</h3>
        <span className="tabular">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="muted">还没有派活记录</p>
      ) : (
        <div className="task-history-table-wrap">
          <table className="task-history-table">
            <thead>
              <tr>
                <th>次数</th>
                <th>状态</th>
                <th>Agent</th>
                <th>触发</th>
                <th>创建</th>
                <th>派活</th>
                <th>运行</th>
                <th>结束</th>
                <th>错误</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={`task-row task-status-${t.status}`}>
                  <td className="tabular">{t.attempt}</td>
                  <td>
                    <span className={`task-status-badge status-${t.status}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td>{t.agentName}</td>
                  <td>{TRIGGER_LABEL[t.trigger] ?? t.trigger}</td>
                  <td className="tabular task-time">{fmtTime(t.createdAt)}</td>
                  <td className="tabular task-time">{fmtTime(t.dispatchedAt)}</td>
                  <td className="tabular task-time">{fmtTime(t.runningAt)}</td>
                  <td className="tabular task-time">{fmtTime(t.finishedAt)}</td>
                  <td className="task-error-cell">
                    {t.error ? (
                      <>
                        <span className="task-error-msg" title={t.error}>
                          {t.errorInfo
                            ? REASON_LABEL[t.errorInfo.reason] ?? t.errorInfo.reason
                            : "错误"}
                          ：{t.error.slice(0, 48)}
                          {t.error.length > 48 ? "…" : ""}
                        </span>
                        {t.errorInfo?.retryable != null && (
                          <span
                            className={`task-retryable-badge${t.errorInfo.retryable ? " retryable" : " not-retryable"}`}
                          >
                            {t.errorInfo.retryable ? "可重试" : "不可重试"}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {(t.status === "failed" || t.status === "cancelled") && (
                      <button
                        className="btn btn-sm"
                        disabled={rerunningId === t.id}
                        onClick={() => retryRow(t)}
                        title="重新派活此 issue"
                      >
                        {rerunningId === t.id ? "…" : "重试此行"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
