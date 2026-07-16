import type { SessionStatus } from "../../shared/types";

const LABELS: Record<SessionStatus, string> = {
  starting: "启动中",
  idle: "空闲",
  busy: "运行中",
  compacting: "压缩中",
  exited: "已退出",
};

/** 8px 状态圆点：颜色与脉冲状态由 CSS 变量驱动。 */
export function StatusIcon({ status }: { status: SessionStatus }) {
  const pulse = status === "busy" || status === "compacting";
  return (
    <span className="status-icon" title={LABELS[status]} aria-label={LABELS[status]}>
      <span
        className={`status-icon-dot status-${status}`}
        data-pulse={pulse}
      />
    </span>
  );
}