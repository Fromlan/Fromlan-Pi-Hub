import { existsSync } from "fs";
import type { Task, TaskErrorInfo, TaskErrorReason } from "../shared/types";

/**
 * Multica 风格 resume 门闸（本地切片）：
 * - cwd 不在 → 全新 session
 * - cwd 在且毒化 → 复用 cwd、丢弃 session
 * - cwd 在且未毒化 → 复用 cwd + --session
 *
 * 不做每 task 隔离沙箱；对齐 Multica local_directory 路径。
 */

export interface ResumeDecision {
  cwd?: string;
  resumePiSessionId?: string;
  /** 人类可读说明（日志 / TaskHistory）。 */
  reason: string;
}

const POISON_PATTERNS = [
  /context\s*overflow/i,
  /iteration\s*limit/i,
  /invalid\s*request/i,
  /session\s*(corrupt|poison|damaged|invalid)/i,
  /compact\s*(fail|error|失败)/i,
  /上下文溢出/,
  /会话损坏/,
  /毒化/,
  /token\s*limit/i,
  /maximum\s*context/i,
];

export function isSessionPoisonMessage(message: string): boolean {
  return POISON_PATTERNS.some((re) => re.test(message));
}

/** 是否应按「毒化」处理（显式标记或错误原因）。 */
export function isSessionPoisoned(
  task: Pick<Task, "sessionPoisoned" | "errorInfo"> | undefined
): boolean {
  if (!task) return false;
  if (task.sessionPoisoned) return true;
  return task.errorInfo?.reason === "session_poisoned";
}

/**
 * 根据 prior task 与失败信息决定下一次 dispatch 的 cwd / --session。
 * prior 为空 → 全新（Issue 级 rerun）。
 */
export function decideResume(opts: {
  prior?: Task;
  /** 强制全新会话（Issue 级 rerun）。 */
  forceFreshSession?: boolean;
  /** 覆盖 cwd（用户显式传入）。 */
  cwdOverride?: string;
}): ResumeDecision {
  const { prior, forceFreshSession, cwdOverride } = opts;

  if (forceFreshSession || !prior) {
    return {
      cwd: cwdOverride ?? prior?.workdir ?? prior?.cwd,
      reason: "fresh_session",
    };
  }

  const priorDir = cwdOverride ?? prior.workdir ?? prior.cwd;
  if (!priorDir || !existsSync(priorDir)) {
    return {
      cwd: cwdOverride,
      reason: "workdir_missing",
    };
  }

  if (isSessionPoisoned(prior)) {
    return {
      cwd: priorDir,
      reason: "reuse_cwd_fresh_session_poisoned",
    };
  }

  if (prior.piSessionId) {
    return {
      cwd: priorDir,
      resumePiSessionId: prior.piSessionId,
      reason: "reuse_cwd_and_session",
    };
  }

  return {
    cwd: priorDir,
    reason: "reuse_cwd_no_session_id",
  };
}

/** get_state / --session 启动失败时的降级决策。 */
export function degradeAfterResumeFailure(
  decision: ResumeDecision,
  errorMessage: string
): ResumeDecision {
  if (!decision.resumePiSessionId) return decision;
  return {
    cwd: decision.cwd,
    reason: `resume_failed:${errorMessage.slice(0, 120)}`,
  };
}

/** 将原因映射到 TaskErrorInfo（供 classify 合并）。 */
export function sessionPoisonErrorInfo(message: string): TaskErrorInfo {
  return {
    reason: "session_poisoned" satisfies TaskErrorReason,
    message,
    retryable: true,
  };
}
