import { useEffect, useState } from "react";
import { useStore } from "../store";
import {
  Plus,
  Users,
  Plug,
  LayoutDashboard,
  Sun,
  Moon,
  Settings,
  Network,
  Timer,
  Inbox,
} from "lucide-react";

interface Props {
  onNew: () => void;
}

export function IconRail({ onNew }: Props) {
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
      <div className="iconrail-top">
        <button
          className="iconrail-btn iconrail-btn-accent"
          onClick={onNew}
          title="新建会话"
          aria-label="新建会话"
        >
          <Plus size={18} />
        </button>
      </div>

      <div className="iconrail-mid">
        <button
          className={`iconrail-btn${isKanban ? " iconrail-btn-active" : ""}`}
          onClick={() => setViewMode("kanban")}
          title="看板 (Kanban)"
          aria-label="看板"
        >
          <LayoutDashboard size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "agents" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("agents")}
          title="代理 (Agents)"
          aria-label="代理面板"
        >
          <Users size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "squads" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("squads")}
          title="Squads"
          aria-label="Squads"
        >
          <Network size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "plugins" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("plugins")}
          title="插件 (Plugins)"
          aria-label="插件面板"
        >
          <Plug size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "autopilots" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("autopilots")}
          title="Autopilots"
          aria-label="Autopilots"
        >
          <Timer size={16} />
        </button>
        <button
          className={`iconrail-btn${activePanel === "inbox" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("inbox")}
          title="Inbox"
          aria-label="Inbox"
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
          title="设置"
          aria-label="设置"
        >
          <Settings size={16} />
        </button>
      </div>
    </nav>
  );
}
