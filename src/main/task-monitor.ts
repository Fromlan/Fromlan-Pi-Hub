import * as taskStore from "./task-store";
import * as settingsStore from "./settings-store";
import { failTaskWithInfo } from "./issue-runner";
import type { SessionSnapshot, TaskErrorInfo } from "../shared/types";

export interface TaskMonitorDeps {
  getSessions: () => SessionSnapshot[];
}

const SCAN_INTERVAL_MS = 5000;

let timer: ReturnType<typeof setInterval> | null = null;
let deps: TaskMonitorDeps | null = null;

function sessionMap(sessions: SessionSnapshot[]): Map<string, SessionSnapshot> {
  return new Map(sessions.map((s) => [s.id, s]));
}

function scanOnce(): void {
  if (!deps) return;
  const settings = settingsStore.getSettings();
  const now = Date.now();
  const sessions = sessionMap(deps.getSessions());

  for (const task of taskStore.listActiveTasks()) {
    if (task.status === "dispatched") {
      const dispatchedAt = task.dispatchedAt ?? task.createdAt;
      if (now - dispatchedAt <= settings.dispatchTimeoutMs) continue;

      let errorInfo: TaskErrorInfo;
      if (task.sessionId) {
        const snap = sessions.get(task.sessionId);
        if (!snap || snap.status === "exited") {
          errorInfo = {
            reason: "runtime_offline",
            message: "会话已离线或未启动",
            retryable: true,
          };
        } else {
          errorInfo = {
            reason: "timeout",
            message: "派活后长时间未进入 running 状态",
            retryable: true,
          };
        }
      } else {
        errorInfo = {
          reason: "timeout",
          message: "派活后长时间未进入 running 状态",
          retryable: true,
        };
      }
      failTaskWithInfo(task.id, errorInfo);
      continue;
    }

    if (task.status === "running") {
      const runningAt = task.runningAt ?? task.dispatchedAt ?? task.createdAt;
      if (now - runningAt <= settings.runningTimeoutMs) continue;

      if (task.sessionId) {
        const snap = sessions.get(task.sessionId);
        if (!snap || snap.status === "exited") {
          failTaskWithInfo(task.id, {
            reason: "runtime_offline",
            message: "执行会话已离线",
            retryable: true,
          });
          continue;
        }
      }

      failTaskWithInfo(task.id, {
        reason: "timeout",
        message: "任务执行超时",
        retryable: true,
      });
    }
  }
}

export function startTaskMonitor(d: TaskMonitorDeps): void {
  deps = d;
  stopTaskMonitor();
  timer = setInterval(scanOnce, SCAN_INTERVAL_MS);
}

export function stopTaskMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 供测试：立即跑一次扫描。 */
export function runTaskMonitorScanOnce(): void {
  scanOnce();
}
