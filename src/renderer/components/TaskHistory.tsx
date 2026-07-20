import { useMemo, useState } from "react";
import { useStore } from "../store";
import {
  TASK_REASON_LABEL,
  TASK_STATUS_LABEL,
  TASK_TRIGGER_LABEL,
} from "../../shared/labels";
import type { Task } from "../../shared/types";

function fmtTime(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1);
  const dd = String(d.getDate());
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}:${ss}`;
}

function timelineParts(t: Task): { label: string; ts?: number }[] {
  return [
    { label: "创建", ts: t.createdAt },
    { label: "派活", ts: t.dispatchedAt },
    { label: "运行", ts: t.runningAt },
    { label: "结束", ts: t.finishedAt },
  ];
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

  const retryRow = async (task: Task) => {
    setRerunningId(task.id);
    const r = await window.issueAPI.rerun(issueId, {
      resumeFromTaskId: task.id,
      cwd: task.workdir ?? task.cwd,
    });
    setRerunningId(null);
    if (!r.ok) {
      setNotice(`重试失败：${r.error}`);
      return;
    }
    if (r.skipped) setNotice(`未派活：${r.skipped}`);
    else {
      const poisoned =
        task.sessionPoisoned || task.errorInfo?.reason === "session_poisoned";
      setNotice(
        poisoned
          ? "已重试（复用工作目录，新会话）"
          : "已重试（尽量续聊同一会话）"
      );
    }
  };

  return (
    <section className="task-history">
      <header className="task-history-head">
        <h3>Task 历史</h3>
        <span className="task-history-count tabular">{rows.length}</span>
      </header>
      {rows.length === 0 ? (
        <p className="task-history-empty">还没有派活记录</p>
      ) : (
        <ul className="task-history-list">
          {rows.map((t) => {
            const canRetry = t.status === "failed" || t.status === "cancelled";
            const parts = timelineParts(t).filter((p) => p.ts);
            return (
              <li key={t.id} className={`task-history-item status-${t.status}`}>
                <div className="task-history-item-main">
                  <div className="task-history-item-top">
                    <span className="task-history-attempt tabular">#{t.attempt}</span>
                    <span className={`task-status-badge status-${t.status}`}>
                      {TASK_STATUS_LABEL[t.status]}
                    </span>
                    <span className="task-history-agent" title={t.agentName}>
                      {t.agentName}
                    </span>
                    <span className="task-history-trigger">
                      {TASK_TRIGGER_LABEL[t.trigger] ?? t.trigger}
                    </span>
                    {canRetry && (
                      <button
                        type="button"
                        className="btn btn-sm task-history-retry"
                        disabled={rerunningId === t.id}
                        onClick={() => retryRow(t)}
                        title="按此行复用 workdir/session（毒化则仅复用目录）"
                      >
                        {rerunningId === t.id ? "…" : "重试"}
                      </button>
                    )}
                  </div>
                  {parts.length > 0 && (
                    <ol className="task-history-timeline">
                      {parts.map((p, i) => (
                        <li key={p.label} className="task-history-tl-step">
                          {i > 0 && <span className="task-history-tl-sep" aria-hidden />}
                          <span className="task-history-tl-label">{p.label}</span>
                          <time className="task-history-tl-time tabular" dateTime={new Date(p.ts!).toISOString()}>
                            {fmtTime(p.ts)}
                          </time>
                        </li>
                      ))}
                    </ol>
                  )}
                  {t.error && (
                    <div className="task-history-error">
                      <span className="task-history-error-msg" title={t.error}>
                        {t.errorInfo
                          ? TASK_REASON_LABEL[t.errorInfo.reason] ?? t.errorInfo.reason
                          : "错误"}
                        ：{t.error}
                      </span>
                      {t.errorInfo?.retryable != null && (
                        <span
                          className={`task-retryable-badge${t.errorInfo.retryable ? " retryable" : " not-retryable"}`}
                        >
                          {t.errorInfo.retryable ? "可重试" : "不可重试"}
                        </span>
                      )}
                    </div>
                  )}
                  {t.usage && (
                    <div className="task-history-usage tabular">
                      {t.usage.inputTokens}/{t.usage.outputTokens} tokens
                      {t.usage.costUsd > 0
                        ? ` · $${t.usage.costUsd < 0.01 ? t.usage.costUsd.toFixed(4) : t.usage.costUsd.toFixed(3)}`
                        : ""}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
