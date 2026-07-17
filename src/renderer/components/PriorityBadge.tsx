import type { IssuePriority } from "../../shared/types";

const LABEL: Record<IssuePriority, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

export function PriorityBadge({ priority }: { priority: IssuePriority }) {
  return (
    <span
      className={`priority-badge priority-${priority}`}
      title={`优先级 ${LABEL[priority]}`}
    >
      <span className="priority-dot" />
      {LABEL[priority]}
    </span>
  );
}
