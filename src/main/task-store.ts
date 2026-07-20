import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getBaseDir } from "./persistence";
import type { Task, TaskStatus, TaskTrigger } from "../shared/types";

/**
 * Task 持久化（对齐 Multica agent_task_queue 的本地薄切片）。
 * 文件：{userData}/fromlan-pi-hub/tasks.json
 */

const TASKS_FILE = join(getBaseDir(), "tasks.json");

const ACTIVE: ReadonlySet<TaskStatus> = new Set([
  "queued",
  "dispatched",
  "running",
]);

const PENDING: ReadonlySet<TaskStatus> = new Set(["queued", "dispatched"]);

function atomicWrite(p: string, data: unknown): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
}

function load(): Task[] {
  if (!existsSync(TASKS_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(TASKS_FILE, "utf8")) as Task[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

let tasks: Task[] = load();

function save(): void {
  atomicWrite(TASKS_FILE, tasks);
}

export function listTasks(): Task[] {
  return tasks.slice();
}

export function listTasksByIssue(issueId: string): Task[] {
  return tasks.filter((t) => t.issueId === issueId);
}

export function getTask(id: string): Task | undefined {
  return tasks.find((t) => t.id === id);
}

export function getTaskBySession(sessionId: string): Task | undefined {
  return tasks.find((t) => t.sessionId === sessionId && ACTIVE.has(t.status));
}

/** 同一 (issue, agent) 是否已有 queued/dispatched（Multica pending 去重）。 */
export function hasPendingTask(issueId: string, agentName: string): boolean {
  return tasks.some(
    (t) =>
      t.issueId === issueId &&
      t.agentName === agentName &&
      PENDING.has(t.status)
  );
}

/** 该 issue 上任意 active task（含 running）。 */
export function listActiveTasksForIssue(issueId: string): Task[] {
  return tasks.filter((t) => t.issueId === issueId && ACTIVE.has(t.status));
}

/** 全部 active tasks（供 task-monitor 扫描）。 */
export function listActiveTasks(): Task[] {
  return tasks.filter((t) => ACTIVE.has(t.status));
}

export function createTask(input: {
  issueId: string;
  agentName: string;
  trigger: TaskTrigger;
  provider: string;
  model: string;
  cwd?: string;
  attempt?: number;
  parentTaskId?: string;
  piSessionId?: string;
  workdir?: string;
  sessionPoisoned?: boolean;
}): Task {
  const task: Task = {
    id: randomUUID(),
    issueId: input.issueId,
    agentName: input.agentName,
    attempt: input.attempt ?? 1,
    trigger: input.trigger,
    status: "queued",
    provider: input.provider,
    model: input.model,
    cwd: input.cwd,
    workdir: input.workdir ?? input.cwd,
    piSessionId: input.piSessionId,
    sessionPoisoned: input.sessionPoisoned,
    parentTaskId: input.parentTaskId,
    createdAt: Date.now(),
  };
  tasks.push(task);
  save();
  return task;
}

export function updateTask(
  id: string,
  patch: Partial<Omit<Task, "id" | "createdAt">>
): Task | undefined {
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;

  const prev = tasks[idx];
  const merged = { ...prev, ...patch };

  // 状态迁移时自动打时间戳
  if (patch.status === "dispatched" && !merged.dispatchedAt) {
    merged.dispatchedAt = Date.now();
  }
  if (patch.status === "running" && !merged.runningAt) {
    merged.runningAt = Date.now();
  }

  tasks[idx] = merged;
  save();
  return tasks[idx];
}

/** 取消某 issue 上全部 active tasks，返回被取消的列表。 */
export function cancelActiveTasksForIssue(issueId: string): Task[] {
  const cancelled: Task[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.issueId === issueId && ACTIVE.has(t.status)) {
      tasks[i] = {
        ...t,
        status: "cancelled",
        finishedAt: Date.now(),
      };
      cancelled.push(tasks[i]);
    }
  }
  if (cancelled.length > 0) save();
  return cancelled;
}

export function nextAttemptForIssue(issueId: string): number {
  let max = 0;
  for (const t of tasks) {
    if (t.issueId === issueId && t.attempt > max) max = t.attempt;
  }
  return max + 1;
}
