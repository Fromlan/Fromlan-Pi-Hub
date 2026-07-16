import type { SessionStatus } from "../../shared/types";

const COLORS: Record<SessionStatus, string> = {
  starting: "#e8c33d",
  idle: "#6bcb77",
  busy: "#4d96ff",
  compacting: "#b06bff",
  exited: "#ff6b6b",
};

const LABELS: Record<SessionStatus, string> = {
  starting: "启动中",
  idle: "空闲",
  busy: "运行中",
  compacting: "压缩中",
  exited: "已退出",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span className="status-badge" title={LABELS[status]}>
      <span
        className="status-dot"
        style={{ background: COLORS[status] }}
        data-pulse={status === "busy" || status === "compacting"}
      />
    </span>
  );
}
