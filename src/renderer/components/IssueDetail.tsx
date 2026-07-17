import { useEffect, useState } from "react";
import { useStore } from "../store";
import { IssueKey } from "./IssueKey";
import { PriorityBadge } from "./PriorityBadge";
import { AssigneePicker } from "./AssigneePicker";
import { NewSessionDialog } from "./NewSessionDialog";
import { ISSUE_STATUSES } from "../store";
import type { Issue, IssueStatus, IssuePriority } from "../../shared/types";

const PRIORITIES: IssuePriority[] = ["urgent", "high", "medium", "low"];

const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "Backlog",
  todo: "To Do",
  in_progress: "进行中",
  in_review: "Review",
  done: "完成",
  blocked: "阻塞",
  cancelled: "取消",
};

const EMPTY_COMMENTS: import("../../shared/types").Comment[] = [];

export function IssueDetail() {
  const id = useStore((s) => s.activeIssueId);
  const issue = useStore((s) => (id ? s.issues.find((i) => i.id === id) ?? null : null));
  const comments = useStore((s) =>
    id ? s.commentsByIssue[id] ?? EMPTY_COMMENTS : EMPTY_COMMENTS
  );
  const upsertIssue = useStore((s) => s.upsertIssue);
  const appendComment = useStore((s) => s.appendComment);
  const removeCommentById = useStore((s) => s.removeCommentById);
  const setCommentsForIssue = useStore((s) => s.setCommentsForIssue);
  const setActiveIssue = useStore((s) => s.setActiveIssue);
  const [body, setBody] = useState("");
  const [showRun, setShowRun] = useState(false);

  useEffect(() => {
    if (!id) return;
    const target = id;
    window.issueAPI.commentList(target).then((cs) => {
      // 仅当 activeIssueId 未变才落地，避免竞态把别的 issue 评论刷进来
      if (useStore.getState().activeIssueId === target) {
        setCommentsForIssue(target, cs);
      }
    });
  }, [id, setCommentsForIssue]);

  if (!issue) {
    return (
      <div className="empty-state">
        <p>选择一个 issue 查看详情</p>
        <button
          className="btn"
          onClick={() => setActiveIssue(null)}
        >
          返回看板
        </button>
      </div>
    );
  }

  const update = (patch: Partial<Issue>) => {
    const next: Issue = { ...issue, ...patch, updatedAt: Date.now() };
    upsertIssue(next);
    window.issueAPI.update(issue.id, patch);
  };

  const submitComment = async () => {
    const text = body.trim();
    if (!text) return;
    const r = await window.issueAPI.commentAdd({
      issueId: issue.id,
      author: { kind: "human", id: "default", name: "me" },
      body: text,
      mentions: [],
    });
    if (r.ok) {
      appendComment(r.comment);
      setBody("");
    }
  };

  const deleteComment = async (cid: string) => {
    const ok = confirm("删除这条评论？");
    if (!ok) return;
    const r = await window.issueAPI.commentDelete(cid);
    if (r.ok) removeCommentById(cid);
  };

  return (
    <div className="issue-detail">
      <section className="issue-detail-meta">
        <header className="issue-detail-meta-head">
          <IssueKey issue={issue} />
          <PriorityBadge priority={issue.priority} />
          <span className={`issue-status-pill status-${issue.status}`}>
            {STATUS_LABEL[issue.status]}
          </span>
        </header>
        <input
          className="form-input issue-title-input"
          value={issue.title}
          onChange={(e) => update({ title: e.target.value })}
        />
        <textarea
          className="form-input issue-description-input"
          rows={4}
          placeholder="描述(可选)"
          value={issue.description ?? ""}
          onChange={(e) => update({ description: e.target.value })}
        />
        <div className="issue-detail-controls">
          <label className="form-row-inline">
            <span className="form-label">状态</span>
            <select
              className="form-input"
              value={issue.status}
              onChange={(e) =>
                update({ status: e.target.value as IssueStatus })
              }
            >
              {ISSUE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="form-row-inline">
            <span className="form-label">优先级</span>
            <select
              className="form-input"
              value={issue.priority}
              onChange={(e) =>
                update({ priority: e.target.value as IssuePriority })
              }
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="form-row-inline">
            <span className="form-label">负责人</span>
            <AssigneePicker
              value={issue.assignee}
              onChange={(a) => {
                update({ assignee: a });
                window.issueAPI.assign(issue.id, a);
              }}
            />
          </label>
        </div>
        <div className="issue-detail-actions">
          <button className="btn btn-primary" onClick={() => setShowRun(true)}>
            ▶ Run
          </button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!confirm("删除此 issue 及其评论？")) return;
              const r = await window.issueAPI.delete(issue.id);
              if (r.ok) {
                setActiveIssue(null);
              }
            }}
          >
            删除
          </button>
        </div>
      </section>

      <section className="issue-detail-comments">
        <header className="issue-detail-comments-head">
          <h3>评论</h3>
          <span className="tabular">{comments.length}</span>
        </header>
        <div className="comment-list">
          {comments.map((c) => (
            <article key={c.id} className="comment-item">
              <header className="comment-head">
                <span>{c.author.name}</span>
                <time>{new Date(c.createdAt).toLocaleString()}</time>
                <button
                  className="comment-delete"
                  onClick={() => deleteComment(c.id)}
                  aria-label="删除评论"
                >
                  ✕
                </button>
              </header>
              <p className="comment-body">{c.body}</p>
            </article>
          ))}
          {comments.length === 0 && (
            <p className="muted">还没有评论</p>
          )}
        </div>
        <div className="comment-compose">
          <textarea
            rows={3}
            className="form-input"
            placeholder="写一条评论…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <button
            className="btn"
            onClick={submitComment}
            disabled={!body.trim()}
          >
            发送
          </button>
        </div>
      </section>

      {showRun && (
        <NewSessionDialog
          issueId={issue.id}
          presetTitle={issue.title}
          assigneeName={
            issue.assignee.kind === "agent" ? issue.assignee.id : ""
          }
          onClose={() => setShowRun(false)}
        />
      )}
    </div>
  );
}
