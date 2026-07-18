import { MessageSquare } from "lucide-react";
import { useStore, issueHasActiveTask } from "../store";
import { HUMAN_ME_LABEL, ISSUE_UI } from "../../shared/labels";
import { PriorityIcon } from "./PriorityIcon";
import { ActorAvatar } from "./ActorAvatar";
import type { Comment, Issue } from "../../shared/types";

const EMPTY_COMMENTS: Comment[] = [];

function descriptionPreview(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~#>\-]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(ts).toLocaleDateString();
}

function formatDue(ts: number): { text: string; overdue: boolean } {
  const d = new Date(ts);
  const text = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return { text, overdue: end.getTime() < Date.now() };
}

export function IssueCard({
  issue,
  onOpen,
}: {
  issue: Issue;
  onOpen: () => void;
}) {
  const comments = useStore(
    (s) => s.commentsByIssue[issue.id] ?? EMPTY_COMMENTS
  );
  const tasks = useStore((s) => s.tasks);
  const squads = useStore((s) => s.squads);
  const projects = useStore((s) => s.projects);
  const running = issueHasActiveTask(tasks, issue.id);

  const projectName = issue.projectId
    ? projects.find((p) => p.id === issue.projectId)?.name
    : undefined;

  const assigneeName =
    issue.assignee.kind === "squad"
      ? (squads.find((sq) => sq.id === issue.assignee.id)?.name ??
        issue.assignee.id)
      : issue.assignee.kind === "agent"
        ? issue.assignee.id
        : issue.assignee.id === "default"
          ? HUMAN_ME_LABEL
          : issue.assignee.id || "未分配";
  const hasAssignee = !!issue.assignee.id;
  const desc = issue.description ? descriptionPreview(issue.description) : "";
  const due = issue.dueDate ? formatDue(issue.dueDate) : null;

  return (
    <button
      type="button"
      className={`issue-card${running ? " issue-card-running" : ""}`}
      onClick={onOpen}
      title={issue.description ?? issue.title}
    >
      <div className="issue-card-row1">
        <span className="issue-card-id">
          <PriorityIcon priority={issue.priority} />
          <span className="issue-key">{issue.key}</span>
        </span>
        {running && (
          <span className="issue-card-working" title="Agent 执行中">
            {ISSUE_UI.working}
          </span>
        )}
      </div>

      <h3 className="issue-card-title">{issue.title}</h3>

      {projectName ? (
        <p className="issue-card-project muted">{projectName}</p>
      ) : null}

      {desc ? <p className="issue-card-desc">{desc}</p> : null}

      <div className="issue-card-row4">
        <span className="issue-card-assignee">
          {hasAssignee ? (
            <>
              <ActorAvatar
                name={assigneeName}
                kind={issue.assignee.kind === "human" ? "human" : "agent"}
              />
              <span className="issue-card-assignee-name">
                {issue.assignee.kind === "agent" ? `@${assigneeName}` : assigneeName}
              </span>
            </>
          ) : (
            <span className="issue-card-unassigned">未分配</span>
          )}
        </span>
        <span className="issue-card-meta-right">
          {due ? (
            <span
              className={`issue-card-due${due.overdue ? " issue-card-due-overdue" : ""}`}
            >
              {due.text}
            </span>
          ) : (
            <span className="issue-card-updated">
              {formatRelative(issue.updatedAt)}
            </span>
          )}
          {comments.length > 0 && (
            <span className="issue-card-comments" title={`${comments.length} 条评论`}>
              <MessageSquare size={11} strokeWidth={1.75} />
              <span className="tabular">{comments.length}</span>
            </span>
          )}
        </span>
      </div>
    </button>
  );
}
