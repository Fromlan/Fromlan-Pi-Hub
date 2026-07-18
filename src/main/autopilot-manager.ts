import cron from "node-cron";
import * as autopilotStore from "./autopilot-store";
import * as issueStore from "./issue-store";
import * as issueRunner from "./issue-runner";
import type { Autopilot, AutopilotRun } from "../shared/types";
import { IPC } from "../shared/types";

type CronTask = ReturnType<typeof cron.schedule>;
type BroadcastFn = (channel: string, payload: unknown) => void;

let jobs = new Map<string, CronTask>();
let broadcast: BroadcastFn | null = null;

/** 避免 30s 内重复触发同一 autopilot。 */
const lastFireAt = new Map<string, number>();
const DEDUPE_MS = 30_000;

export function initAutopilotManager(b: BroadcastFn): void {
  broadcast = b;
  reloadAll();
}

function emit(ap: Autopilot): void {
  broadcast?.(IPC.autopilotChanged, ap);
}

function stopJob(id: string): void {
  const j = jobs.get(id);
  if (j) {
    j.stop();
    jobs.delete(id);
  }
}

function scheduleOne(ap: Autopilot): void {
  stopJob(ap.id);
  if (!ap.enabled) return;
  if (!cron.validate(ap.schedule.cron)) {
    console.warn(`[autopilot] invalid cron for ${ap.name}: ${ap.schedule.cron}`);
    return;
  }
  try {
    const task = cron.schedule(
      ap.schedule.cron,
      () => {
        void fireAutopilot(ap.id, false);
      },
      { timezone: ap.schedule.tz || undefined }
    );
    jobs.set(ap.id, task);
  } catch (e) {
    console.warn(`[autopilot] schedule failed ${ap.name}:`, e);
  }
}

export function reloadAll(): void {
  for (const id of [...jobs.keys()]) stopJob(id);
  for (const ap of autopilotStore.listAutopilots()) {
    scheduleOne(ap);
  }
}

export function onAutopilotChanged(ap: Autopilot): void {
  scheduleOne(ap);
  emit(ap);
}

export function onAutopilotDeleted(id: string): void {
  stopJob(id);
}

function expandPrompt(prompt: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return prompt.replace(/\{\{date\}\}/g, date);
}

export async function fireAutopilot(
  id: string,
  manual: boolean
): Promise<{ ok: true; run: AutopilotRun } | { ok: false; error: string }> {
  const ap = autopilotStore.getAutopilot(id);
  if (!ap) return { ok: false, error: "Autopilot 不存在" };
  if (!manual && !ap.enabled) {
    return { ok: false, error: "已禁用" };
  }

  const now = Date.now();
  const last = lastFireAt.get(id) ?? 0;
  if (!manual && now - last < DEDUPE_MS) {
    const run = autopilotStore.addRun({
      autopilotId: id,
      firedAt: now,
      status: "skipped",
      error: "30s 内去重",
    });
    return { ok: true, run };
  }
  lastFireAt.set(id, now);

  const prompt = expandPrompt(ap.prompt);
  const titlePrefix = ap.mode === "create_issue" ? ap.name : `[cron] ${ap.name}`;

  try {
    const issue = issueStore.createIssue({
      title: `${titlePrefix} ${new Date().toISOString().slice(0, 10)}`,
      description: prompt,
      status: "todo",
      priority: ap.priority,
      assignee: { kind: "agent", id: ap.agentName },
    });
    broadcast?.(IPC.issueCreated, issue);

    const r = await issueRunner.enqueueForAgent(
      issue.id,
      ap.agentName,
      "cron",
      { promptOverride: prompt }
    );

    if (!r.ok) {
      const run = autopilotStore.addRun({
        autopilotId: id,
        firedAt: now,
        status: "failed",
        issueId: issue.id,
        error: r.error,
      });
      autopilotStore.updateAutopilot(id, { lastRunAt: now });
      const updated = autopilotStore.getAutopilot(id);
      if (updated) emit(updated);
      return { ok: true, run };
    }

    const run = autopilotStore.addRun({
      autopilotId: id,
      firedAt: now,
      status: "ok",
      issueId: issue.id,
      taskId: r.task?.id,
      sessionId: r.task?.sessionId,
    });
    autopilotStore.updateAutopilot(id, { lastRunAt: now });
    const updated = autopilotStore.getAutopilot(id);
    if (updated) emit(updated);
    return { ok: true, run };
  } catch (e) {
    const run = autopilotStore.addRun({
      autopilotId: id,
      firedAt: now,
      status: "failed",
      error: (e as Error).message,
    });
    return { ok: true, run };
  }
}
