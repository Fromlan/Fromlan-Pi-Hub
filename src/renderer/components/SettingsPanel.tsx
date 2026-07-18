import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { useStore } from "../store";
import type { AppSettings, ModelInfo } from "../../shared/types";

export function SettingsPanel() {
  const appSettings = useStore((s) => s.appSettings);
  const setAppSettings = useStore((s) => s.setAppSettings);
  const setNotice = useStore((s) => s.setNotice);
  const [draft, setDraft] = useState<AppSettings>(appSettings);
  const [models, setModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    setDraft(appSettings);
  }, [appSettings]);

  useEffect(() => {
    window.appAPI.getModels().then(setModels);
  }, []);

  const providers = [...new Set(models.map((m) => m.provider))];
  const providerModels = models.filter(
    (m) => m.provider === draft.defaultProvider
  );

  const save = async () => {
    const r = await window.appAPI.updateSettings(draft);
    if (r.ok) {
      setAppSettings(r.settings);
      setNotice("设置已保存");
    } else {
      setNotice(r.error);
    }
  };

  return (
    <div className="settings-panel">
      <header className="settings-header">
        <h2>设置</h2>
        <p className="settings-subtitle">Fromlan Pi Hub 的偏好配置</p>
      </header>

      <section className="settings-section">
        <h3>外观</h3>
        <div className="settings-row">
          <div className="settings-row-label">
            <span className="settings-row-title">主题</span>
            <span className="settings-row-hint">切换深色 / 浅色界面</span>
          </div>
          <ThemeToggle />
        </div>
      </section>

      <section className="settings-section">
        <h3>默认派活</h3>
        <p className="settings-row-hint">
          Assign / Autopilot 未指定模型时使用这些默认值。
        </p>
        <label className="form-row">
          <span className="form-label">Provider</span>
          <select
            className="form-input"
            value={draft.defaultProvider}
            onChange={(e) =>
              setDraft({
                ...draft,
                defaultProvider: e.target.value,
                defaultModel: "",
              })
            }
          >
            <option value="">— 自动选择 —</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="form-row">
          <span className="form-label">Model</span>
          <select
            className="form-input"
            value={draft.defaultModel}
            onChange={(e) =>
              setDraft({ ...draft, defaultModel: e.target.value })
            }
          >
            <option value="">— 自动选择 —</option>
            {providerModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id}
              </option>
            ))}
          </select>
        </label>
        <label className="form-row">
          <span className="form-label">默认工作目录</span>
          <div className="form-row-inline">
            <input
              className="form-input"
              value={draft.defaultCwd}
              onChange={(e) =>
                setDraft({ ...draft, defaultCwd: e.target.value })
              }
            />
            <button
              className="btn"
              type="button"
              onClick={async () => {
                const p = await window.appAPI.pickDirectory();
                if (p) setDraft({ ...draft, defaultCwd: p });
              }}
            >
              浏览…
            </button>
          </div>
        </label>
      </section>

      <section className="settings-section">
        <h3>任务可靠性</h3>
        <label className="form-row">
          <span className="form-label">派活超时（分钟）</span>
          <input
            className="form-input"
            type="number"
            min={1}
            value={Math.round(draft.dispatchTimeoutMs / 60000)}
            onChange={(e) =>
              setDraft({
                ...draft,
                dispatchTimeoutMs: Math.max(1, Number(e.target.value)) * 60000,
              })
            }
          />
        </label>
        <label className="form-row">
          <span className="form-label">执行超时（小时）</span>
          <input
            className="form-input"
            type="number"
            min={0.5}
            step={0.5}
            value={draft.runningTimeoutMs / 3600000}
            onChange={(e) =>
              setDraft({
                ...draft,
                runningTimeoutMs: Math.max(0.5, Number(e.target.value)) * 3600000,
              })
            }
          />
        </label>
        <label className="form-row">
          <span className="form-label">最大尝试次数（含首次）</span>
          <input
            className="form-input"
            type="number"
            min={1}
            max={5}
            value={draft.maxRetries}
            onChange={(e) =>
              setDraft({
                ...draft,
                maxRetries: Math.max(1, Math.floor(Number(e.target.value))),
              })
            }
          />
        </label>
      </section>

      <section className="settings-section">
        <h3>通知</h3>
        <label className="form-row">
          <span className="form-label">桌面通知</span>
          <select
            className="form-input"
            value={draft.notifyMode}
            onChange={(e) =>
              setDraft({
                ...draft,
                notifyMode: e.target.value as AppSettings["notifyMode"],
              })
            }
          >
            <option value="background">仅后台</option>
            <option value="always">始终</option>
            <option value="off">关闭</option>
          </select>
        </label>
      </section>

      <div className="form-actions">
        <button className="btn btn-primary" onClick={save}>
          保存设置
        </button>
      </div>

      <section className="settings-section">
        <h3>关于</h3>
        <p className="settings-about">
          Fromlan Pi Hub —— 本地 pi Agent 工位台。Kanban 派活、Squad 路由、Autopilot
          调度；API 密钥由 pi 自身管理。
        </p>
      </section>
    </div>
  );
}
