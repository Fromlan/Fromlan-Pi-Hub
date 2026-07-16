import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useShallow } from "zustand/react/shallow";
import type { PluginType, PluginItemMeta } from "../../shared/types";
import { PluginEditor } from "./PluginEditor";

/** 顶部类型切换 tabs 的元信息。 */
const TYPES: { type: PluginType; label: string; hint: string }[] = [
  {
    type: "prompts",
    label: "Prompt 模板",
    hint: "~/.pi/agent/prompts/*.md → /<name>",
  },
  {
    type: "skills",
    label: "Skill",
    hint: "~/.pi/agent/skills/<name>/SKILL.md → /skill:<name>",
  },
  {
    type: "extensions",
    label: "Extension",
    hint: "~/.pi/agent/extensions/*.ts（启动时挂载）",
  },
];

export function PluginsPanel() {
  const [activeType, setActiveType] = useState<PluginType>("prompts");
  const list = useStore((s) => s.plugins[activeType]);
  const setPlugins = useStore((s) => s.setPlugins);
  const lastNotice = useStore((s) => s.lastNotice);
  const setNotice = useStore((s) => s.setNotice);
  // 订阅全部计数以驱动 tabs 上的 badge 更新
  const counts = useStore(useShallow((s) => ({
    prompts: s.plugins.prompts.length,
    skills: s.plugins.skills.length,
    extensions: s.plugins.extensions.length,
  })));
  const [editing, setEditing] = useState<PluginItemMeta | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 拉取当前类型列表
  useEffect(() => {
    let alive = true;
    setError(null);
    window.pluginAPI
      .list(activeType)
      .then((items) => {
        if (alive) setPlugins(activeType, items);
      })
      .catch((e) => {
        if (alive) setError(`列表加载失败：${(e as Error).message}`);
      });
    return () => {
      alive = false;
    };
  }, [activeType, setPlugins]);

  // 订阅主进程变更事件：命中当前类型时刷新列表；命中 saved/created 时显示提示（不论类型）
  useEffect(() => {
    return window.pluginAPI.onChanged(async (p) => {
      if (p.type === activeType) {
        try {
          const items = await window.pluginAPI.list(activeType);
          setPlugins(activeType, items);
        } catch {
          // 忽略：UI 仍可手动刷新
        }
      }
      if (p.action === "saved" || p.action === "created") {
        setNotice("已保存。在任意 Pi 会话中执行 /reload 以应用更改。");
      }
    });
  }, [activeType, setPlugins, setNotice]);

  // 顶部 notice 3 秒后自动消失
  useEffect(() => {
    if (!lastNotice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [lastNotice, setNotice]);

  const refresh = async () => {
    try {
      const items = await window.pluginAPI.list(activeType);
      setPlugins(activeType, items);
    } catch (e) {
      setError(`刷新失败：${(e as Error).message}`);
    }
  };

  const activeMeta = TYPES.find((t) => t.type === activeType)!;

  return (
    <div className="plugins-panel">
      <header className="plugins-header">
        <div className="plugins-tabs">
          {TYPES.map((t) => (
            <button
              key={t.type}
              className={`plugins-tab ${activeType === t.type ? "plugins-tab-active" : ""}`}
              onClick={() => {
                setActiveType(t.type);
                setEditing(null);
              }}
            >
              {t.label}
              <span className="plugins-tab-count">{counts[t.type]}</span>
            </button>
          ))}
        </div>
        <div className="plugins-header-right">
          <button className="btn" onClick={refresh} title="重新读取目录">
            刷新
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setEditing("new")}
          >
            ＋ 新建
          </button>
        </div>
      </header>

      <div className="plugins-hint">{activeMeta.hint}</div>

      {lastNotice && <div className="plugins-notice">{lastNotice}</div>}
      {error && <div className="plugins-error">{error}</div>}

      <div className="plugin-list">
        {list.length === 0 ? (
          <div className="plugin-list-empty">还没有 {activeMeta.label}。点击右上角"新建"开始。</div>
        ) : (
          list.map((item) => (
            <button
              key={`${activeType}:${item.name}`}
              className="plugin-item"
              onClick={() => setEditing(item)}
              title={item.relPath}
            >
              <div className="plugin-item-main">
                <span className="plugin-item-name">
                  {item.isSymlink && <span className="plugin-item-symlink">↪</span>} {item.name}
                </span>
                {item.frontmatter?.description && (
                  <span className="plugin-item-desc">{item.frontmatter.description}</span>
                )}
              </div>
              <div className="plugin-item-meta">
                {formatBytes(item.size)} · {new Date(item.mtime).toLocaleString()}
              </div>
            </button>
          ))
        )}
      </div>

      {editing && (
        <PluginEditor
          type={activeType}
          target={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}