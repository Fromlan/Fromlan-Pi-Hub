import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { PluginType, PluginItemMeta, AgentMeta } from "../../shared/types";
import { AgentFileEditor } from "./AgentFileEditor";

/** 三栏 tabs 的元信息；路径前缀改为 agent 私有目录。 */
const TYPES: { type: PluginType; label: string; hint: (name: string) => string }[] = [
  {
    type: "prompts",
    label: "Prompt 模板",
    hint: (n) => `~/.pi/agents/${n}/prompts/*.md → /<name>`,
  },
  {
    type: "skills",
    label: "Skill",
    hint: (n) => `~/.pi/agents/${n}/skills/<name>/SKILL.md → /skill:<name>`,
  },
  {
    type: "extensions",
    label: "Extension",
    hint: (n) => `~/.pi/agents/${n}/extensions/*.ts（启动时挂载）`,
  },
];

const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export function AgentsPanel() {
  const agents = useStore((s) => s.agents);
  const setAgents = useStore((s) => s.setAgents);
  const upsertAgent = useStore((s) => s.upsertAgent);
  const removeAgent = useStore((s) => s.removeAgent);

  const [activeAgentName, setActiveAgentName] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<PluginType>("prompts");
  const [files, setFiles] = useState<PluginItemMeta[]>([]);
  const [editing, setEditing] = useState<PluginItemMeta | "new" | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirmDeleteAgent, setConfirmDeleteAgent] = useState(false);

  // 首帧拉取 agent 列表，并默认选中第一个
  useEffect(() => {
    let alive = true;
    window.agentAPI
      .list()
      .then((list) => {
        if (!alive) return;
        setAgents(list);
        if (list.length > 0 && !activeAgentName) {
          setActiveAgentName(list[0].name);
        }
      })
      .catch((e) => {
        console.error("[renderer] agent list failed:", e);
      });
    return () => {
      alive = false;
    };
    // 仅首帧；activeAgentName 的初始置空在 cleanup 之后不影响
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 订阅 agent 变更：增删 agent 时同步列表与选中态；文件级改动时按需刷新
  useEffect(() => {
    return window.agentAPI.onChanged(async (p) => {
      if (p.action === "created" || p.action === "deleted") {
        const list = await window.agentAPI.list();
        setAgents(list);
        if (p.action === "deleted" && activeAgentName === p.name) {
          setActiveAgentName(list[0]?.name ?? null);
          setFiles([]);
        }
        return;
      }
      // 文件级事件：刷新当前 agent 当前类型列表
      if (activeAgentName && p.name === activeAgentName && p.type === activeType) {
        try {
          const items = await window.agentAPI.fileList(activeAgentName, activeType);
          setFiles(items);
        } catch {
          // 忽略：UI 仍可手动刷新
        }
      }
    });
  }, [activeAgentName, activeType, setAgents]);

  // 切换 agent 或类型时重新拉文件列表
  useEffect(() => {
    if (!activeAgentName) {
      setFiles([]);
      return;
    }
    let alive = true;
    setFileError(null);
    window.agentAPI
      .fileList(activeAgentName, activeType)
      .then((items) => {
        if (alive) setFiles(items);
      })
      .catch((e) => {
        if (alive) setFileError(`列表加载失败：${(e as Error).message}`);
      });
    return () => {
      alive = false;
    };
  }, [activeAgentName, activeType]);

  const refresh = async () => {
    if (!activeAgentName) return;
    try {
      const items = await window.agentAPI.fileList(activeAgentName, activeType);
      setFiles(items);
    } catch (e) {
      setFileError(`刷新失败：${(e as Error).message}`);
    }
  };

  const createAgent = async () => {
    setCreateError(null);
    const trimmed = newName.trim();
    if (!trimmed) {
      setCreateError("名称不能为空");
      return;
    }
    if (!AGENT_NAME_REGEX.test(trimmed) || trimmed.length > 32) {
      setCreateError("名称需匹配 ^[a-z0-9][a-z0-9-]*$ 且 ≤32 字符");
      return;
    }
    setBusy(true);
    try {
      const r = await window.agentAPI.create(trimmed, newDesc.trim() || undefined);
      if (!r.ok) {
        setCreateError(r.error);
        return;
      }
      const meta: AgentMeta = r.meta;
      upsertAgent(meta);
      setActiveAgentName(meta.name);
      setCreating(false);
      setNewName("");
      setNewDesc("");
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteAgent = async () => {
    if (!activeAgentName) return;
    setBusy(true);
    try {
      const r = await window.agentAPI.remove(activeAgentName);
      if (!r.ok) {
        setFileError(`删除失败：${r.error}`);
        return;
      }
      removeAgent(activeAgentName);
      setConfirmDeleteAgent(false);
      // 选中态与列表交给 onChanged 回调更新
    } finally {
      setBusy(false);
    }
  };

  const activeMeta = TYPES.find((t) => t.type === activeType)!;
  const activeAgent = agents.find((a) => a.name === activeAgentName) ?? null;

  return (
    <div className="agents-panel">
      <aside className="agents-sidebar">
        <div className="agents-sidebar-header">
          <span className="agents-sidebar-title">Agent</span>
          <button
            className="btn btn-primary agents-sidebar-new"
            onClick={() => {
              setCreating(true);
              setCreateError(null);
            }}
            title="新建 Agent"
          >
            ＋
          </button>
        </div>
        <div className="agents-sidebar-list">
          {agents.length === 0 ? (
            <div className="agents-sidebar-empty">
              还没有 agent。点击右上角 ＋ 新建。
            </div>
          ) : (
            agents.map((a) => (
              <button
                key={a.name}
                className={`agents-sidebar-item ${a.name === activeAgentName ? "agents-sidebar-item-active" : ""}`}
                onClick={() => setActiveAgentName(a.name)}
                title={a.description ?? a.name}
              >
                <span className="agents-sidebar-item-name">{a.name}</span>
                {a.description && (
                  <span className="agents-sidebar-item-desc">{a.description}</span>
                )}
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="agents-content">
        {!activeAgent ? (
          <div className="empty-state">
            <p>先在左侧选择一个 agent，或点击右上角 ＋ 新建。</p>
          </div>
        ) : (
          <>
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
                  disabled={!activeAgent}
                >
                  ＋ 新建
                </button>
              </div>
            </header>

            <div className="plugins-hint">{activeMeta.hint(activeAgent.name)}</div>

            {fileError && <div className="plugins-error">{fileError}</div>}

            <div className="plugin-list">
              {files.length === 0 ? (
                <div className="plugin-list-empty">
                  还没有 {activeMeta.label}。点击右上角"新建"开始。
                </div>
              ) : (
                files.map((item) => (
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

            <footer className="agents-footer">
              {confirmDeleteAgent ? (
                <div className="plugin-editor-confirm" style={{ width: "100%" }}>
                  <span>
                    确认删除 agent <code>{activeAgent.name}</code>？目录下所有 prompts / skills / extensions 一并删除，且不可撤销。
                  </span>
                  <div className="dialog-actions">
                    <button
                      className="btn"
                      onClick={() => setConfirmDeleteAgent(false)}
                      disabled={busy}
                    >
                      取消
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={deleteAgent}
                      disabled={busy}
                    >
                      {busy ? "删除中…" : "确认删除"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn btn-danger"
                  onClick={() => setConfirmDeleteAgent(true)}
                  disabled={!activeAgent}
                >
                  删除此 Agent
                </button>
              )}
            </footer>
          </>
        )}

        {creating && (
          <div className="dialog-overlay" onClick={() => !busy && setCreating(false)}>
            <div className="dialog" onClick={(e) => e.stopPropagation()}>
              <h2>新建 Agent</h2>
              <p className="dialog-hint">
                agent 拥有独立的 prompts/skills/extensions，启动会话时选择该 agent
                将完全看不到全局 ~/.pi/agent/ 下的内容。
              </p>
              <label>
                名称
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如 frontend-bot"
                  autoFocus
                />
                {newName.length > 0 && !AGENT_NAME_REGEX.test(newName) && (
                  <span className="plugin-editor-hint plugin-editor-warn">
                    需匹配 ^[a-z0-9][a-z0-9-]*$
                  </span>
                )}
              </label>
              <label>
                描述（可选）
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="例如：负责 React 组件的代码生成"
                />
              </label>
              {createError && <p className="dialog-error">{createError}</p>}
              <div className="dialog-actions">
                <button className="btn" onClick={() => setCreating(false)} disabled={busy}>
                  取消
                </button>
                <button
                  className="btn btn-primary"
                  onClick={createAgent}
                  disabled={busy || !newName.trim()}
                >
                  {busy ? "创建中…" : "创建"}
                </button>
              </div>
            </div>
          </div>
        )}

        {editing && activeAgent && (
          <AgentFileEditor
            agentName={activeAgent.name}
            type={activeType}
            target={editing}
            onClose={() => setEditing(null)}
          />
        )}
      </section>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}