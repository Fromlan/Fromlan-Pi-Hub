import type { IssueStatus } from "../../shared/types";

/**
 * Multica 风格 Issue 状态进度环（14px），用于看板列头 / 详情侧栏。
 */
export function IssueStatusIcon({
  status,
  size = 14,
}: {
  status: IssueStatus;
  size?: number;
}) {
  const r = 5.5;
  const c = size / 2;
  const circ = 2 * Math.PI * r;

  return (
    <svg
      className={`issue-status-icon issue-status-icon-${status}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      {status === "backlog" && (
        <>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
            return (
              <circle
                key={i}
                cx={c + Math.cos(a) * 4.2}
                cy={c + Math.sin(a) * 4.2}
                r={0.9}
                className="issue-status-icon-fill"
              />
            );
          })}
        </>
      )}
      {status === "todo" && (
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="2.2 1.8"
          className="issue-status-icon-stroke"
        />
      )}
      {status === "in_progress" && (
        <>
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            strokeWidth={1.5}
            className="issue-status-icon-track"
          />
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray={`${circ * 0.45} ${circ}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${c} ${c})`}
            className="issue-status-icon-stroke"
          />
        </>
      )}
      {status === "in_review" && (
        <>
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            strokeWidth={1.5}
            className="issue-status-icon-track"
          />
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray={`${circ * 0.75} ${circ}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${c} ${c})`}
            className="issue-status-icon-stroke"
          />
        </>
      )}
      {status === "done" && (
        <>
          <circle cx={c} cy={c} r={r} className="issue-status-icon-fill" />
          <path
            d={`M${c - 2.2} ${c} l1.6 1.6 l3.2 -3.4`}
            fill="none"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="issue-status-icon-check"
          />
        </>
      )}
      {status === "blocked" && (
        <>
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            strokeWidth={1.5}
            className="issue-status-icon-stroke"
          />
          <line
            x1={c - 3}
            y1={c + 3}
            x2={c + 3}
            y2={c - 3}
            strokeWidth={1.5}
            strokeLinecap="round"
            className="issue-status-icon-stroke"
          />
        </>
      )}
      {status === "cancelled" && (
        <>
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            strokeWidth={1.5}
            className="issue-status-icon-stroke"
          />
          <path
            d={`M${c - 2.5} ${c - 2.5} L${c + 2.5} ${c + 2.5} M${c + 2.5} ${c - 2.5} L${c - 2.5} ${c + 2.5}`}
            strokeWidth={1.4}
            strokeLinecap="round"
            className="issue-status-icon-stroke"
          />
        </>
      )}
    </svg>
  );
}
