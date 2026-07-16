import { promises as fsp, lstatSync, readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from "fs";
import { join, sep } from "path";
import { homedir } from "os";
import type { PluginType, PluginItemMeta, PluginFile } from "../shared/types";

/**
 * 管理 ~/.pi/agent/{prompts,skills,extensions}/ 下的插件文件。
 *
 * 安全边界：
 * - 路径严格收敛到 ~/.pi/agent/<type>/ 三个白名单目录；
 * - 名称正则校验，挡掉 ../、/、空字符串；
 * - 软链接写入 = 跟随到目标（用户预期行为），软链接删除只 unlink 链接本身。
 */

const ROOT = join(homedir(), ".pi", "agent");

/** 各类型目录对应的扩展名（写入时强制）。 */
const EXT_BY_TYPE: Record<PluginType, string> = {
  prompts: ".md",
  skills: "", // skills 是目录，无扩展名
  extensions: ".ts",
};

/** 名称正则。prompts/skills 用 SKILL 规范的连字符式；extensions 允许 . 与 _。 */
const NAME_REGEX: Record<PluginType, RegExp> = {
  prompts: /^[a-z0-9][a-z0-9-]*$/,
  skills: /^[a-z0-9][a-z0-9-]*$/,
  extensions: /^[a-z0-9][a-z0-9._-]*$/,
};

function typeDir(type: PluginType): string {
  return join(ROOT, type);
}

/** 解析 name -> 绝对路径（含扩展名）。skill 指向目录，其他指向文件。 */
function resolvePath(type: PluginType, name: string): string {
  if (type === "skills") return join(typeDir(type), name);
  return join(typeDir(type), `${name}${EXT_BY_TYPE[type]}`);
}

function validateName(type: PluginType, name: string): string | null {
  if (!name || typeof name !== "string") return "名称不能为空";
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return "名称包含非法字符";
  }
  if (!NAME_REGEX[type].test(name)) {
    return `名称需匹配 ${NAME_REGEX[type].source}`;
  }
  if (name.length > 64) return "名称过长（>64）";
  return null;
}

/**
 * 安全检查：resolved 路径必须仍在 ROOT/<type>/ 子树下，且不存在 .. 穿越。
 * 失败抛出 Error（带可读信息）。
 */
function ensureSafePath(type: PluginType, resolved: string): void {
  const base = typeDir(type) + sep;
  const normalized = resolved.replace(/\\/g, sep);
  if (!normalized.startsWith(base)) {
    throw new Error(`拒绝访问：路径超出白名单 (${base})`);
  }
}

/** 顶层 frontmatter 块：仅解析第一个 `---\n...\n---\n`。 */
function parseFrontmatter(body: string): { raw: string | null; fields: PluginItemMeta["frontmatter"] } {
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { raw: null, fields: undefined };
  const inner = m[1];
  const fields: NonNullable<PluginItemMeta["frontmatter"]> = {};
  for (const line of inner.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    // 去掉首尾引号
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === "description") fields.description = val;
    else if (key === "name") fields.name = val;
    else if (key === "argument-hint") fields.argumentHint = val;
  }
  return { raw: m[0], fields };
}

