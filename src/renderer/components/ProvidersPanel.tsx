import { useEffect, useState } from "react";
import { useStore } from "../store";
import { PANEL_LABEL } from "../../shared/labels";
import type {
  ProviderProfilePublic,
  ProviderProfileUpsertInput,
} from "../../shared/types";

const PRESETS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "openrouter",
  "groq",
  "mistral",
  "xai",
  "minimax",
  "minimax-cn",
  "zai",
  "opencode",
  "custom",
] as const;

type Draft = {
  id?: string;
  name: string;
  providerId: string;
  apiKey: string;
  baseUrl: string;
  notes: string;
  preset: string;
};

const emptyDraft = (): Draft => ({
  name: "",
  providerId: "anthropic",
  apiKey: "",
  baseUrl: "",
  notes: "",
  preset: "anthropic",
});

export function ProvidersPanel() {
  const setNotice = useStore((s) => s.setNotice);
  const setAppSettings = useStore((s) => s.setAppSettings);
  const [profiles, setProfiles] = useState<ProviderProfilePublic[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const r = await window.providerAPI.list();
    setProfiles(r.profiles);
    setActiveId(r.activeProfileId);
  };

  useEffect(() => {
    void refresh();
    return window.providerAPI.onChanged((r) => {
      setProfiles(r.profiles);
      setActiveId(r.activeProfileId);
    });
  }, []);

  const openCreate = () => setEditing(emptyDraft());

  const openEdit = async (p: ProviderProfilePublic) => {
    let apiKey = "";
    if (p.hasKey && p.authType === "api_key") {
      const r = await window.providerAPI.getSecret(p.id);
      if (r.ok) apiKey = r.apiKey;
    }
    const preset = PRESETS.includes(p.providerId as (typeof PRESETS)[number])
      ? p.providerId
      : "custom";
    setEditing({
      id: p.id,
      name: p.name,
      providerId: p.providerId,
      apiKey,
      baseUrl: p.baseUrl ?? "",
      notes: p.notes ?? "",
      preset,
    });
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    const input: ProviderProfileUpsertInput = {
      id: editing.id,
      name: editing.name,
      providerId: editing.providerId,
      authType: "api_key",
      apiKey: editing.apiKey,
      baseUrl: editing.baseUrl || undefined,
      notes: editing.notes || undefined,
    };
    const r = await window.providerAPI.upsert(input);
    setBusy(false);
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    setEditing(null);
    setNotice(editing.id ? "订阅已更新" : "订阅已创建");
    await refresh();
  };

  const activate = async (id: string) => {
    setBusy(true);
    const r = await window.providerAPI.activate(id);
    setBusy(false);
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    const settings = await window.appAPI.getSettings();
    setAppSettings(settings);
    setNotice(
      `已启用「${r.profile.name}」并写入 auth.json（新会话生效；已开会话需重建）`
    );
    await refresh();
  };

  return (
    <div className="providers-panel">
      <header className="providers-header">
        <div>
          <h2>{PANEL_LABEL.providers}</h2>
          <p className="providers-subtitle">
            管理 pi 订阅 Profile；启用时写入 ~/.pi/agent/auth.json
          </p>
        </div>
        <div className="form-actions">
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await window.providerAPI.importFromAuth();
              setBusy(false);
              if (!r.ok) {
                setNotice(r.error);
                return;
              }
              setNotice(
                r.imported > 0
                  ? `已从 auth.json 导入 ${r.imported} 条`
                  : "无可导入条目（或均已存在）"
              );
              await refresh();
            }}
          >
            从 auth.json 导入
          </button>
          <button className="btn btn-primary" type="button" onClick={openCreate}>
            新建订阅
          </button>
        </div>
      </header>

      {profiles.length === 0 ? (
        <p className="providers-empty">
          还没有订阅。可新建，或从现有 ~/.pi/agent/auth.json 导入。
        </p>
      ) : (
        <ul className="providers-list">
          {profiles.map((p) => (
            <li
              key={p.id}
              className={`providers-card${p.active || activeId === p.id ? " is-active" : ""}`}
            >
              <div className="providers-card-main">
                <div className="providers-card-top">
                  <strong className="providers-card-name">{p.name}</strong>
                  {(p.active || activeId === p.id) && (
                    <span className="providers-active-badge">当前启用</span>
                  )}
                  {p.authType === "oauth_placeholder" && (
                    <span className="providers-oauth-badge">OAuth</span>
                  )}
                </div>
                <div className="providers-card-meta">
                  <code>{p.providerId}</code>
                  {p.hasKey ? (
                    <span className="providers-key-mask">{p.keyMask}</span>
                  ) : (
                    <span className="providers-key-mask muted">无 Key</span>
                  )}
                  {p.baseUrl ? (
                    <span className="providers-baseurl" title={p.baseUrl}>
                      {p.baseUrl}
                    </span>
                  ) : null}
                </div>
                {p.notes ? (
                  <p className="providers-notes">{p.notes}</p>
                ) : null}
              </div>
              <div className="providers-card-actions">
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={busy || p.authType === "oauth_placeholder"}
                  onClick={() => activate(p.id)}
                  title={
                    p.authType === "oauth_placeholder"
                      ? "OAuth 请在 pi 中 /login"
                      : "写入 auth.json 并设为默认"
                  }
                >
                  启用
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={busy}
                  onClick={() => openEdit(p)}
                >
                  编辑
                </button>
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm(`删除订阅「${p.name}」？`)) return;
                    const r = await window.providerAPI.delete(p.id);
                    if (!r.ok) setNotice(r.error);
                    else {
                      setNotice("已删除");
                      await refresh();
                    }
                  }}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div
          className="providers-modal-backdrop"
          role="presentation"
          onClick={() => setEditing(null)}
        >
          <div
            className="providers-modal"
            role="dialog"
            aria-labelledby="providers-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="providers-modal-title">
              {editing.id ? "编辑订阅" : "新建订阅"}
            </h3>
            <label className="form-row">
              <span className="form-label">显示名称</span>
              <input
                className="form-input"
                value={editing.name}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
                placeholder="如：工作 Anthropic"
              />
            </label>
            <label className="form-row">
              <span className="form-label">Provider 预设</span>
              <select
                className="form-input"
                value={editing.preset}
                onChange={(e) => {
                  const preset = e.target.value;
                  setEditing({
                    ...editing,
                    preset,
                    providerId:
                      preset === "custom" ? editing.providerId : preset,
                  });
                }}
              >
                {PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span className="form-label">providerId</span>
              <input
                className="form-input"
                value={editing.providerId}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    providerId: e.target.value,
                    preset: "custom",
                  })
                }
                placeholder="写入 auth.json 的键名"
              />
            </label>
            <label className="form-row">
              <span className="form-label">API Key</span>
              <input
                className="form-input"
                type="password"
                autoComplete="off"
                value={editing.apiKey}
                onChange={(e) =>
                  setEditing({ ...editing, apiKey: e.target.value })
                }
                placeholder={
                  editing.id ? "留空则保留原 Key" : "sk-…"
                }
              />
            </label>
            <label className="form-row">
              <span className="form-label">Base URL（可选）</span>
              <input
                className="form-input"
                value={editing.baseUrl}
                onChange={(e) =>
                  setEditing({ ...editing, baseUrl: e.target.value })
                }
                placeholder="自定义网关时写入 models.json"
              />
            </label>
            <label className="form-row">
              <span className="form-label">备注</span>
              <input
                className="form-input"
                value={editing.notes}
                onChange={(e) =>
                  setEditing({ ...editing, notes: e.target.value })
                }
              />
            </label>
            <div className="form-actions">
              <button
                className="btn"
                type="button"
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() => void save()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
