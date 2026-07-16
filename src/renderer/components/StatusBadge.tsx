import type { SessionStatus } from "../../shared/types";
import { StatusIcon } from "./StatusIcon";

/** 兼容旧调用点，内部渲染 StatusIcon。 */
export function StatusBadge({ status }: { status: SessionStatus }) {
  return <StatusIcon status={status} />;
}