import type { PluginType } from "./types";

/** 字节数人类可读。 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 文件名校验：与主进程 plugin-manager.ts / agent-manager.ts 保持一致。 */
export const NAME_REGEX: Record<PluginType, RegExp> = {
  prompts: /^[a-z0-9][a-z0-9-]*$/,
  skills: /^[a-z0-9][a-z0-9-]*$/,
  extensions: /^[a-z0-9][a-z0-9._-]*$/,
};

export const PLUGIN_TYPE_LABEL: Record<PluginType, string> = {
  prompts: "Prompt 模板",
  skills: "Skill",
  extensions: "Extension",
};

/** 新建模式：根据类型构造初始文件内容。 */
export function buildNewBody(
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