import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getBaseDir } from "./persistence";
import type {
  Assignee,
  Project,
  ProjectCreateInput,
  ProjectStatus,
  IssuePriority,
} from "../shared/types";

const PROJECTS_FILE = join(getBaseDir(), "projects.json");

function atomicWrite(p: string, data: unknown): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
}

function load(): Project[] {
  if (!existsSync(PROJECTS_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(PROJECTS_FILE, "utf8")) as Project[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

let projects: Project[] = load();

function save(): void {
  atomicWrite(PROJECTS_FILE, projects);
}

function normalizeLead(lead?: Assignee): Assignee | undefined {
  if (!lead?.id) return undefined;
  if (lead.kind !== "human" && lead.kind !== "agent") return undefined;
  return { kind: lead.kind, id: lead.id.trim() };
}

export function listProjects(): Project[] {
  return projects.slice();
}

export function getProject(id: string): Project | undefined {
  return projects.find((p) => p.id === id);
}

export function createProject(input: ProjectCreateInput): Project {
  const name = input.name.trim();
  if (!name) throw new Error("项目名称不能为空");
  const now = Date.now();
  const project: Project = {
    id: randomUUID(),
    name,
    description: input.description?.trim() || undefined,
    icon: input.icon?.trim() || undefined,
    status: input.status ?? "planned",
    priority: input.priority ?? "medium",
    lead: normalizeLead(input.lead),
    defaultCwd: input.defaultCwd?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  projects.push(project);
  save();
  return project;
}

export function updateProject(
  id: string,
  patch: Partial<
    Pick<
      Project,
      | "name"
      | "description"
      | "icon"
      | "status"
      | "priority"
      | "lead"
      | "defaultCwd"
    >
  >
): Project | undefined {
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return undefined;
  const cur = projects[idx];
  const next: Project = {
    ...cur,
    updatedAt: Date.now(),
  };
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("项目名称不能为空");
    next.name = name;
  }
  if (patch.description !== undefined) {
    next.description = patch.description.trim() || undefined;
  }
  if (patch.icon !== undefined) {
    next.icon = patch.icon.trim() || undefined;
  }
  if (patch.status !== undefined) {
    next.status = patch.status as ProjectStatus;
  }
  if (patch.priority !== undefined) {
    next.priority = patch.priority as IssuePriority;
  }
  if ("lead" in patch) {
    next.lead = normalizeLead(patch.lead);
  }
  if ("defaultCwd" in patch) {
    next.defaultCwd = patch.defaultCwd?.trim() || undefined;
  }
  projects[idx] = next;
  save();
  return next;
}

export function deleteProject(id: string): boolean {
  const before = projects.length;
  projects = projects.filter((p) => p.id !== id);
  if (projects.length === before) return false;
  save();
  return true;
}
