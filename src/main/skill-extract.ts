import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as agentManager from "./agent-manager";
import * as pluginManager from "./plugin-manager";
import type { SkillExtractMode } from "../shared/types";

const SKILL_FENCE_RE = /```fromlan-skill\s*\r?\n([\s\S]*?)```/i;
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

/** 从摘要中剥离并解析 `fromlan-skill` 围栏。 */
export function parseSkillTrailer(summary: string): SkillExtractResult {
  const match = summary.match(SKILL_FENCE_RE);
  if (!match) return { cleanSummary: summary };

  const cleanSummary = summary.replace(SKILL_FENCE_RE, "").trim();
  const raw = match[1].trim();
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
