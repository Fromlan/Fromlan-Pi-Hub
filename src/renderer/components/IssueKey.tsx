import type { Issue } from "../../shared/types";

export function IssueKey({ issue }: { issue: Issue }) {
  return (
    <span className="issue-key" title={`Issue ${issue.key}`}>
      {issue.key}
    </span>
  );
}
