import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getBaseDir } from "./persistence";
import * as agentManager from "./agent-manager";
import type { Squad, SquadCreateInput, SquadMember } from "../shared/types";

const SQUADS_FILE = join(getBaseDir(), "squads.json");

function atomicWrite(p: string, data: unknown): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
}

function load(): Squad[] {
  if (!existsSync(SQUADS_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(SQUADS_FILE, "utf8")) as Squad[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

let squads: Squad[] = load();

function save(): void {
  atomicWrite(SQUADS_FILE, squads);
}

export function listSquads(): Squad[] {
  return squads.filter((s) => !s.archived).slice();
}

export function listAllSquads(): Squad[] {
  return squads.slice();
}

export function getSquad(id: string): Squad | undefined {
  return squads.find((s) => s.id === id);
}

/**
 * 校验 Squad 引用的 agent 名。leaderAgentName 必传且必须合法且 agent 目录存在；
 * members 仅校验 kind === "agent" 的项（human 项仅做 kind 合法性）。
 * 抛错由调用方捕获并以 IPC { ok:false, error } 返回。
 */
function assertAgentRef(name: string, fieldHint: string): void {
  const v = agentManager.validateAgentName(name);
  if (v) throw new Error(`Squad ${fieldHint} 非法: ${v}`);
  if (!agentManager.agentExists(name)) {
    throw new Error(`Squad ${fieldHint} 指向不存在的 agent: ${name}`);
  }
}

function assertMembersAgentRefs(members: SquadMember[]): void {
  for (const m of members) {
    if (m.kind === "agent") {
      assertAgentRef(m.id, "成员");
    } else if (m.kind !== "human") {
      throw new Error(`Squad 成员 kind 非法: ${String((m as { kind: unknown }).kind)}`);
    }
  }
}

export function createSquad(input: SquadCreateInput): Squad {
  const name = input.name.trim();
  if (!name) throw new Error("Squad 名称不能为空");
  const leaderName = input.leaderAgentName?.trim();
  if (!leaderName) throw new Error("必须指定 leader Agent");
  assertAgentRef(leaderName, "leaderAgentName");
  assertMembersAgentRefs(input.members ?? []);
  const now = Date.now();
  const squad: Squad = {
    id: randomUUID(),
    name,
    description: input.description?.trim() || undefined,
    leaderAgentName: leaderName,
    members: input.members ?? [],
    instructions: input.instructions ?? "",
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  squads.push(squad);
  save();
  return squad;
}

export function updateSquad(
  id: string,
  patch: Partial<
    Pick<
      Squad,
      | "name"
      | "description"
      | "leaderAgentName"
      | "members"
      | "instructions"
      | "archived"
    >
  >
): Squad | undefined {
  const idx = squads.findIndex((s) => s.id === id);
  if (idx === -1) return undefined;
  const cur = squads[idx];

  // patch 校验：若带 leaderAgentName / members，必须分别合法
  if (patch.leaderAgentName !== undefined) {
    const next = patch.leaderAgentName.trim();
    assertAgentRef(next, "leaderAgentName");
    patch.leaderAgentName = next;
  }
  if (patch.members !== undefined) {
    assertMembersAgentRefs(patch.members);
  }

  squads[idx] = {
    ...cur,
    ...patch,
    name: patch.name !== undefined ? patch.name.trim() : cur.name,
    members: patch.members ?? cur.members,
    updatedAt: Date.now(),
  };
  save();
  return squads[idx];
}

export function deleteSquad(id: string): boolean {
  const before = squads.length;
  squads = squads.filter((s) => s.id !== id);
  if (squads.length === before) return false;
  save();
  return true;
}

export function setMembers(id: string, members: SquadMember[]): Squad | undefined {
  return updateSquad(id, { members });
}
