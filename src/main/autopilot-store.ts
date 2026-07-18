import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getBaseDir } from "./persistence";
import type {
  Autopilot,
  AutopilotCreateInput,
  AutopilotRun,
  IssuePriority,
} from "../shared/types";

const AUTOPILOTS_FILE = join(getBaseDir(), "autopilots.json");
const RUNS_FILE = join(getBaseDir(), "autopilot_runs.json");

function atomicWrite(p: string, data: unknown): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
}

function loadList<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as T[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

let autopilots: Autopilot[] = loadList(AUTOPILOTS_FILE);
let runs: AutopilotRun[] = loadList(RUNS_FILE);

function saveAutopilots(): void {
  atomicWrite(AUTOPILOTS_FILE, autopilots);
}

function saveRuns(): void {
  atomicWrite(RUNS_FILE, runs);
}

export function listAutopilots(): Autopilot[] {
  return autopilots.slice();
}

export function getAutopilot(id: string): Autopilot | undefined {
  return autopilots.find((a) => a.id === id);
}

export function createAutopilot(input: AutopilotCreateInput): Autopilot {
  const name = input.name.trim();
  if (!name) throw new Error("名称不能为空");
  if (!input.agentName?.trim()) throw new Error("必须指定 Agent");
  if (!input.schedule?.cron?.trim()) throw new Error("必须指定 cron");
  const now = Date.now();
  const ap: Autopilot = {
    id: randomUUID(),
    name,
    agentName: input.agentName.trim(),
    schedule: {
      cron: input.schedule.cron.trim(),
      tz: input.schedule.tz?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    },
    prompt: input.prompt ?? "",
    mode: input.mode,
    priority: (input.priority as IssuePriority) || "medium",
    enabled: input.enabled !== false,
    createdAt: now,
  };
  autopilots.push(ap);
  saveAutopilots();
  return ap;
}

export function updateAutopilot(
  id: string,
  patch: Partial<
    Pick<
      Autopilot,
      | "name"
      | "agentName"
      | "schedule"
      | "prompt"
      | "mode"
      | "priority"
      | "enabled"
      | "lastRunAt"
      | "nextRunAt"
    >
  >
): Autopilot | undefined {
  const idx = autopilots.findIndex((a) => a.id === id);
  if (idx === -1) return undefined;
  autopilots[idx] = { ...autopilots[idx], ...patch };
  saveAutopilots();
  return autopilots[idx];
}

export function deleteAutopilot(id: string): boolean {
  const before = autopilots.length;
  autopilots = autopilots.filter((a) => a.id !== id);
  if (autopilots.length === before) return false;
  saveAutopilots();
  return true;
}

export function listRuns(autopilotId?: string): AutopilotRun[] {
  const list = autopilotId
    ? runs.filter((r) => r.autopilotId === autopilotId)
    : runs;
  return list.slice().sort((a, b) => b.firedAt - a.firedAt);
}

export function addRun(
  input: Omit<AutopilotRun, "id">
): AutopilotRun {
  const run: AutopilotRun = { id: randomUUID(), ...input };
  runs.unshift(run);
  if (runs.length > 200) runs = runs.slice(0, 200);
  saveRuns();
  return run;
}
