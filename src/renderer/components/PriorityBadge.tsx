import type { IssuePriority } from "../../shared/types";
import { PRIORITY_LABEL } from "../../shared/labels";

export function PriorityBadge({ priority }: { priority: IssuePriority }) {
  return (
    <span
      className={`priority-badge priority-${priority}`}
      title={`优先级 ${PRIORITY_LABEL[priority]}`}
    >
      <span className="priority-dot" />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}
