import { useStore } from "../store";
import { IssueKey } from "./IssueKey";
import { PriorityBadge } from "./PriorityBadge";
import type { Comment, Issue } from "../../shared/types";

const EMPTY_COMMENTS: Comment[] = [];

export function IssueCard({
  issue,
  onOpen,
}: {
  issue: Issue;
  onOpen: () => void;
}) {
  const comments = useStore((s) => s.commentsByIssue[issue.id] ?? EMPTY_COMMENTS);
  const assigneeLabel =
    issue.assignee.kind === "agent" ? `@${issue.assignee.id}` : "未分配";
  return (
    <button
      className="issue-card"
      onClick={onOpen}
      title={issue.description ?? issue.title}
    >
      <header className="issue-card-head">
        <IssueKey issue={issue} />
        <PriorityBadge priority={issue.priority} />
      </header>
      <h3 className="issue-card-title">{issue.title}</h3>
      <footer className="issue-card-foot">
        <span className="issue-card-assignee">{assigneeLabel}</span>
        <span className="issue-card-comments tabular">💬 {comments.length}</span>
      </footer>
    </button>
  );
}
