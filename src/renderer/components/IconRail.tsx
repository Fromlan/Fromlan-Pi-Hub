import { useStore } from "../store";
import { Plus, Users, Plug, LayoutDashboard, Sun, Moon, Settings } from "lucide-react";

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
          className={`iconrail-btn${activePanel === "plugins" ? " iconrail-btn-active" : ""}`}
          onClick={() => setPanel("plugins")}
          title="插件 (Plugins)"
          aria-label="插件面板"
        >
          <Plug size={16} />
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
