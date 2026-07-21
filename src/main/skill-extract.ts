import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as agentManager from "./agent-manager";
import * as pluginManager from "./plugin-manager";
import type { SkillExtractMode } from "../shared/types";

interface SkillFence {
  /** fence 起止在原 summary 中的字节范围（左闭右开） */
  start: number;
  end: number;
  /** fence 内容（不含 ```fromlan-skill 和 ``` 闭合行） */
  inner: string;
}

/**
 * 按"行首三引号配对"扫描 fromlan-skill 围栏。
 * 行首匹配确保不被围栏内嵌套 ```python / ```js 等示例代码误截断。
 */
function findSkillFences(summary: string): SkillFence[] {
  const lines = summary.split(/\r?\n/);
  const fences: SkillFence[] = [];
  let cursor = 0;
  let openLine = -1;
  let openStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const lineStart = cursor;
    const lineEnd = cursor + lines[i].length;
    cursor = lineEnd + 1; // +1 for the \n
    if (openLine < 0) {
      if (/^```fromlan-skill\s*$/i.test(lines[i])) {
        openLine = i;
        openStart = lineStart;
      }
    } else {
      if (/^```\s*$/.test(lines[i])) {
        const innerStart = openStart + lines[openLine].length + 1; // skip open line + \n
        const inner = summary.slice(innerStart, lineStart);
        fences.push({ start: openStart, end: lineEnd, inner });
        openLine = -1;
      }
    }
  }
  return fences;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface ParsedSkillTrailer {
  name: string;
  description: string;
  body: string;
}

export interface SkillExtractResult {
  cleanSummary: string;
  skill?: ParsedSkillTrailer;
}

/** 从摘要中剥离并解析 `fromlan-skill` 围栏（取最后一个 fence；cleanSummary 移除所有 fence）。 */
export function parseSkillTrailer(summary: string): SkillExtractResult {
  const fences = findSkillFences(summary);
  if (fences.length === 0) return { cleanSummary: summary };

  // cleanSummary：把所有 fence 区间替换为空
  let cleanSummary = "";
  let cursor = 0;
  for (const f of fences) {
    cleanSummary += summary.slice(cursor, f.start);
    cursor = f.end;
    if (cursor < summary.length && summary[cursor] === "\n") cursor += 1;
  }
  cleanSummary += summary.slice(cursor);
  cleanSummary = cleanSummary.trim();

  // 解析最后一个 fence 作为最终 skill
  const raw = fences[fences.length - 1].inner.trim();
  const sepIdx = raw.search(/\r?\n---\r?\n/);
  let header: string;
  let markdown: string;
  if (sepIdx >= 0) {
    header = raw.slice(0, sepIdx).trim();
    markdown = raw.slice(sepIdx).replace(/^\r?\n---\r?\n/, "").trim();
  } else {
    // 无 ---：前两行当 name/description，其余当 body
    const lines = raw.split(/\r?\n/);
    header = lines.slice(0, 2).join("\n");
    markdown = lines.slice(2).join("\n").trim();
  }

  let name = "";
  let description = "";
  for (const line of header.split(/\r?\n/)) {
    const m = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "name") name = val.toLowerCase();
    if (key === "description") description = val;
  }

  if (!name || !NAME_RE.test(name) || name.length > 64) {
    return { cleanSummary };
  }
  if (!description) description = `${name} skill`;
  if (!markdown) markdown = `# ${name}\n\n（由成功派活自动提炼，请补充细节。）\n`;

  const skillBody =
    `---\nname: ${name}\ndescription: ${description}\n---\n\n` + markdown + "\n";

  return {
    cleanSummary,
    skill: { name, description, body: skillBody },
  };
}

function uniqueSkillName(
  base: string,
  exists: (n: string) => boolean
): string {
  if (!exists(base)) return base;
  for (let i = 2; i <= 50; i++) {
    const candidate = `${base}-${i}`;
    if (!exists(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export interface WriteSkillResult {
  name: string;
  target: "agent" | "global";
  agentName?: string;
  pathHint: string;
}

/** 写入 agent 或全局 skills 目录；同名则自动加后缀。 */
export function writeExtractedSkill(
  skill: ParsedSkillTrailer,
  agentName?: string
): WriteSkillResult {
  if (agentName && /^[a-z0-9][a-z0-9-]*$/.test(agentName)) {
    const skillsRoot = join(homedir(), ".pi", "agents", agentName, "skills");
    const name = uniqueSkillName(skill.name, (n) =>
      existsSync(join(skillsRoot, n))
    );
    agentManager.createFile(agentName, "skills", name, skill.body);
    return {
      name,
      target: "agent",
      agentName,
      pathHint: `~/.pi/agents/${agentName}/skills/${name}/SKILL.md`,
    };
  }

  const globalRoot = join(homedir(), ".pi", "agent", "skills");
  const name = uniqueSkillName(skill.name, (n) =>
    existsSync(join(globalRoot, n))
  );
  pluginManager.create("skills", name, skill.body);
  return {
    name,
    target: "global",
    pathHint: `~/.pi/agent/skills/${name}/SKILL.md`,
  };
}

/** 按设置决定是否落盘；返回写入结果或 null（off / 无 skill）。 */
export function maybeExtractAndWriteSkill(
  summary: string,
  mode: SkillExtractMode,
  agentName?: string
): { cleanSummary: string; written?: WriteSkillResult; skillName?: string } {
  const { cleanSummary, skill } = parseSkillTrailer(summary);
  if (!skill || mode === "off") {
    return { cleanSummary };
  }
  try {
    const written = writeExtractedSkill(skill, agentName);
    return { cleanSummary, written, skillName: written.name };
  } catch (e) {
    console.error("[skill-extract] write failed:", e);
    return { cleanSummary, skillName: skill.name };
  }
}
