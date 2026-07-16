import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getBaseDir } from "./persistence";
import type { AgentMeta } from "../shared/types";

/**
 * Agent 元数据持久化层。数据存于 {userData}/lite-pi/agents.json。
 *
 * 注意：agents.json 只存元数据（name / description / createdAt），
 * 实际的 prompts/skills/extensions 文件在 ~/.pi/agents/<name>/ 下。
 */

const FILE = join(getBaseDir(), "agents.json");

export function loadAgents(): AgentMeta[] {
  if (!existsSync(FILE)) return [];
  try {
    const raw = readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as AgentMeta[];
  } catch {
    return [];
  }
}

export function saveAgents(list: AgentMeta[]): void {
  writeFileSync(FILE, JSON.stringify(list, null, 2), "utf8");
}