import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { getBaseDir } from "./persistence";
import type { AgentMeta } from "../shared/types";

/**
 * Agent 元数据持久化层。数据存于 {userData}/fromlan-pi-hub/agents.json。
 *
 * 注意：agents.json 只存元数据（name / description / createdAt），
 * 实际的 prompts/skills/extensions 文件在 ~/.pi/agents/<name>/ 下。
 */

const FILE = join(getBaseDir(), "agents.json");

function atomicWrite(p: string, data: unknown): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
}

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
  atomicWrite(FILE, list);
}