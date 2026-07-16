import { useEffect, useState } from "react";
import type { PluginType, PluginItemMeta } from "../../shared/types";

interface Props {
  type: PluginType;
  /** 已有条目表示"编辑"；"new" 表示新建。 */
  target: PluginItemMeta | "new";
  onClose: () => void;
}

/** 校验规则与主进程保持一致（前端先挡，节省一次 IPC）。 */
const NAME_REGEX: Record<PluginType, RegExp> = {
  prompts: /^[a-z0-9][a-z0-9-]*$/,
  skills: /^[a-z0-9][a-z0-9-]*$/,
  extensions: /^[a-z0-9][a-z0-9._-]*$/,
};

const TYPE_LABEL: Record<PluginType, string> = {
  prompts: "Prompt 模板",
  skills: "Skill",
  extensions: "Extension",
};

export function PluginEditor({ type, target, onClose }: Props) {
  const isNew = target === "new";
  const [name, setName] = useState<string>(isNew ? "" : target.name);
  const [body, setBody] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [argumentHint, setArgumentHint] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 加载文件内容
  useEffect(() => {
    // 切换条目时先清空，避免显示上一条的残留内容
    setBody("");
    setDescription("");
    setArgumentHint("");
    setError(null);
    if (isNew) return;
    let alive = true;
    (async () => {
      const r = await window.pluginAPI.read(type, target.name);
      if (!alive) return;
      if ("ok" in r) {
        setError(r.error);
      } else {
        setBody(r.body);
        setDescription(r.meta.frontmatter?.description ?? "");
        setArgumentHint(r.meta.frontmatter?.argumentHint ?? "");
      }
    })();
    return () => {
      alive = false;
    };
  }, [type, target, isNew]);

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirmDelete) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmDelete]);

  const nameValid = NAME_REGEX[type].test(name);

  const save = async () => {
    if (!nameValid) {
      setError("名称不合法（仅小写字母、数字、连字符；extensions 额外允许 . 与 _）");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 编辑现有条目：直接写完整 body（保留原始 frontmatter 顺序/未识别字段）
      if (!isNew) {
        const r = await window.pluginAPI.save(type, name, body);
        if (!r.ok) throw new Error(r.error);
      } else {
        // 新建：根据类型构造 frontmatter + body
        const payload = buildNewBody(type, name, description, argumentHint, body);
        const r = await window.pluginAPI.create(type, name, payload);
        if (!r.ok) throw new Error(r.error);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (isNew) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.pluginAPI.remove(type, name);
      if (!r.ok) throw new Error(r.error);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog plugin-editor" onClick={(e) => e.stopPropagation()}>
        <h2>
          {isNew ? "新建" : "编辑"} {TYPE_LABEL[type]}
        </h2>

        <label>
          名称
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isNew}
            placeholder={isNew ? "例如 review" : undefined}
            autoFocus
          />
          {isNew && !nameValid && name.length > 0 && (
            <span className="plugin-editor-hint plugin-editor-warn">
              需匹配 {NAME_REGEX[type].source}
            </span>
          )}
        </label>

        {isNew && type === "prompts" && (
          <>
            <label>
              描述（用于命令补全提示）
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例如：审查暂存的 git 变更"
              />
            </label>
            <label>
              参数提示（可选）
              <input
                type="text"
                value={argumentHint}
                onChange={(e) => setArgumentHint(e.target.value)}
                placeholder="例如 [scope]"
              />
            </label>
          </>
        )}

        {isNew && type === "skills" && (
          <label>
            描述（决定模型何时加载此 skill）
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如：扫描 PR diff 并生成评审意见"
            />
          </label>
        )}

        <label className="plugin-editor-body">
          正文
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={isNew && (type === "prompts" || type === "skills")}
            placeholder={
              isNew
                ? type === "extensions"
                  ? "TypeScript 代码。留空将生成最小骨架。"
                  : "将自动生成 frontmatter + 占位正文。"
                : "编辑 Markdown / TypeScript 内容..."
            }
            spellCheck={false}
          />
          {isNew && type === "skills" && (
            <span className="plugin-editor-hint">
              新建后默认生成 <code>SKILL.md</code>，包含上述描述作为 frontmatter。
            </span>
          )}
        </label>

        {error && <p className="dialog-error">{error}</p>}

        {confirmDelete ? (
          <div className="plugin-editor-confirm">
            <span>确认删除 <code>{name}</code>？此操作不可撤销。</span>
            <div className="dialog-actions">
              <button className="btn" onClick={() => setConfirmDelete(false)} disabled={busy}>
                取消
              </button>
              <button className="btn btn-danger" onClick={remove} disabled={busy}>
                {busy ? "删除中…" : "确认删除"}
              </button>
            </div>
          </div>
        ) : (
          <div className="dialog-actions">
            {!isNew && (
              <button
                className="btn btn-danger"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                style={{ marginRight: "auto" }}
              >
                删除
              </button>
            )}
            <button className="btn" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={busy || !nameValid || !name}
            >
              {busy ? "保存中…" : isNew ? "创建" : "保存"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** 新建模式：根据类型构造初始文件内容。 */
function buildNewBody(
  type: PluginType,
  name: string,
  description: string,
  argumentHint: string,
  bodyOverride: string
): string {
  if (bodyOverride && type === "extensions") return bodyOverride;

  const frontmatterLines = ["---"];
  if (type === "skills") {
    frontmatterLines.push(`name: "${name}"`);
    frontmatterLines.push(`description: "${description || `${name} skill`}"`);
  } else if (type === "prompts") {
    frontmatterLines.push(`description: "${description || `${name} prompt template`}"`);
    if (argumentHint) frontmatterLines.push(`argument-hint: "${argumentHint}"`);
  }
  frontmatterLines.push("---", "");

  if (type === "extensions") {
    return [
      `import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";`,
      "",
      "export default function (_ctx: ExtensionContext, pi: ExtensionAPI) {",
      `  // 在此实现 ${name} 扩展`,
      "}",
      "",
    ].join("\n");
  }

  const header =
    type === "prompts"
      ? `# ${name}\n\n你的提示正文写在这里。可用 $1, $@, ${"$"}{1:-default} 等变量。\n`
      : `# ${name}\n\n描述此 skill 的工作流步骤。\n`;
  return frontmatterLines.join("\n") + header;
}