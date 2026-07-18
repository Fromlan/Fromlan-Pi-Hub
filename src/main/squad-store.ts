import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getBaseDir } from "./persistence";
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

export function createSquad(input: SquadCreateInput): Squad {
  const name = input.name.trim();
  if (!name) throw new Error("Squad 名称不能为空");
  if (!input.leaderAgentName?.trim()) throw new Error("必须指定 leader Agent");
  const now = Date.now();
  const squad: Squad = {
    id: randomUUID(),
    name,
    description: input.description?.trim() || undefined,
    leaderAgentName: input.leaderAgentName.trim(),
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
  squads[idx] = {
    ...cur,
    ...patch,
    name: patch.name !== undefined ? patch.name.trim() : cur.name,
    leaderAgentName:
      patch.leaderAgentName !== undefined
        ? patch.leaderAgentName.trim()
        : cur.leaderAgentName,
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
