import { useEffect, useState } from "react";
import { useStore } from "./store";
import { TabBar } from "./components/TabBar";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";

export function App() {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeId);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    const store = useStore.getState();
    // 首帧拉取现有会话
    window.sessionAPI.list().then((list) => store.setSessions(list));

    const unsubs = [
      window.sessionAPI.onSpawned((snap) => useStore.getState().upsertSession(snap)),
      window.sessionAPI.onChange((snap) => useStore.getState().upsertSession(snap)),
      window.sessionAPI.onKilled((id) => useStore.getState().removeSession(id)),
      window.sessionAPI.onEvent(({ sessionId, event }) =>
        useStore.getState().applyEvent(sessionId, event)
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="app">
      <TabBar onNew={() => setShowNew(true)} />
      <div className="main">
        {active ? (
          <>
            <MessageList sessionId={active.id} />
            <Composer session={active} />
          </>
        ) : (
          <div className="empty-state">
            <p>还没有会话</p>
            <button className="btn btn-primary" onClick={() => setShowNew(true)}>
              ＋ 新建会话
            </button>
          </div>
        )}
      </div>
      {showNew && <NewSessionDialog onClose={() => setShowNew(false)} />}
    </div>
  );
}
