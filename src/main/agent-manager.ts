import { promises as fsp, existsSync, lstatSync, realpathSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join, sep } from "path";
import { homedir } from "os";
import * as agentsStore from "./agents-store";
import type {
  AgentMeta,
  PluginType,
  PluginItemMeta,
  PluginFile,
} from "../shared/types";

/**
 * 管理 ~/.pi/agents/<name>/{prompts,skills,extensions}/ 下的插件文件。
 *
 * 与 plugin-manager.ts 的关系：
 * - plugin-manager 管理 ~/.pi/agent/（全局共享）；
 * - 本模块管理 ~/.pi/agents/<name>/（agent 私有、隔离）。
 *
 * 安全边界（与 plugin-manager 对齐）：
 * - 路径严格收敛到 ~/.pi/agents/<name>/<type>/ 白名单目录；
 * - 名称正则校验，挡掉 ../、/、空字符串；
 * - 软链接删除只 unlink 链接本身，不跟随删除目标。
 *
 * 元数据持久化：
 * - 名称 / 描述 / createdAt 存于 {userData}/lite-pi/agents.json（见 agents-store）。
 * - 删除时同步移除元数据 + 磁盘目录。
 */

const ROOT = join(homedir(), ".pi", "agents");
const NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

const EXT_BY_TYPE: Record<PluginType, string> = {
  prompts: ".md",
  skills: "",
  extensions: ".ts",
};

const NAME_FILE_REGEX: Record<PluginType, RegExp> = {
  prompts: /^[a-z0-9][a-z0-9-]*$/,
  skills: /^[a-z0-9][a-z0-9-]*$/,
  extensions: /^[a-z0-9][a-z0-9._-]*$/,
};

function agentDir(name: string): string {
  return join(ROOT, name);
}

function typeDir(name: string, type: PluginType): string {
  return join(agentDir(name), type);
}

function resolveItemPath(name: string, type: PluginType, item: string): string {
  if (type === "skills") return join(typeDir(name, type), item);
  return join(typeDir(name, type), `${item}${EXT_BY_TYPE[type]}`);
}

function validateAgentName(name: string): string | null {
  if (!name || typeof name !== "string") return "名称不能为空";
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return "名称包含非法字符";
  }
  if (!NAME_REGEX.test(name)) {
    return `名称需匹配 ${NAME_REGEX.source}`;
  }
  if (name.length > 32) return "名称过长（>32）";
  return null;
}

function validateItemName(type: PluginType, name: string): string | null {
  if (!name || typeof name !== "string") return "名称不能为空";
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return "名称包含非法字符";
  }
  if (!NAME_FILE_REGEX[type].test(name)) {
    return `名称需匹配 ${NAME_FILE_REGEX[type].source}`;
  }
  if (name.length > 64) return "名称过长（>64）";
  return null;
}

/** 路径必须仍位于 agent 白名单内。 */
function ensureSafePath(name: string, type: PluginType, resolved: string): void {
  const base = typeDir(name, type) + sep;
  const normalized = resolved.replace(/\\/g, sep);
  if (!normalized.startsWith(base)) {
    throw new Error(`拒绝访问：路径超出白名单 (${base})`);
  }
}

/**
 * 解析 symlink 后再次校验真实路径仍在白名单内。readFileSync 默认跟随 symlink，
 * 所以读取入口必须做这一步，防止白名单内 symlink 指向 ~/.ssh 等敏感位置被读出。
 */
function ensureSafeRealPath(name: string, type: PluginType, resolved: string): void {
  const base = typeDir(name, type) + sep;
  const real = realpathSync(resolved).replace(/\\/g, sep);
  if (!real.startsWith(base)) {
    throw new Error(`拒绝访问：符号链接目标超出白名单 (${base})`);
  }
}

