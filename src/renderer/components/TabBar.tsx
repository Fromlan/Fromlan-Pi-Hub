import { useStore } from "../store";
import { StatusBadge } from "./StatusBadge";

export function TabBar({ onNew }: { onNew: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);

  const close = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    // 触发主进程 kill；若已 exited，主进程会立即返回，但保险起见我们也移除 store 条目
    await window.sessionAPI.kill(id);
    // 主进程会通过 onKilled 事件移除 store 条目；保险：若事件丢失，1800ms 后兜底移除
    setTimeout(() => {
      const s = useStore.getState().sessions.find((x) => x.id === id);
      if (s) useStore.getState().removeSession(id);
    }, 1800);
  };

  return (
    <div className="tabbar">
      {sessions.map((s) => (
        <div
          key={s.id}
          className={`tab ${s.id === activeId ? "tab-active" : ""}`}
          onClick={() => setActive(s.id)}
          title={`${s.provider} / ${s.model}${s.pid ? ` · pid ${s.pid}` : ""}`}
        >
          <StatusBadge status={s.status} />
          <span className="tab-title">{s.title}</span>
          <button className="tab-close" onClick={(e) => close(e, s.id)}>
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={onNew} title="新建会话">
        ＋
      </button>
    </div>
  );
}
