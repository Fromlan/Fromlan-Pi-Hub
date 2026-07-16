import { useStore, exportMessages } from "../store";
import { StatusBadge } from "./StatusBadge";

export function TabBar({ onNew }: { onNew: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeId);
  const persistedSessions = useStore((s) => s.persistedSessions);
  const setActive = useStore((s) => s.setActive);
  const setPersistedSessions = useStore((s) => s.setPersistedSessions);
  const removeSession = useStore((s) => s.removeSession);

  const close = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    // 关闭前保存消息
    const msgs = useStore.getState().messagesBySession[id];
    if (msgs && msgs.length > 0) {
      const data = exportMessages(msgs);
      if (data.length > 0) {
        await window.sessionAPI.saveMessages(id, data);
      }
    }
    // 触发主进程 kill（kill 时会将会话移到 persistedSessions）
    await window.sessionAPI.kill(id);
    setTimeout(() => {
      const s = useStore.getState().sessions.find((x) => x.id === id);
      if (s) useStore.getState().removeSession(id);
    }, 1800);
  };

  const deletePersisted = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await window.sessionAPI.historyDelete(id);
    setPersistedSessions(persistedSessions.filter((p) => p.id !== id));
    if (activeId === id) setActive(null);
    removeSession(id);
  };

  const selectPersisted = (id: string) => {
    setActive(id);
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
      {persistedSessions.map((s) => (
        <div
          key={s.id}
          className={`tab tab-stopped ${s.id === activeId ? "tab-active" : ""}`}
          onClick={() => selectPersisted(s.id)}
          title={`${s.provider} / ${s.model} · 已停止`}
        >
          <StatusBadge status="exited" />
          <span className="tab-title">{s.title}</span>
          <button className="tab-close" onClick={(e) => deletePersisted(e, s.id)}>
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