function parseFrontmatter(body: string): {
  raw: string | null;
  fields: PluginItemMeta["frontmatter"];
} {
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { raw: null, fields: undefined };
  const inner = m[1];
  const fields: NonNullable<PluginItemMeta["frontmatter"]> = {};
  for (const line of inner.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key === "description") fields.description = val;
    else if (key === "name") fields.name = val;
    else if (key === "argument-hint") fields.argumentHint = val;
  }
  return { raw: m[0], fields };
}

function serializeFrontmatter(fields: Record<string, string>): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fields)) {
    const safe = v.replace(/"/g, '\\"');
    lines.push(`${k}: "${safe}"`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function lstatSafe(p: string): {
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtime: number;
} | null {
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

// ── Agent 元数据 CRUD ───────────────────────────────────────────

export function list(): AgentMeta[] {
  return agentsStore.loadAgents().sort((a, b) => a.name.localeCompare(b.name));
}

export function get(name: string): AgentMeta | undefined {
  return list().find((a) => a.name === name);
}

export function create(name: string, description?: string): AgentMeta {
  const v = validateAgentName(name);
  if (v) throw new Error(v);
  const dir = agentDir(name);
  if (existsSync(dir)) {
    throw new Error(`agent 已存在: ${name}`);
  }
  mkdirSync(dir, { recursive: true });
  // 预创建三个子目录（即使为空，listFiles 也能稳定返回）
  mkdirSync(typeDir(name, "prompts"), { recursive: true });
  mkdirSync(typeDir(name, "skills"), { recursive: true });
  mkdirSync(typeDir(name, "extensions"), { recursive: true });

  const meta: AgentMeta = {
    name,
    description,
    createdAt: Date.now(),
  };
  const all = agentsStore.loadAgents();
  if (all.some((a) => a.name === name)) {
    // 极小概率：JSON 中已有同名条目但磁盘上不存在。覆写之。
    const next = all.filter((a) => a.name !== name).concat(meta);
    agentsStore.saveAgents(next);
  } else {
    all.push(meta);
    agentsStore.saveAgents(all);
  }
  return meta;
}

export function remove(name: string): void {
  const v = validateAgentName(name);
  if (v) throw new Error(v);
  const dir = agentDir(name);
  if (!existsSync(dir)) {
    // 目录不存在也算成功——只清元数据。
    const all = agentsStore.loadAgents().filter((a) => a.name !== name);
    agentsStore.saveAgents(all);
    return;
  }
  const stat = lstatSafe(dir);
  if (!stat) throw new Error(`不存在: ${name}`);
  if (stat.isSymbolicLink) {
    // 只删链接，保留目标（与 plugin-manager 红线一致）
    unlinkSync(dir);
  } else if (stat.isDirectory) {
    rmSync(dir, { recursive: true, force: true });
  } else {
    unlinkSync(dir);
  }
  const all = agentsStore.loadAgents().filter((a) => a.name !== name);
  agentsStore.saveAgents(all);
}

// ── Agent 下的 prompts/skills/extensions 文件 CRUD ──────────────────

export async function listFiles(name: string, type: PluginType): Promise<PluginItemMeta[]> {
  const v = validateAgentName(name);
  if (v) throw new Error(v);
  const dir = typeDir(name, type);
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const items: PluginItemMeta[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (type !== "skills" && !entry.endsWith(EXT_BY_TYPE[type])) continue;
    const itemName = type === "skills" ? entry : entry.slice(0, -EXT_BY_TYPE[type].length);
    const abs = resolveItemPath(name, type, itemName);
    const stat = lstatSafe(abs);
    if (!stat) continue;
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
      relPath: type === "skills"
        ? join(name, type, itemName)
        : join(name, type, entry),
      size,
      mtime: stat.mtime,
      isSymlink: stat.isSymbolicLink,
      frontmatter,
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return items;
}

export function readFile(name: string, type: PluginType, item: string): PluginFile {
  const v = validateAgentName(name);
  if (v) throw new Error(v);
  const iv = validateItemName(type, item);
  if (iv) throw new Error(iv);
  const abs = resolveItemPath(name, type, item);
  ensureSafePath(name, type, abs);

  let body: string;
  let stat: ReturnType<typeof lstatSafe>;
  if (type === "skills") {
    const skillPath = join(abs, "SKILL.md");
    if (!existsSync(skillPath)) throw new Error(`SKILL.md 不存在: ${skillPath}`);
    ensureSafeRealPath(name, type, skillPath);
    body = readFileSync(skillPath, "utf8");
    stat = lstatSafe(skillPath);
  } else {
    if (!existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
    ensureSafeRealPath(name, type, abs);
    body = readFileSync(abs, "utf8");
    stat = lstatSafe(abs);
  }
  if (!stat) throw new Error("stat 失败");

  const fm = parseFrontmatter(body);
  const meta: PluginItemMeta = {
    name: item,
    relPath: type === "skills"
      ? join(name, type, item)
      : join(name, type, `${item}${EXT_BY_TYPE[type]}`),
    size: stat.size,
    mtime: stat.mtime,
    isSymlink: stat.isSymbolicLink,
    frontmatter: fm.fields,
  };
  return { meta, body };
}

export function saveFile(name: string, type: PluginType, item: string, body: string): void {
  const v = validateAgentName(name);
  if (v) throw new Error(v);
  const iv = validateItemName(type, item);
  if (iv) throw new Error(iv);
  const abs = resolveItemPath(name, type, item);
  ensureSafePath(name, type, abs);

  if (type === "skills") {
    if (!existsSync(abs)) throw new Error(`skill 目录不存在: ${abs}`);
    const skillPath = join(abs, "SKILL.md");
    writeFileSync(skillPath, body, "utf8");
  } else {
    if (!existsSync(typeDir(name, type))) mkdirSync(typeDir(name, type), { recursive: true });
    writeFileSync(abs, body, "utf8");
  }
}

export function createFile(name: string, type: PluginType, item: string, body?: string): void {
  const v = validateAgentName(name);
  if (v) throw new Error(v);
  const iv = validateItemName(type, item);
  if (iv) throw new Error(iv);
  const abs = resolveItemPath(name, type, item);
  ensureSafePath(name, type, abs);

  if (existsSync(abs)) throw new Error(`已存在: ${item}`);
  if (!existsSync(typeDir(name, type))) mkdirSync(typeDir(name, type), { recursive: true });

  if (type === "skills") {
    mkdirSync(abs, { recursive: true });
    const skillPath = join(abs, "SKILL.md");
    const defaultBody =
      body ??
      serializeFrontmatter({
        name: item,
        description: `${item} skill`,
      }) + `# ${item}\n\n描述此 skill 的工作流。\n`;
    writeFileSync(skillPath, defaultBody, "utf8");
  } else {
    let defaultBody = body ?? "";
    if (type === "extensions" && !defaultBody) {
      defaultBody = [
        `import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";`,
        "",
        "export default function (_ctx: ExtensionContext, pi: ExtensionAPI) {",
        `  // 在此实现 ${item} 扩展`,
        "}",
        "",
      ].join("\n");
    }
    if (type === "prompts" && !defaultBody) {
      defaultBody =
        serializeFrontmatter({
          description: `${item} prompt template`,
          "argument-hint": "",
        }) + `\n你的提示正文写在这里。可用 $1, $@, ${"$"}{1:-default} 等变量。\n`;
    }
    writeFileSync(abs, defaultBody, "utf8");
  }
}

export function deleteFile(name: string, type: PluginType, item: string): void {
  const v = validateAgentName(name);
  if (v) throw new Error(v);
  const iv = validateItemName(type, item);
  if (iv) throw new Error(iv);
  const abs = resolveItemPath(name, type, item);
  ensureSafePath(name, type, abs);

  const stat = lstatSafe(abs);
  if (!stat) throw new Error(`不存在: ${item}`);

  if (stat.isSymbolicLink) {
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
export const _paths = { ROOT, agentDir, typeDir, validateAgentName };