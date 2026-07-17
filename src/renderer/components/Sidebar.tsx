import { useStore } from "../store";
import { SessionCard } from "./SessionCard";
import { SearchInput } from "./SearchInput";
import { ChevronDown, ChevronRight, MessageSquarePlus } from "lucide-react";
import { useMemo } from "react";

type ViewMode = "kanban" | "list" | "session";

export function Sidebar({ onNew }: { onNew: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const persistedSessions = useStore((s) => s.persistedSessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const activePersistedId = useStore((s) => s.activePersistedId);
  const search = useStore((s) => s.sidebarSearch);
  const showStopped = useStore((s) => s.showStoppedGroup);
  const toggleStopped = useStore((s) => s.toggleStoppedGroup);
  const viewMode = useStore((s) => s.viewMode);
  const setViewMode = useStore((s) => s.setViewMode);

  const filterFn = (s: { title: string; provider: string; model: string }) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.provider.toLowerCase().includes(q) ||
      s.model.toLowerCase().includes(q)
    );
  };

  const filteredSessions = useMemo(() => sessions.filter(filterFn), [sessions, search]);
  const filteredPersisted = useMemo(() => persistedSessions.filter(filterFn), [persistedSessions, search]);

  const empty = sessions.length === 0 && persistedSessions.length === 0;

  const VIEW_LABEL: Record<ViewMode, string> = {
    kanban: "看板",
    list: "详情",
    session: "会话",
  };

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <SearchInput />
        <div className="sidebar-viewmode" role="tablist" aria-label="视图切换">
          {(["kanban", "list", "session"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={viewMode === m}
              className={`sidebar-viewmode-btn${viewMode === m ? " is-active" : ""}`}
              onClick={() => setViewMode(m)}
              title={m === "kanban" ? "看板视图" : m === "list" ? "详情视图" : "会话视图"}
            >
              {VIEW_LABEL[m]}
            </button>
          ))}
        </div>
        <button className="sidebar-new" onClick={onNew} title="新建会话">
          <MessageSquarePlus size={13} />
          <span>新建会话</span>
        </button>
      </header>

      {empty && !search && viewMode === "session" && (
        <div className="sidebar-empty">
          <p>还没有会话</p>
          <button className="btn btn-primary" onClick={onNew}>新建第一个会话</button>
        </div>
      )}

      {viewMode === "session" && (
        <div className="sidebar-sections">
          <section className="sidebar-section">
            <header className="sidebar-section-head">
              <span>运行中</span>
              <span className="sidebar-section-count tabular">{filteredSessions.length}</span>
            </header>
            <div className="sidebar-section-list">
              {filteredSessions.length === 0 && search && (
                <div className="sidebar-section-empty">无匹配会话</div>
              )}
              {filteredSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  active={activeSessionId === s.id}
                />
              ))}
            </div>
          </section>

          <section className="sidebar-section">
            <button
              className="sidebar-section-head sidebar-section-toggle"
              onClick={toggleStopped}
              aria-expanded={showStopped}
            >
              {showStopped ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              <span>已停止</span>
              <span className="sidebar-section-count tabular">{filteredPersisted.length}</span>
            </button>
            {showStopped && (
              <div className="sidebar-section-list">
                {filteredPersisted.length === 0 && search && (
                  <div className="sidebar-section-empty">无匹配会话</div>
                )}
                {filteredPersisted.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    active={activePersistedId === s.id}
                    stopped
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}