/** 把 fields 序列化成 YAML frontmatter 块（不含末尾正文）。 */
function serializeFrontmatter(fields: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    const safe = v.replace(/"/g, '\\"');
    lines.push(`${k}: "${safe}"`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

/** lstat 同步取值（list 路径频繁，异步开销不值得）。 */
function lstatSafe(p: string): { isDirectory: boolean; isSymbolicLink: boolean; size: number; mtime: number } | null {
  try {
    const s = lstatSync(p);
    return {
      isDirectory: s.isDirectory(),
      isSymbolicLink: s.isSymbolicLink(),
      size: s.size,
      mtime: s.mtimeMs,
    };
  } catch {
    return null;
  }
}

// ── 对外 API ───────────────────────────────────────────

export async function list(type: PluginType): Promise<PluginItemMeta[]> {
  const dir = typeDir(type);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const items: PluginItemMeta[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue; // 跳过 .DS_Store 等
    // 扩展名过滤
    if (type !== "skills" && !name.endsWith(EXT_BY_TYPE[type])) continue;
    const itemName = type === "skills" ? name : name.slice(0, -EXT_BY_TYPE[type].length);
    const abs = resolvePath(type, itemName);
    const stat = lstatSafe(abs);
    if (!stat) continue;
    // skills 必须是目录；extensions/prompts 必须是文件
    if (type === "skills" && !stat.isDirectory && !stat.isSymbolicLink) continue;
    if (type !== "skills" && stat.isDirectory) continue;

    let frontmatter: PluginItemMeta["frontmatter"];
    let size = stat.size;
    try {
      if (type === "skills") {
        const skillPath = join(abs, "SKILL.md");
        if (existsSync(skillPath)) {
          const text = readFileSync(skillPath, "utf8");
          frontmatter = parseFrontmatter(text).fields;
          size += text.length;
        }
      } else {
        const text = readFileSync(abs, "utf8");
        frontmatter = parseFrontmatter(text).fields;
      }
    } catch {
      // 解析失败不阻塞列表
    }

    items.push({
      name: itemName,
      relPath: type === "skills" ? join(type, itemName) : join(type, name),
      size,
      mtime: stat.mtime,
      isSymlink: stat.isSymbolicLink,
      frontmatter,
    });
  }
  // 名称排序（忽略大小写）
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

export function read(type: PluginType, name: string): PluginFile {
  const v = validateName(type, name);
  if (v) throw new Error(v);
  const abs = resolvePath(type, name);
  ensureSafePath(type, abs);

  let body: string;
  let stat: ReturnType<typeof lstatSafe>;
  if (type === "skills") {
    const skillPath = join(abs, "SKILL.md");
    if (!existsSync(skillPath)) throw new Error(`SKILL.md 不存在: ${skillPath}`);
    body = readFileSync(skillPath, "utf8");
    stat = lstatSafe(skillPath);
  } else {
    if (!existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
    body = readFileSync(abs, "utf8");
    stat = lstatSafe(abs);
  }
  if (!stat) throw new Error("stat 失败");

  const fm = parseFrontmatter(body);
  const meta: PluginItemMeta = {
    name,
    relPath: type === "skills" ? join(type, name) : join(type, `${name}${EXT_BY_TYPE[type]}`),
    size: stat.size,
    mtime: stat.mtime,
    isSymlink: stat.isSymbolicLink,
    frontmatter: fm.fields,
  };
  return { meta, body };
}

export function save(type: PluginType, name: string, body: string): void {
  const v = validateName(type, name);
  if (v) throw new Error(v);
  const abs = resolvePath(type, name);
  ensureSafePath(type, abs);

  if (type === "skills") {
    if (!existsSync(abs)) throw new Error(`skill 目录不存在: ${abs}`);
    const skillPath = join(abs, "SKILL.md");
    writeFileSync(skillPath, body, "utf8");
  } else {
    // 父目录必须已存在（由 create 建立）
    if (!existsSync(typeDir(type))) mkdirSync(typeDir(type), { recursive: true });
    writeFileSync(abs, body, "utf8");
  }
}

export function create(type: PluginType, name: string, body?: string): void {
  const v = validateName(type, name);
  if (v) throw new Error(v);
  const abs = resolvePath(type, name);
  ensureSafePath(type, abs);

  if (existsSync(abs)) throw new Error(`已存在: ${name}`);

  if (!existsSync(typeDir(type))) mkdirSync(typeDir(type), { recursive: true });

  if (type === "skills") {
    mkdirSync(abs, { recursive: true });
    const skillPath = join(abs, "SKILL.md");
    const defaultBody =
      body ??
      serializeFrontmatter({
        name,
        description: `${name} skill`,
      }) +
        `# ${name}\n\n描述此 skill 的工作流。\n`;
    writeFileSync(skillPath, defaultBody, "utf8");
  } else {
    let defaultBody = body ?? "";
    if (type === "extensions" && !defaultBody) {
      defaultBody = [
        `import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";`,
        "",
        "export default function (_ctx: ExtensionContext, pi: ExtensionAPI) {",
        `  // 在此实现 ${name} 扩展`,
        "}",
        "",
      ].join("\n");
    }
    if (type === "prompts" && !defaultBody) {
      defaultBody =
        serializeFrontmatter({
          description: `${name} prompt template`,
          "argument-hint": "",
        }) + `\n你的提示正文写在这里。可用 $1, $@, ${"$"}{1:-default} 等变量。\n`;
    }
    writeFileSync(abs, defaultBody, "utf8");
  }
}

export function remove(type: PluginType, name: string): void {
  const v = validateName(type, name);
  if (v) throw new Error(v);
  const abs = resolvePath(type, name);
  ensureSafePath(type, abs);

  const stat = lstatSafe(abs);
  if (!stat) throw new Error(`不存在: ${name}`);

  if (stat.isSymbolicLink) {
    // 只删链接，保留目标
    unlinkSync(abs);
    return;
  }
  if (type === "skills") {
    if (stat.isDirectory) {
      rmSync(abs, { recursive: true, force: true });
    } else {
      throw new Error("skill 路径不是目录");
    }
  } else {
    if (stat.isDirectory) throw new Error("期望文件，实际是目录");
    unlinkSync(abs);
  }
}

/** 测试用：暴露根路径（仅 main 内部）。 */
export const _paths = { ROOT, typeDir, resolvePath, validateName, parseFrontmatter, serializeFrontmatter };