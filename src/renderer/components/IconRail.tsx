import { useEffect, useState } from "react";
import { useStore } from "../store";
import { PANEL_LABEL, PANEL_TOOLTIP } from "../../shared/labels";
import {
  Users,
  Plug,
  LayoutDashboard,
  Sun,
  Moon,
  Settings,
  Network,
  Timer,
  Inbox,
  FolderKanban,
} from "lucide-react";

export function IconRail() {
  const activePanel = useStore((s) => s.activePanel);
  const viewMode = useStore((s) => s.viewMode);
  const setPanel = useStore((s) => s.setPanel);
  const setViewMode = useStore((s) => s.setViewMode);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const refresh = () =>
      window.inboxAPI.list().then((items) =>
        setUnread(items.filter((i) => !i.read).length)
      );
    void refresh();
    return window.inboxAPI.onChanged(() => {
      void refresh();
    });
  }, []);

  const isKanban = activePanel === "chat" && viewMode === "kanban";

  return (
    <nav className="iconrail">
      <div className="iconrail-mid">
        <button
          className={`iconrail-btn${isKanban ? " iconrail-btn-active" : ""}`}
          onClick={() => setViewMode("kanban")}
          title={PANEL_TOOLTIP.kanban}
          aria-label={PANEL_LABEL.kanban}
        >
          <LayoutDashboard size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "projects" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("projects")}
          title={PANEL_TOOLTIP.projects}
          aria-label={`${PANEL_LABEL.projects}面板`}
        >
          <FolderKanban size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "agents" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("agents")}
          title={PANEL_TOOLTIP.agents}
          aria-label={`${PANEL_LABEL.agents}面板`}
        >
          <Users size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "squads" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("squads")}
          title={PANEL_TOOLTIP.squads}
          aria-label={`${PANEL_LABEL.squads}面板`}
        >
          <Network size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "plugins" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("plugins")}
          title={PANEL_TOOLTIP.plugins}
          aria-label={`${PANEL_LABEL.plugins}面板`}
        >
          <Plug size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "autopilots" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("autopilots")}
          title={PANEL_TOOLTIP.autopilots}
          aria-label={`${PANEL_LABEL.autopilots}面板`}
        >
          <Timer size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "inbox" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("inbox")}
          title={PANEL_TOOLTIP.inbox}
          aria-label={PANEL_LABEL.inbox}
        >
          <Inbox size={16} />
          {unread > 0 && <span className="iconrail-dot">{unread > 9 ? "9+" : unread}</span>}
        </button>
      </div>

      <div className="iconrail-bot">
        <button
          className="iconrail-btn"
          onClick={toggleTheme}
          title={theme === "dark" ? "切换到浅色" : "切换到深色"}
          aria-label="切换主题"
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          className={`iconrail-btn${activePanel === "settings" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("settings")}
          title={PANEL_TOOLTIP.settings}
          aria-label={PANEL_LABEL.settings}
        >
          <Settings size={16} />
        </button>
      </div>
    </nav>
  );
}
