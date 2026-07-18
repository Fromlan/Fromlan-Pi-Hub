import { useEffect, useState } from "react";
import {
  useStore,
  ISSUE_STATUSES,
  STATUS_LABEL,
  issueHasActiveTask,
} from "../store";
import { ISSUE_UI, PRIORITY_LABEL } from "../../shared/labels";
import { IssueKey } from "./IssueKey";
import { PriorityIcon } from "./PriorityIcon";
import { IssueStatusIcon } from "./IssueStatusIcon";
import { ActorAvatar } from "./ActorAvatar";
import { AssigneePicker } from "./AssigneePicker";
import { ProjectPicker } from "./ProjectPicker";
import { NewSessionDialog } from "./NewSessionDialog";
import { TaskHistory } from "./TaskHistory";
import { MentionPicker } from "./MentionPicker";
import { uniqueMentions } from "../../shared/mention";
import type { Issue, IssueStatus, IssuePriority } from "../../shared/types";

const PRIORITIES: IssuePriority[] = ["urgent", "high", "medium", "low"];

const EMPTY_COMMENTS: import("../../shared/types").Comment[] = [];

export function IssueDetail() {
  const id = useStore((s) => s.activeIssueId);
  const issue = useStore((s) =>
    id ? (s.issues.find((i) => i.id === id) ?? null) : null
  );
  const issues = useStore((s) => s.issues);
  const comments = useStore((s) =>
    id ? (s.commentsByIssue[id] ?? EMPTY_COMMENTS) : EMPTY_COMMENTS
  );
  const tasks = useStore((s) => s.tasks);
  const upsertIssue = useStore((s) => s.upsertIssue);
  const appendComment = useStore((s) => s.appendComment);
  const removeCommentById = useStore((s) => s.removeCommentById);
  const setCommentsForIssue = useStore((s) => s.setCommentsForIssue);
  const setActiveIssue = useStore((s) => s.setActiveIssue);
  const setNotice = useStore((s) => s.setNotice);
  const [body, setBody] = useState("");
  const [showMention, setShowMention] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  const busy = id ? issueHasActiveTask(tasks, id) : false;
  const canRerun =
    (issue?.assignee.kind === "agent" || issue?.assignee.kind === "squad") &&
    !!issue?.assignee.id;

  useEffect(() => {
    if (!id) return;
    const target = id;
    window.issueAPI.commentList(target).then((cs) => {
      if (useStore.getState().activeIssueId === target) {
        setCommentsForIssue(target, cs);
      }
    });
  }, [id, setCommentsForIssue]);

  if (!issue) {
    return (
      <div className="empty-state">
        <p>选择一个 issue 查看详情</p>
        <button className="btn" onClick={() => setActiveIssue(null)}>
          返回看板
        </button>
      </div>
    );
  }

  const update = (patch: Partial<Issue> & { projectId?: string }) => {
    const prev = { ...issue };
    const next: Issue = { ...issue, ...patch, updatedAt: Date.now() };
    if (patch.projectId === "") {
      delete next.projectId;
    }
    upsertIssue(next);
    window.issueAPI.update(issue.id, patch).then((r) => {
      if (!r.ok) {
        upsertIssue({ ...prev, updatedAt: Date.now() });
      }
    });
  };

  const setStatus = (status: IssueStatus) => {
    const prev = { ...issue };
    upsertIssue({ ...issue, status, updatedAt: Date.now() });
    window.issueAPI.setStatus(issue.id, status).then((r) => {
      if (!r.ok) upsertIssue({ ...prev, updatedAt: Date.now() });
    });
  };

  const submitComment = async () => {
    const text = body.trim();
    if (!text) return;
    const mentions = uniqueMentions(text).map((m) => ({
      kind: m.kind,
      id: m.id,
    }));
    const r = await window.issueAPI.commentAdd({
      issueId: issue.id,
      author: { kind: "human", id: "default", name: "me" },
      body: text,
      mentions,
    });
    if (r.ok) {
      appendComment(r.comment);
      setBody("");
      setShowMention(false);
    }
  };

  const deleteComment = async (cid: string) => {
    if (!confirm("删除这条评论？")) return;
    const r = await window.issueAPI.commentDelete(cid);
    if (r.ok) removeCommentById(cid);
  };

  const rerun = async () => {
    if (!canRerun) {
      setNotice("请先指定 Agent 或 Squad 负责人");
      return;
    }
    setRerunning(true);
    const r = await window.issueAPI.rerun(issue.id);
    setRerunning(false);
    if (!r.ok) {
      setNotice(`重新派活失败：${r.error}`);
      return;
    }
    if (r.skipped) setNotice(`未派活：${r.skipped}`);
    else setNotice("已重新派活，Agent 正在执行");
  };

  const dueValue = issue.dueDate
    ? new Date(issue.dueDate).toISOString().slice(0, 10)
    : "";
  const parentOptions = issues.filter((i) => i.id !== issue.id);

  return (
    <div className="issue-detail">
      <div className="issue-detail-layout">
        {/* ── 主栏：文档 ── */}
        <div className="issue-detail-doc">
          <header className="issue-detail-breadcrumb">
            <button
              type="button"
              className="issue-detail-back"
              onClick={() => setActiveIssue(null)}
            >
              看板
            </button>
            <span className="issue-detail-crumb-sep">/</span>
            <IssueKey issue={issue} />
            {busy && <span className="issue-card-working">{ISSUE_UI.working}</span>}
          </header>

          <input
            className="form-input issue-title-hero"
            value={issue.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Issue 标题"
          />
          <textarea
            className="form-input issue-description-hero"
            rows={6}
            placeholder="添加描述…"
            value={issue.description ?? ""}
            onChange={(e) => update({ description: e.target.value })}
          />

          <section className="issue-detail-activity">
            <header className="issue-detail-comments-head">
              <h3>{ISSUE_UI.activity}</h3>
              <span className="tabular">{comments.length}</span>
            </header>
            <div className="comment-list">
              {comments.map((c) => (
                <article
                  key={c.id}
                  className={`comment-item${
                    c.author.kind === "agent" ? " comment-item-agent" : ""
                  }`}
                >
                  <header className="comment-head">
                    <ActorAvatar
                      name={c.author.name || c.author.id}
                      kind={c.author.kind === "human" ? "human" : "agent"}
                      size="md"
                    />
                    <span className="comment-author">
                      {c.author.kind === "agent"
                        ? `@${c.author.name}`
                        : c.author.name}
                    </span>
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
                <p className="muted">还没有评论。用 @ 提及 Agent 可触发派活。</p>
              )}
            </div>
            <div className="comment-compose">
              {showMention && (
                <MentionPicker
                  value={body}
                  onInsert={(md) => {
                    const at = body.lastIndexOf("@");
                    const next =
                      at >= 0 ? body.slice(0, at) + md + " " : body + md + " ";
                    setBody(next);
                  }}
                  onClose={() => setShowMention(false)}
                />
              )}
              <textarea
                rows={3}
                className="form-input"
                placeholder="写一条评论… 输入 @ 提及 Agent/Squad"
                value={body}
                onChange={(e) => {
                  const v = e.target.value;
                  setBody(v);
                  setShowMention(v.includes("@") && !v.endsWith(" "));
                }}
                onKeyDown={(e) => {
                  if (e.key === "@") setShowMention(true);
                }}
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

          <TaskHistory issueId={issue.id} />
        </div>

        {/* ── 右栏：属性 ── */}
        <aside className="issue-detail-sidebar">
          <h3 className="issue-props-title">{ISSUE_UI.properties}</h3>
          <div className="issue-props">
            <label className="issue-prop-row">
              <span className="issue-prop-label">
                <IssueStatusIcon status={issue.status} />
                状态
              </span>
              <select
                className="form-input issue-prop-value"
                value={issue.status}
                onChange={(e) => setStatus(e.target.value as IssueStatus)}
              >
                {ISSUE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>

            <label className="issue-prop-row">
              <span className="issue-prop-label">负责人</span>
              <AssigneePicker
                value={issue.assignee}
                onChange={(a) => {
                  const prev = issue.assignee;
                  upsertIssue({ ...issue, assignee: a, updatedAt: Date.now() });
                  window.issueAPI.assign(issue.id, a).then((r) => {
                    if (!r.ok) {
                      upsertIssue({
                        ...issue,
                        assignee: prev,
                        updatedAt: Date.now(),
                      });
                      useStore
                        .getState()
                        .setNotice(r.error ?? "指派失败");
                    }
                  });
                }}
              />
            </label>

            <label className="issue-prop-row">
              <span className="issue-prop-label">项目</span>
              <ProjectPicker
                value={issue.projectId}
                onChange={(projectId) =>
                  update(
                    projectId
                      ? { projectId }
                      : ({ projectId: "" } as Partial<Issue>)
                  )
                }
              />
            </label>

            <label className="issue-prop-row">
              <span className="issue-prop-label">
                <PriorityIcon priority={issue.priority} />
                优先级
              </span>
              <select
                className="form-input issue-prop-value"
                value={issue.priority}
                onChange={(e) =>
                  update({ priority: e.target.value as IssuePriority })
                }
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>

            <label className="issue-prop-row">
              <span className="issue-prop-label">截止日期</span>
              <input
                type="date"
                className="form-input issue-prop-value"
                value={dueValue}
                onChange={(e) => {
                  const v = e.target.value;
                  update({
                    dueDate: v
                      ? new Date(v + "T00:00:00").getTime()
                      : undefined,
                  });
                }}
              />
            </label>

            <label className="issue-prop-row">
              <span className="issue-prop-label">父 Issue</span>
              <select
                className="form-input issue-prop-value"
                value={issue.parent ?? ""}
                onChange={(e) =>
                  update({ parent: e.target.value || undefined })
                }
              >
                <option value="">— 无 —</option>
                {parentOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.key} {i.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="muted issue-assign-hint">
            指定 Agent/Squad 且非待办池时自动派活。
          </p>

          <div className="issue-detail-actions">
            <button
              className="btn btn-primary"
              onClick={rerun}
              disabled={rerunning || busy || !canRerun}
              title="取消当前任务并重新派活"
            >
              {rerunning ? "派活中…" : busy ? "执行中…" : "重新派活"}
            </button>
            <button className="btn" onClick={() => setShowAdvanced(true)}>
              高级…
            </button>
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (!confirm("删除此 issue 及其评论？")) return;
                const r = await window.issueAPI.delete(issue.id);
                if (r.ok) setActiveIssue(null);
              }}
            >
              删除
            </button>
          </div>

          <div className="issue-props-details">
            <div className="issue-prop-row issue-prop-readonly">
              <span className="issue-prop-label">创建</span>
              <span className="issue-prop-value muted">
                {new Date(issue.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="issue-prop-row issue-prop-readonly">
              <span className="issue-prop-label">更新</span>
              <span className="issue-prop-value muted">
                {new Date(issue.updatedAt).toLocaleString()}
              </span>
            </div>
          </div>
        </aside>
      </div>

      {showAdvanced && (
        <NewSessionDialog
          issueId={issue.id}
          presetTitle={issue.title}
          assigneeName={
            issue.assignee.kind === "agent" ? issue.assignee.id : ""
          }
          onClose={() => setShowAdvanced(false)}
        />
      )}
    </div>
  );
}
