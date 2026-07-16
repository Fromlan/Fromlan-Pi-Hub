import { useEffect, useState } from "react";
import { useStore } from "./store";
import { TabBar } from "./components/TabBar";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { PluginsPanel } from "./components/PluginsPanel";
import { PLUGIN_TAB_ID } from "../shared/types";

export function App() {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeId);
  const persistedSessions = useStore((s) => s.persistedSessions);
  const [showNew, setShowNew] = useState(false);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const isPluginsTab = activeId === PLUGIN_TAB_ID;

  // 判断当前活跃的是否为"历史会话占位"（仅在 persistedSessions 中存在）
  const isPersistedActive =
    !active && !isPluginsTab && activeId != null && persistedSessions.some((p) => p.id === activeId);
  const persistedActive = isPersistedActive
    ? persistedSessions.find((p) => p.id === activeId) ?? null
    : null;

  useEffect(() => {
    const store = useStore.getState();
    // 首帧拉取现有会话和历史会话
    window.sessionAPI.list().then((list) => store.setSessions(list));
    window.sessionAPI.historyList().then((list) => store.setPersistedSessions(list));

    const unsubs = [
      window.sessionAPI.onSpawned((snap) => useStore.getState().upsertSession(snap)),
      window.sessionAPI.onChange((snap) => useStore.getState().upsertSession(snap)),
      window.sessionAPI.onKilled((id) => {
        const state = useStore.getState();
        state.removeSession(id);
        // 杀掉后刷新历史会话列表（因为 kill 时会把会话移到 persisted）
        window.sessionAPI.historyList().then((list) => state.setPersistedSessions(list));
      }),
      window.sessionAPI.onEvent(({ sessionId, event }) =>
        useStore.getState().applyEvent(sessionId, event)
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // 点击历史会话 tab 时加载其消息
  useEffect(() => {
    if (!persistedActive) return;
    const store = useStore.getState();
    // 只在未加载过消息时加载
    if (store.messagesBySession[persistedActive.id]?.length) return;
    window.sessionAPI.historyGetMessages(persistedActive.id).then((msgs) => {
      store.importMessages(persistedActive.id, msgs);
    });
  }, [persistedActive?.id]);

  return (
    <div className="app">
      <TabBar onNew={() => setShowNew(true)} />
      <div className="main">
        {isPluginsTab ? (
          <PluginsPanel />
        ) : active ? (
          <>
            <MessageList sessionId={active.id} />
            <Composer session={active} />
          </>
        ) : persistedActive ? (
          <>
            <MessageList sessionId={persistedActive.id} />
            <Composer session={persistedActive} />
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
