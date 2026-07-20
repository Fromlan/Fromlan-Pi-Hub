import { useEffect, useState } from "react";
import { FileText, Save } from "lucide-react";

interface Props {
  agentName: string;
}

/**
 * 对齐 Multica InstructionsTab：编辑 agent 根目录 IDENTITY.md
 * （运行时经 --append-system-prompt 注入）。
 */
export function AgentIdentityEditor({ agentName }: Props) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const isDirty = value !== saved;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setSavedFlash(false);
    (async () => {
      const r = await window.agentAPI.identityRead(agentName);
      if (!alive) return;
      if ("ok" in r) {
        setError(r.error);
        setValue("");
        setSaved("");
        setExists(false);
      } else {
        setValue(r.body);
        setSaved(r.body);
        setExists(r.exists);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [agentName]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await window.agentAPI.identitySave(agentName, value);
      if (!r.ok) throw new Error(r.error);
      setSaved(value);
      setExists(true);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="agent-identity-loading">加载身份文案…</div>;
  }

  return (
    <div className="agent-identity-editor">
      <div className="agent-identity-card">
        <div className="agent-identity-card-head">
          <FileText size={14} strokeWidth={2} aria-hidden />
          <div className="agent-identity-card-titles">
            <span className="agent-identity-card-title">系统提示</span>
            <span className="agent-identity-card-sub">IDENTITY.md</span>
          </div>
          {!exists && (
            <span className="agent-identity-badge">未创建</span>
          )}
          {exists && isDirty && (
            <span className="agent-identity-badge agent-identity-badge-warn">
              未保存
            </span>
          )}
        </div>

        <p className="agent-identity-intro">
          会话绑定本 agent 时经 <code>--append-system-prompt</code>{" "}
          注入。与 Prompt 模板（会话内 <code>/name</code>）不同。
        </p>

        {!exists && !isDirty && (
          <p className="agent-identity-empty-hint">
            编辑下方文本并保存即可创建 IDENTITY.md。
          </p>
        )}

        <textarea
          className="form-input agent-identity-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={18}
          placeholder="描述这个 agent 是谁、能做什么、语气与约束…"
          spellCheck={false}
          aria-label="系统提示 / IDENTITY.md"
        />

        {error && <div className="plugins-error">{error}</div>}

        <div className="agent-identity-actions">
          {savedFlash && !isDirty && (
            <span className="agent-identity-saved">已保存</span>
          )}
          {isDirty && (
            <span className="agent-identity-dirty">有未保存更改</span>
          )}
          <button
            className="btn btn-primary agent-identity-save"
            onClick={save}
            disabled={saving || !isDirty}
          >
            <Save size={14} strokeWidth={2} aria-hidden />
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
