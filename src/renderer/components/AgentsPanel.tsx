import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "../store";
import type { PluginType, PluginItemMeta, AgentMeta } from "../../shared/types";
import { PANEL_LABEL } from "../../shared/labels";
import { AgentFileEditor } from "./AgentFileEditor";
import { AgentIdentityEditor } from "./AgentIdentityEditor";
import { formatBytes } from "../../shared/utils";

type AgentTab = "identity" | PluginType;

/** 身份 + 三栏插件 tabs；路径前缀为 agent 私有目录。 */
const TABS: {
  id: AgentTab;
  label: string;
  hint: (name: string) => string;
}[] = [
  {
    id: "identity",
    label: "身份",
    hint: (n) => `~/.pi/agents/${n}/IDENTITY.md → --append-system-prompt`,
  },
  {
    id: "prompts",
    label: "Prompt 模板",
    hint: (n) => `~/.pi/agents/${n}/prompts/*.md → /<name>`,
  },
  {
    id: "skills",
    label: "Skill",
    hint: (n) => `~/.pi/agents/${n}/skills/<name>/SKILL.md → /skill:<name>`,
  },
  {
    id: "extensions",
    label: "Extension",
    hint: (n) => `~/.pi/agents/${n}/extensions/*.ts（启动时挂载）`,
  },
];

const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

function emptyStateForTab(tab: AgentTab, label: string): string {
  if (tab === "prompts") {
    return "还没有 Prompt 模板（会话内 /name）。系统提示词请到「身份」页签编辑。";
  }
  return `还没有 ${label}。点击右上角"新建"开始。`;
}

