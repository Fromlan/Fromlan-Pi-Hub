import type { IssuePriority } from "../../shared/types";
import { PRIORITY_LABEL } from "../../shared/labels";

const FILLED: Record<IssuePriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Multica / Linear 风格：4 格竖条优先级图标（卡片上仅图标、无文字）。
 */
export function PriorityIcon({
  priority,
  size = 14,
}: {
  priority: IssuePriority;
  size?: number;
}) {
  const n = FILLED[priority];
  const barW = 2.2;
  const gap = 1.6;
  const maxH = size - 2;
  const heights = [0.35, 0.55, 0.75, 1].map((r) => Math.max(3, maxH * r));

  return (
    <svg
      className={`priority-icon priority-icon-${priority}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-label={`优先级 ${PRIORITY_LABEL[priority]}`}
      role="img"
    >
      {[0, 1, 2, 3].map((i) => {
        const h = heights[i];
        const x = 1.5 + i * (barW + gap);
        const y = size - 1 - h;
        const on = i < n;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barW}
            height={h}
            rx={0.8}
            className={on ? "priority-icon-bar-on" : "priority-icon-bar-off"}
          />
        );
      })}
    </svg>
  );
}
