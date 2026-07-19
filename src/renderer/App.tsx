import { useEffect, useState, type ReactNode } from "react";
import { useStore } from "./store";
import { IconRail } from "./components/IconRail";
import { Sidebar } from "./components/Sidebar";
import { NewSessionDialog } from "./components/NewSessionDialog";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { PluginsPanel } from "./components/PluginsPanel";
import { AgentsPanel } from "./components/AgentsPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { KanbanPanel } from "./components/KanbanPanel";
import { IssueDetail } from "./components/IssueDetail";
import { SquadsPanel } from "./components/SquadsPanel";
import { AutopilotsPanel } from "./components/AutopilotsPanel";
import { InboxPanel } from "./components/InboxPanel";
import { ProjectsPanel } from "./components/ProjectsPanel";
import { HelperWelcomeModal } from "./components/HelperWelcomeModal";

export function App() {
  const sessions = useStore((s) => s.sessions);
  const activePanel = useStore((s) => s.activePanel);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const activePersistedId = useStore((s) => s.activePersistedId);
  const persistedSessions = useStore((s) => s.persistedSessions);
  const viewMode = useStore((s) => s.viewMode);
  const appSettings = useStore((s) => s.appSettings);
  const [showNew, setShowNew] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);

  const active =
    activePanel === "chat" && viewMode === "session" && activeSessionId
      ? sessions.find((s) => s.id === activeSessionId) ?? null
      : null;
  const persistedActive =
    activePanel === "chat" && viewMode === "session" && !active && activePersistedId
      ? persistedSessions.find((p) => p.id === activePersistedId) ?? null
      : null;

  useEffect(() => {
    const store = useStore.getState();
    window.sessionAPI.list().then((list) => store.setSessions(list));
    window.sessionAPI.historyList().then((list) => store.setPersistedSessions(list));
    window.issueAPI.list().then((list) => useStore.getState().setIssues(list));
    window.issueAPI.taskList().then((list) => useStore.getState().setTasks(list));
    window.appAPI.getSettings().then((s) => {
      useStore.getState().setAppSettings(s);
      setSettingsReady(true);
    });
    window.agentAPI.list().then((list) => useStore.getState().setAgents(list));
    window.squadAPI.list().then((list) => useStore.getState().setSquads(list));
    window.projectAPI.list().then((list) => useStore.getState().setProjects(list));

    const unsubs = [
      window.sessionAPI.onSpawned((snap) => useStore.getState().upsertSession(snap)),
      window.sessionAPI.onChange((snap) => useStore.getState().upsertSession(snap)),
      window.sessionAPI.onKilled((id) => {
        const state = useStore.getState();
        state.removeSession(id);
        window.sessionAPI.historyList().then((list) => state.setPersistedSessions(list));
      }),
      window.sessionAPI.onEvent(({ sessionId, event }) =>
        useStore.getState().applyEvent(sessionId, event)
      ),
      window.issueAPI.onCreated((i) => useStore.getState().upsertIssue(i)),
      window.issueAPI.onChanged((i) => useStore.getState().upsertIssue(i)),
      window.issueAPI.onDeleted(({ id }) => useStore.getState().removeIssue(id)),
      window.issueAPI.onCommentAdded((c) => useStore.getState().appendComment(c)),
      window.issueAPI.onCommentDeleted(({ id }) =>
        useStore.getState().removeCommentById(id)
      ),
      window.issueAPI.onTaskChanged((t) => useStore.getState().upsertTask(t)),
      window.squadAPI.onChanged((s) => useStore.getState().upsertSquad(s)),
      window.projectAPI.onChanged((p) => {
        if ("deleted" in p && p.deleted) {
          useStore.getState().removeProject(p.id);
        } else {
          useStore.getState().upsertProject(p as import("../shared/types").Project);
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    if (!persistedActive) return;
    const store = useStore.getState();
    if (store.messagesBySession[persistedActive.id]?.length) return;
    window.sessionAPI.historyGetMessages(persistedActive.id).then((msgs) => {
      store.importMessages(persistedActive.id, msgs);
    });
  }, [persistedActive?.id]);

  const lastNotice = useStore((s) => s.lastNotice);

  let mainPanel: ReactNode;
  if (activePanel === "agents") {
    mainPanel = <AgentsPanel />;
  } else if (activePanel === "plugins") {
    mainPanel = <PluginsPanel />;
  } else if (activePanel === "settings") {
    mainPanel = <SettingsPanel />;
  } else if (activePanel === "squads") {
    mainPanel = <SquadsPanel />;
  } else if (activePanel === "projects") {
    mainPanel = <ProjectsPanel />;
  } else if (activePanel === "autopilots") {
    mainPanel = <AutopilotsPanel />;
  } else if (activePanel === "inbox") {
    mainPanel = <InboxPanel />;
  } else {
    mainPanel = (
      <div className="chat-layout">
        <Sidebar onNew={() => setShowNew(true)} />
        <main className="main">
          {lastNotice && (
            <div
              className="top-notice"
              role="status"
              onClick={() => useStore.getState().setNotice(null)}
            >
              {lastNotice}（点击关闭）
            </div>
          )}
          {viewMode === "kanban" ? (
            <KanbanPanel />
          ) : viewMode === "list" ? (
            <IssueDetail />
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
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <IconRail />
      {mainPanel}
      {showNew && <NewSessionDialog onClose={() => setShowNew(false)} />}
      {settingsReady && !appSettings.onboardedAt && <HelperWelcomeModal />}
    </div>
  );
}