export function AgentsPanel() {
  const agents = useStore((s) => s.agents);
  const setAgents = useStore((s) => s.setAgents);
  const upsertAgent = useStore((s) => s.upsertAgent);
  const removeAgent = useStore((s) => s.removeAgent);

  const [activeAgentName, setActiveAgentName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AgentTab>("identity");
  const [files, setFiles] = useState<PluginItemMeta[]>([]);
  const [editing, setEditing] = useState<PluginItemMeta | "new" | null>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newIdentity, setNewIdentity] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirmDeleteAgent, setConfirmDeleteAgent] = useState(false);

  const [descDraft, setDescDraft] = useState("");
  const [descBusy, setDescBusy] = useState(false);
  const [descError, setDescError] = useState<string | null>(null);

  const activeType: PluginType | null =
    activeTab === "identity" ? null : activeTab;

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

  // 订阅 agent 变更：增删 / 元数据更新时同步列表；文件级改动时按需刷新
  useEffect(() => {
    return window.agentAPI.onChanged(async (p) => {
      if (
        p.action === "created" ||
        p.action === "deleted" ||
        p.action === "updated"
      ) {
        const list = await window.agentAPI.list();
        setAgents(list);
        if (p.action === "deleted" && activeAgentName === p.name) {
          setActiveAgentName(list[0]?.name ?? null);
          setFiles([]);
        }
        return;
      }
      // 文件级事件：刷新当前 agent 当前类型列表
      if (
        activeAgentName &&
        p.name === activeAgentName &&
        activeType &&
        p.type === activeType
      ) {
        try {
          const items = await window.agentAPI.fileList(activeAgentName, activeType);
          setFiles(items);
        } catch {
          // 忽略：UI 仍可手动刷新
        }
      }
    });
  }, [activeAgentName, activeType, setAgents]);

  // 切换 agent 或插件类型时重新拉文件列表
  useEffect(() => {
    if (!activeAgentName || !activeType) {
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

  // 切换选中 agent 时同步 description 草稿
  useEffect(() => {
    const a = agents.find((x) => x.name === activeAgentName);
    setDescDraft(a?.description ?? "");
    setDescError(null);
  }, [activeAgentName, agents]);

  const refresh = async () => {
    if (!activeAgentName || !activeType) return;
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
      const identity = newIdentity.trim() || undefined;
      const r = await window.agentAPI.create(
        trimmed,
        newDesc.trim() || undefined,
        identity
      );
      if (!r.ok) {
        setCreateError(r.error);
        return;
      }
      const meta: AgentMeta = r.meta;
      upsertAgent(meta);
      setActiveAgentName(meta.name);
      setActiveTab("identity");
      setCreating(false);
      setNewName("");
      setNewDesc("");
      setNewIdentity("");
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveDescription = async () => {
    if (!activeAgentName) return;
    const current = agents.find((a) => a.name === activeAgentName);
    const next = descDraft.trim();
    const prev = (current?.description ?? "").trim();
    if (next === prev) return;
    setDescBusy(true);
    setDescError(null);
    try {
      const r = await window.agentAPI.update(activeAgentName, {
        description: next,
      });
      if (!r.ok) throw new Error(r.error);
      upsertAgent(r.meta);
    } catch (e) {
      setDescError((e as Error).message);
    } finally {
      setDescBusy(false);
    }
  };

  const deleteAgent = async () => {
    if (!activeAgentName) return;
    setBusy(true);
    try {
      const r = await window.agentAPI.delete(activeAgentName);
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

  const activeMeta = TABS.find((t) => t.id === activeTab)!;
  const activeAgent = agents.find((a) => a.name === activeAgentName) ?? null;
  const descDirty =
    descDraft.trim() !== (activeAgent?.description ?? "").trim();

  return (
    <div className="agents-panel">
      <aside className="agents-sidebar">
        <div className="agents-sidebar-header">
          <span className="agents-sidebar-title">{PANEL_LABEL.agents}</span>
          <button
            className="btn btn-primary agents-sidebar-new"
            onClick={() => {
              setCreating(true);
              setCreateError(null);
            }}
            title="新建代理"
            aria-label="新建代理"
          >
            <Plus size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="agents-sidebar-list">
          {agents.length === 0 ? (
            <div className="agents-sidebar-empty">
              还没有代理。点击右上角 ＋ 新建。
            </div>
          ) : (
            agents.map((a) => (
              <button
                key={a.name}
                className={`agents-sidebar-item ${a.name === activeAgentName ? "agents-sidebar-item-active" : ""}`}
                onClick={() => {
                  setActiveAgentName(a.name);
                  setActiveTab("identity");
                  setEditing(null);
                }}
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
            <div className="agents-meta">
              <div className="agents-meta-top">
                <h2 className="agents-meta-name">{activeAgent.name}</h2>
              </div>
              <label className="agents-meta-desc">
                <span className="form-label">描述</span>
                <div className="agents-meta-desc-row">
                  <input
                    type="text"
                    className="form-input"
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    placeholder="简短说明这个 agent 的用途"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveDescription();
                      }
                    }}
                  />
                  <button
                    className={`btn ${descDirty ? "btn-primary" : "btn-ghost"}`}
                    onClick={saveDescription}
                    disabled={descBusy || !descDirty}
                  >
                    {descBusy ? "…" : "保存"}
                  </button>
                </div>
              </label>
              {descError && <div className="plugins-error">{descError}</div>}
            </div>

            <header className="plugins-header">
              <div className="plugins-tabs">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    className={`plugins-tab ${activeTab === t.id ? "plugins-tab-active" : ""}`}
                    onClick={() => {
                      setActiveTab(t.id);
                      setEditing(null);
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="plugins-header-right">
                {activeTab !== "identity" && (
                  <>
                    <button
                      className="btn btn-ghost"
                      onClick={refresh}
                      title="重新读取目录"
                    >
                      刷新
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => setEditing("new")}
                      disabled={!activeAgent}
                    >
                      <Plus size={14} strokeWidth={2} aria-hidden />
                      新建
                    </button>
                  </>
                )}
              </div>
            </header>

            <div className="plugins-hint">{activeMeta.hint(activeAgent.name)}</div>

            {fileError && <div className="plugins-error">{fileError}</div>}

            {activeTab === "identity" ? (
              <AgentIdentityEditor
                key={activeAgent.name}
                agentName={activeAgent.name}
              />
            ) : (
              <div className="plugin-list">
                {files.length === 0 ? (
                  <div className="plugin-list-empty">
                    {emptyStateForTab(activeTab, activeMeta.label)}
                  </div>
                ) : (
                  files.map((item) => (
                    <button
                      key={`${activeTab}:${item.name}`}
                      className="plugin-item"
                      onClick={() => setEditing(item)}
                      title={item.relPath}
                    >
                      <div className="plugin-item-main">
                        <span className="plugin-item-name">
                          {item.isSymlink && (
                            <span className="plugin-item-symlink">↪</span>
                          )}{" "}
                          {item.name}
                        </span>
                        {item.frontmatter?.description && (
                          <span className="plugin-item-desc">
                            {item.frontmatter.description}
                          </span>
                        )}
                      </div>
                      <div className="plugin-item-meta">
                        {formatBytes(item.size)} ·{" "}
                        {new Date(item.mtime).toLocaleString()}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            <footer className="agents-footer">
              {confirmDeleteAgent ? (
                <div className="plugin-editor-confirm" style={{ width: "100%" }}>
                  <span>
                    确认删除 agent <code>{activeAgent.name}</code>？目录下
                    IDENTITY.md 与所有 prompts / skills / extensions
                    一并删除，且不可撤销。
                  </span>
                  <div className="dialog-actions">
                    <button
                      className="btn btn-secondary"
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
                  删除此代理
                </button>
              )}
            </footer>
          </>
        )}

        {creating && (
          <div className="dialog-overlay" onClick={() => !busy && setCreating(false)}>
            <div className="dialog agents-create-dialog" onClick={(e) => e.stopPropagation()}>
              <h2>新建代理</h2>
              <p className="dialog-hint">
                agent 拥有独立的身份（IDENTITY.md）与 prompts / skills /
                extensions；启动会话时选择该 agent 将完全看不到全局{" "}
                <code>~/.pi/agent/</code> 下的内容。
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
              <label>
                初始身份 / 系统提示（可选）
                <textarea
                  className="form-input"
                  value={newIdentity}
                  onChange={(e) => setNewIdentity(e.target.value)}
                  rows={8}
                  placeholder="写入 IDENTITY.md；留空则稍后在「身份」页签编辑"
                  spellCheck={false}
                />
              </label>
              {createError && <p className="dialog-error">{createError}</p>}
              <div className="dialog-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => setCreating(false)}
                  disabled={busy}
                >
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

        {editing && activeAgent && activeType && (
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
