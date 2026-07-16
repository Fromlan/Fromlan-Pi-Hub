import { useStore } from "../store";
import { StatusIcon } from "./StatusIcon";
import { X } from "lucide-react";
import type { SessionSnapshot } from "../../shared/types";

interface Props {
  session: SessionSnapshot;
  active: boolean;
  stopped?: boolean;
}

export function SessionCard({ session, active, stopped }: Props) {
  const setSession = useStore((s) => s.setSession);
  const setPersistedSession = useStore((s) => s.setPersistedSession);
  const closeSession = useStore((s) => s.closeSession);
  const deletePersisted = useStore((s) => s.deletePersisted);

  const onSelect = () => {
    if (stopped) setPersistedSession(session.id);
    else setSession(session.id);
  };

  const onClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (stopped) deletePersisted(session.id);
    else closeSession(session.id);
  };

  return (
    <div
      className={`session-card${active ? " session-card-active" : ""}${stopped ? " session-card-stopped" : ""}`}
      onClick={onSelect}
      title={`${session.provider} / ${session.model}${session.pid ? ` · pid ${session.pid}` : ""}${stopped ? " · 已停止" : ""}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <StatusIcon status={session.status} />
      <div className="session-card-body">
        <div className="session-card-title">{session.title}</div>
        <div className="session-card-meta tabular">
          {session.provider} · {session.model}
        </div>
      </div>
      <button
        className="session-card-close"
        onClick={onClose}
        title={stopped ? "删除历史" : "关闭会话"}
        aria-label={stopped ? "删除历史会话" : "关闭会话"}
      >
        <X size={12} />
      </button>
    </div>
  );
}