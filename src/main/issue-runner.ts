import type { SessionManager } from "./session-manager";
import * as issueStore from "./issue-store";
import * as taskStore from "./task-store";
import * as settingsStore from "./settings-store";
import * as squadStore from "./squad-store";
import * as projectStore from "./project-store";
import * as inboxStore from "./inbox-store";
import { notifyInboxItem } from "./notification";
import { formatMention, uniqueMentions } from "../shared/mention";
import { homedir } from "os";
import type {
  Comment,
  Issue,
  IssueRerunOpts,
  IssueStatus,
  Squad,
  Task,
  TaskErrorInfo,
  TaskTrigger,
} from "../shared/types";
import { IPC } from "../shared/types";

/** 非这些状态时才允许派活（Multica：Backlog 停车场；终态不自动跑）。 */
const DISPATCHABLE: ReadonlySet<IssueStatus> = new Set([
  "todo",
  "in_progress",
  "in_review",
  "blocked",
]);

const SUMMARY_MAX = 4000;

export type BroadcastFn = (channel: string, payload: unknown) => void;

interface RunnerDeps {
  sessions: SessionManager;
  broadcast: BroadcastFn;
  IPC: {
    issueChanged: string;
    commentAdded: string;
    taskChanged: string;
  };
}

let deps: RunnerDeps | null = null;

/** 最近一次成功 dispatch 的模型偏好（主进程侧，供 Assign 触发使用）。 */
let lastProvider = "";
let lastModel = "";
let lastCwd = "";

export function initIssueRunner(d: RunnerDeps): void {
  deps = d;
  const s = settingsStore.getSettings();
  if (s.defaultProvider) lastProvider = s.defaultProvider;
  if (s.defaultModel) lastModel = s.defaultModel;
  if (s.defaultCwd) lastCwd = s.defaultCwd;
}

export function setDispatchDefaults(
  provider: string,
  model: string,
  cwd?: string
): void {
  if (provider) lastProvider = provider;
  if (model) lastModel = model;
  if (cwd) lastCwd = cwd;
}

export function getDispatchDefaults(): {
  provider: string;
  model: string;
  cwd: string;
} {
  return { provider: lastProvider, model: lastModel, cwd: lastCwd };
}

function requireDeps(): RunnerDeps {
  if (!deps) throw new Error("issue-runner 未初始化");
  return deps;
}

function emitTask(task: Task): void {
  const d = requireDeps();
  d.broadcast(d.IPC.taskChanged, task);
}

function emitIssue(issue: Issue): void {
  const d = requireDeps();
  d.broadcast(d.IPC.issueChanged, issue);
}

function emitComment(c: Comment): void {
  const d = requireDeps();
  d.broadcast(d.IPC.commentAdded, c);
}

/** 根据错误消息分类（Multica 风格）。 */
export function classifyError(message: string): TaskErrorInfo {
  const lower = message.toLowerCase();
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("超时")
  ) {
    return { reason: "timeout", message, retryable: true };
  }
  if (
    lower.includes("offline") ||
    lower.includes("not found") ||
    lower.includes("exited") ||
    lower.includes("session") ||
    lower.includes("离线") ||
    lower.includes("不存在")
  ) {
    return { reason: "runtime_offline", message, retryable: true };
  }
  if (lower.includes("recovery") || lower.includes("recover")) {
    return { reason: "runtime_recovery", message, retryable: true };
  }
  return { reason: "agent_error", message, retryable: false };
}

function buildCommentTimeline(comments: Comment[]): string[] {
  const lines: string[] = [];
  if (comments.length === 0) return lines;
  lines.push("## 评论时间线");
  for (const c of comments.slice(-20)) {
    const who = `${c.author.kind}:${c.author.name || c.author.id}`;
    lines.push(`- [${who}] ${c.body}`);
  }
  lines.push("");
  return lines;
}

/** Squad Leader 硬编码协议（不可用户编辑）。 */
export function buildSquadLeaderPrompt(
  issue: Issue,
  squad: Squad,
  comments: Comment[],
  cwd?: string
): string {
  const lines: string[] = [
    `# SquadOperatingProtocol`,
    `你是 Squad「${squad.name}」的 Leader（${squad.leaderAgentName}）。`,
    `你的唯一职责是路由：读 issue → 用 mention markdown 指派一个或多个成员 → 用 2-3 句评估 → 停止。`,
    `不要自己写代码或执行工具；只做路由决策。`,
    `指派格式必须是：[@Name](mention://agent/<agentName>)`,
    "",
    `# SquadRoster`,
    `- Leader: ${formatMention("agent", squad.leaderAgentName, squad.leaderAgentName)}`,
  ];
  for (const m of squad.members) {
    if (m.kind === "agent") {
      lines.push(
        `- Member: ${formatMention("agent", m.id, m.id)}${m.role ? ` — ${m.role}` : ""}`
      );
    } else {
      lines.push(`- Human: ${formatMention("human", m.id, m.id)}`);
    }
  }
  lines.push("");
  if (squad.instructions.trim()) {
    lines.push("# SquadInstructions", squad.instructions.trim(), "");
  }
  lines.push(`# Issue ${issue.key}: ${issue.title}`, "");
  if (issue.description?.trim()) {
    lines.push("## 描述", issue.description.trim(), "");
  }
  lines.push(`当前状态: ${issue.status}`, `优先级: ${issue.priority}`, "");
  if (cwd) lines.push(`工作目录: ${cwd}`, "");
  lines.push(...buildCommentTimeline(comments));
  lines.push(
    "## 输出要求",
    "1. 简短评估（2-3 句）",
    "2. 至少 @ 一个 agent 成员（使用 mention markdown）",
    "3. 然后停止，不要执行任务本身"
  );
  return lines.join("\n");
}

/** 组装灌入 pi 的 issue 上下文 prompt。 */
export function buildIssuePrompt(
  issue: Issue,
  comments: Comment[],
  cwd?: string,
  promptOverride?: string
): string {
  if (promptOverride?.trim()) {
    return [
      `你正在处理 Issue ${issue.key}: ${issue.title}`,
      "",
      promptOverride.trim(),
      "",
      ...buildCommentTimeline(comments),
      "## 要求",
      "完成后给出简洁结果摘要。",
    ].join("\n");
  }
  const lines: string[] = [
    `你正在处理 Issue ${issue.key}: ${issue.title}`,
    "",
  ];
  if (issue.description?.trim()) {
    lines.push("## 描述", issue.description.trim(), "");
  }
  lines.push(`当前状态: ${issue.status}`, `优先级: ${issue.priority}`, "");
  if (cwd) {
    lines.push(`工作目录 (cwd): ${cwd}`, "");
  }
  lines.push(...buildCommentTimeline(comments));
  lines.push(
    "## 要求",
    "请直接执行本 Issue 描述的任务。",
    "完成后必须用自然语言给出简洁结果摘要（给人类看，将写回 Issue 评论区）——不要只留下 thinking/工具调用。",
    "若遇到阻塞，说明原因与建议下一步，然后停止；不要对同一失败命令反复重试超过 2 次。",
    process.platform === "win32"
      ? "当前环境是 Windows：不要依赖 bash/Git Bash；用 read/write/edit 等文件工具，或通过可用的 shell 工具调用 powershell/cmd。"
      : "优先使用文件与项目工具完成任务。"
  );
  return lines.join("\n");
}

async function resolveModel(
  override?: IssueRerunOpts,
  issueId?: string
): Promise<{ provider: string; model: string; cwd?: string }> {
  const s = settingsStore.getSettings();
  let projectCwd: string | undefined;
  if (!override?.cwd && issueId) {
    const issue = issueStore.getIssue(issueId);
    if (issue?.projectId) {
      const project = projectStore.getProject(issue.projectId);
      if (project?.defaultCwd?.trim()) {
        projectCwd = project.defaultCwd.trim();
      }
    }
  }
  const defaultCwd =
    override?.cwd ||
    projectCwd ||
    lastCwd ||
    s.defaultCwd ||
    process.cwd() ||
    homedir();
  if (override?.provider && override?.model) {
    return {
      provider: override.provider,
      model: override.model,
      cwd: defaultCwd,
    };
  }
  const provider = lastProvider || s.defaultProvider;
  const model = lastModel || s.defaultModel;
  if (provider && model) {
    return { provider, model, cwd: defaultCwd };
  }
  const d = requireDeps();
  const models = await d.sessions.getModels();
  if (models.length === 0) {
    throw new Error("无可用模型，请先配置 pi provider（~/.pi/agent/auth.json）");
  }
  const m = models[0];
  return { provider: m.provider, model: m.id, cwd: defaultCwd };
}

export interface EnqueueOpts extends IssueRerunOpts {
  promptOverride?: string;
  /** 跳过 pending/active 去重（leader→member 并行时用）。 */
  force?: boolean;
}

/**
 * 直接给指定 agent 派活（mention / cron / squad_member）。
 */
export async function enqueueForAgent(
  issueId: string,
  agentName: string,
  trigger: TaskTrigger,
  opts?: EnqueueOpts
): Promise<{ ok: true; task: Task | null; skipped?: string } | { ok: false; error: string }> {
  try {
    const issue = issueStore.getIssue(issueId);
    if (!issue) return { ok: false, error: "Issue 不存在" };
    if (!DISPATCHABLE.has(issue.status) && trigger !== "mention") {
      // mention 在 backlog 也可触发轻量执行；其余遵循 DISPATCHABLE
      if (issue.status === "done" || issue.status === "cancelled") {
        return { ok: true, task: null, skipped: `status=${issue.status} 不派活` };
      }
    }
    if (!opts?.force) {
      if (taskStore.hasPendingTask(issueId, agentName)) {
        return { ok: true, task: null, skipped: "已有 pending task" };
      }
      const active = taskStore
        .listActiveTasksForIssue(issueId)
        .filter((t) => t.agentName === agentName);
      if (active.length > 0) {
        return { ok: true, task: null, skipped: "该 agent 已在执行" };
      }
    }

    const model = await resolveModel(opts, issueId);
    const task = taskStore.createTask({
      issueId,
      agentName,
      trigger,
      provider: model.provider,
      model: model.model,
      cwd: model.cwd,
      attempt: taskStore.nextAttemptForIssue(issueId),
    });
    emitTask(task);
    await dispatch(task.id, opts?.promptOverride);
    return { ok: true, task: taskStore.getTask(task.id) ?? task };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Multica 风格：非 backlog + assignee=agent|squad → enqueue 并立刻 dispatch。
 */
export async function maybeEnqueue(
  issueId: string,
  trigger: TaskTrigger,
  opts?: EnqueueOpts
): Promise<{ ok: true; task: Task | null; skipped?: string } | { ok: false; error: string }> {
  try {
    const issue = issueStore.getIssue(issueId);
    if (!issue) return { ok: false, error: "Issue 不存在" };

    if (!DISPATCHABLE.has(issue.status)) {
      return { ok: true, task: null, skipped: `status=${issue.status} 不自动派活` };
    }

    // Squad：派给 leader
    if (issue.assignee.kind === "squad" && issue.assignee.id) {
      const squad = squadStore.getSquad(issue.assignee.id);
      if (!squad || squad.archived) {
        return { ok: false, error: "Squad 不存在或已归档" };
      }
      if (trigger === "assign" || trigger === "rerun" || trigger === "status") {
        await cancelIssueWork(issueId, squad.leaderAgentName, trigger === "rerun");
      }
      // 反自触发：评论已含 agent mention 时不启动 leader
      if (trigger === "status" || trigger === "assign") {
        const comments = issueStore.listComments(issueId);
        const last = comments[comments.length - 1];
        if (last) {
          const ms = uniqueMentions(last.body).filter((m) => m.kind === "agent");
          if (ms.length > 0) {
            return { ok: true, task: null, skipped: "评论已含显式 mention，跳过 leader" };
          }
        }
      }
      return enqueueForAgent(issueId, squad.leaderAgentName, "squad_leader", {
        ...opts,
        force: trigger === "rerun",
        promptOverride: buildSquadLeaderPrompt(
          issue,
          squad,
          issueStore.listComments(issueId),
          opts?.cwd
        ),
      });
    }

    if (issue.assignee.kind !== "agent" || !issue.assignee.id) {
      return { ok: true, task: null, skipped: "assignee 不是 agent/squad" };
    }

    const agentName = issue.assignee.id;

    if (trigger === "assign" || trigger === "rerun" || trigger === "status") {
      await cancelIssueWork(issueId, agentName, trigger === "rerun");
      if (trigger === "assign") {
        pushInbox({
          kind: "assign",
          issueId,
          title: `已指派 ${issue.key}`,
          body: `${issue.title} → @${agentName}`,
        });
      }
    }

    return enqueueForAgent(issueId, agentName, trigger, {
      ...opts,
      force: trigger === "rerun",
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function pushInbox(input: {
  kind: "mention" | "assign" | "task_failed" | "subscription";
  issueId?: string;
  title: string;
  body: string;
}): void {
  const item = inboxStore.addInboxItem(input);
  requireDeps().broadcast(IPC.inboxChanged, item);
  notifyInboxItem(item);
}

/**
 * Multica「评论再唤醒 Leader」规则。
 * 仅在 issue.assignee 已是该 squad 时由 maybeRetriggerSquadLeaderOnComment 调用。
 *
 * | 事件 | 触发? |
 * | 非成员评论 | Yes |
 * | 成员进度且无 @mention | Yes |
 * | 显式 @agent/@squad/@human | No（agent 作者 @ 其他 agent 除外） |
 * | Leader 自身评论 | No |
 */
export function shouldRetriggerSquadLeader(
  comment: Comment,
  squad: Squad
): boolean {
  if (
    comment.author.kind === "agent" &&
    comment.author.id === squad.leaderAgentName
  ) {
    return false;
  }

  const mentions = uniqueMentions(comment.body);
  const hasRoutingMention = mentions.some(
    (m) => m.kind === "agent" || m.kind === "squad" || m.kind === "human"
  );

  if (hasRoutingMention) {
    // Multica 例外：agent 回帖里 @ 了其他 agent → 仍唤醒 leader 协调线程
    if (
      comment.author.kind === "agent" &&
      mentions.some(
        (m) => m.kind === "agent" && m.id !== comment.author.id
      )
    ) {
      return true;
    }
    return false;
  }

  return true;
}

/** Issue 已派给 Squad 时，按 Multica 规则决定是否再启 leader。 */
export async function maybeRetriggerSquadLeaderOnComment(
  comment: Comment
): Promise<void> {
  const issue = issueStore.getIssue(comment.issueId);
  if (!issue || issue.assignee.kind !== "squad" || !issue.assignee.id) return;
  if (!DISPATCHABLE.has(issue.status)) return;

  const squad = squadStore.getSquad(issue.assignee.id);
  if (!squad || squad.archived) return;
  if (!shouldRetriggerSquadLeader(comment, squad)) return;

  void enqueueForAgent(comment.issueId, squad.leaderAgentName, "squad_leader", {
    promptOverride: buildSquadLeaderPrompt(
      issue,
      squad,
      issueStore.listComments(comment.issueId)
    ),
  });
}

/**
 * 评论 @mention 触发：不改 assignee，给被提及的 agent 各启一条 task。
 */
export async function handleCommentMentions(comment: Comment): Promise<void> {
  const mentions = uniqueMentions(comment.body);
  if (mentions.length === 0) return;

  // 反自触发：author 是 agent 时忽略对自己的 mention
  const agentMentions = mentions.filter((m) => {
    if (m.kind !== "agent") return false;
    if (comment.author.kind === "agent" && comment.author.id === m.id) return false;
    return true;
  });

  for (const m of mentions) {
    if (m.kind === "human") {
      pushInbox({
        kind: "mention",
        issueId: comment.issueId,
        title: "有人提到了你",
        body: comment.body.slice(0, 200),
      });
    }
  }

  for (const m of agentMentions) {
    void enqueueForAgent(comment.issueId, m.id, "mention");
  }

  // Squad mention：启动该 squad 的 leader（不改 assignee）
  for (const m of mentions.filter((x) => x.kind === "squad")) {
    const squad = squadStore.getSquad(m.id);
    if (!squad || squad.archived) continue;
    const issue = issueStore.getIssue(comment.issueId);
    if (!issue) continue;
    void enqueueForAgent(comment.issueId, squad.leaderAgentName, "squad_leader", {
      promptOverride: buildSquadLeaderPrompt(
        issue,
        squad,
        issueStore.listComments(comment.issueId)
      ),
    });
  }
}

/** 评论落库后的统一触发：mention 路由 + squad-assigned 再唤醒。 */
export async function handleCommentTriggers(comment: Comment): Promise<void> {
  await handleCommentMentions(comment);
  await maybeRetriggerSquadLeaderOnComment(comment);
}

/** Leader 无有效 mention 时的 Multica 风格兜底：roster 中第一个 agent 成员。 */
export function pickFirstSquadMember(
  squad: Squad,
  excludeAgentName: string
): string | null {
  const member = squad.members.find(
    (m) => m.kind === "agent" && m.id && m.id !== excludeAgentName
  );
  return member?.id ?? null;
}

/** 取消 issue 上 active work；rerun 时取消全部，assign 时取消「其他 agent」的。 */
async function cancelIssueWork(
  issueId: string,
  keepAgent: string,
  cancelAll: boolean
): Promise<void> {
  const d = requireDeps();
  const active = taskStore.listActiveTasksForIssue(issueId);
  for (const t of active) {
    if (!cancelAll && t.agentName === keepAgent) continue;
    const updated = taskStore.updateTask(t.id, {
      status: "cancelled",
      finishedAt: Date.now(),
    });
    if (updated) emitTask(updated);
    if (t.sessionId) {
      try {
        await d.sessions.kill(t.sessionId);
      } catch {
        // ignore
      }
    }
  }
}

async function dispatch(
  taskId: string,
  promptOverride?: string
): Promise<void> {
  const d = requireDeps();
  let task = taskStore.getTask(taskId);
  if (!task || task.status !== "queued") return;

  const issue = issueStore.getIssue(task.issueId);
  if (!issue) {
    failTaskWithInfo(taskId, classifyError("Issue 已删除"));
    return;
  }

  task = taskStore.updateTask(taskId, { status: "dispatched" }) ?? task;
  emitTask(task);

  if (issue.status === "todo") {
    const updated = issueStore.setIssueStatus(task.issueId, "in_progress");
    if (updated) emitIssue(updated);
  }

  try {
    const snap = await d.sessions.start({
      provider: task.provider,
      model: task.model,
      cwd: task.cwd,
      title: `${issue.key} ${issue.title}`,
      agentName: task.agentName,
      issueId: task.issueId,
    });
    setDispatchDefaults(task.provider, task.model, task.cwd);

    task =
      taskStore.updateTask(taskId, {
        status: "running",
        sessionId: snap.id,
      }) ?? task;
    emitTask(task);

    const comments = issueStore.listComments(task.issueId);
    let prompt: string;
    if (task.trigger === "squad_leader") {
      // 用已解析的 task.cwd 重建，确保项目 defaultCwd 写入 briefing
      if (issue.assignee.kind === "squad") {
        const squad = squadStore.getSquad(issue.assignee.id);
        prompt = squad
          ? buildSquadLeaderPrompt(issue, squad, comments, task.cwd)
          : promptOverride ||
            buildIssuePrompt(issue, comments, task.cwd);
      } else if (promptOverride) {
        prompt =
          task.cwd && !promptOverride.includes("工作目录")
            ? `${promptOverride}\n工作目录: ${task.cwd}\n`
            : promptOverride;
      } else {
        prompt = buildIssuePrompt(issue, comments, task.cwd);
      }
    } else {
      prompt = buildIssuePrompt(issue, comments, task.cwd, promptOverride);
    }
    d.sessions.prompt(snap.id, prompt);
  } catch (e) {
    failTaskWithInfo(taskId, classifyError((e as Error).message));
  }
}

/** 内部：失败后自动重试（trigger=retry）。 */
async function enqueueRetry(failedTask: Task): Promise<void> {
  const settings = settingsStore.getSettings();
  if (failedTask.attempt >= settings.maxRetries) return;
  if (failedTask.trigger === "cron") return;

  const task = taskStore.createTask({
    issueId: failedTask.issueId,
    agentName: failedTask.agentName,
    trigger: "retry",
    provider: failedTask.provider,
    model: failedTask.model,
    cwd: failedTask.cwd,
    attempt: failedTask.attempt + 1,
    parentTaskId: failedTask.id,
  });
  emitTask(task);
  await dispatch(task.id);
}

/** 带错误分类的失败处理；可 retryable 时自动 enqueue retry。 */
export function failTaskWithInfo(
  taskId: string,
  errorInfo: TaskErrorInfo
): void {
  const task = taskStore.getTask(taskId);
  if (
    !task ||
    task.status === "completed" ||
    task.status === "cancelled" ||
    task.status === "failed"
  )
    return;

  const updated = taskStore.updateTask(taskId, {
    status: "failed",
    error: errorInfo.message,
    errorInfo,
    finishedAt: Date.now(),
  });
  if (updated) emitTask(updated);

  const issue = issueStore.getIssue(task.issueId);
  if (issue && (issue.status === "in_progress" || issue.status === "todo")) {
    const rolled = issueStore.setIssueStatus(task.issueId, "todo");
    if (rolled) emitIssue(rolled);
  }

  const reasonLabel =
    errorInfo.reason === "timeout"
      ? "超时"
      : errorInfo.reason === "runtime_offline"
        ? "运行时离线"
        : errorInfo.reason === "runtime_recovery"
          ? "运行时恢复"
          : errorInfo.reason === "agent_error"
            ? "Agent 错误"
            : "未知错误";

  const c = issueStore.addComment({
    issueId: task.issueId,
    author: {
      kind: "agent",
      id: task.agentName,
      name: task.agentName,
    },
    body: `派活失败（${reasonLabel}）：${errorInfo.message}${
      errorInfo.retryable && task.attempt < settingsStore.getSettings().maxRetries
        ? " — 将自动重试"
        : ""
    }`,
    mentions: [],
  });
  emitComment(c);

  if (errorInfo.retryable) {
    void enqueueRetry(task);
  } else {
    // 不可重试耗尽 / agent_error → 通知人
    const issue = issueStore.getIssue(task.issueId);
    pushInbox({
      kind: "task_failed",
      issueId: task.issueId,
      title: `任务失败 ${issue?.key ?? ""}`.trim(),
      body: errorInfo.message,
    });
  }

  // retryable 但已达上限
  if (
    errorInfo.retryable &&
    task.attempt >= settingsStore.getSettings().maxRetries
  ) {
    const issue = issueStore.getIssue(task.issueId);
    pushInbox({
      kind: "task_failed",
      issueId: task.issueId,
      title: `任务失败（已重试耗尽）${issue?.key ?? ""}`.trim(),
      body: errorInfo.message,
    });
  }
}

/**
 * session 正常结束（agent_end）：写回评论 + in_review；leader 则解析 mention 派成员。
 */
export function onSessionCompleted(sessionId: string, summary: string): void {
  const task = taskStore.getTaskBySession(sessionId);
  if (!task || task.status !== "running") return;

  const body = (
    summary.trim() ||
    "（Agent 已结束，但未产出可读摘要。请查看会话记录或重新派活。）"
  ).slice(0, SUMMARY_MAX);

  const mentions = uniqueMentions(body).map((m) => ({
    kind: m.kind,
    id: m.id,
  }));

  const updated = taskStore.updateTask(task.id, {
    status: "completed",
    finishedAt: Date.now(),
  });
  if (updated) emitTask(updated);

  const prefix =
    task.trigger === "squad_leader" ? "[leader-decision]\n" : "";
  const c = issueStore.addComment({
    issueId: task.issueId,
    author: {
      kind: "agent",
      id: task.agentName,
      name: task.agentName,
    },
    body: prefix + body,
    mentions,
  });
  emitComment(c);

  if (task.trigger === "squad_leader") {
    const mentionedIds = uniqueMentions(body)
      .filter((m) => m.kind === "agent" && m.id !== task.agentName)
      .map((m) => m.id);
    const targets = [...new Set(mentionedIds)];
    if (targets.length === 0) {
      const issue = issueStore.getIssue(task.issueId);
      const squad =
        issue?.assignee.kind === "squad"
          ? squadStore.getSquad(issue.assignee.id)
          : undefined;
      const fallback = squad
        ? pickFirstSquadMember(squad, task.agentName)
        : null;
      if (fallback) {
        targets.push(fallback);
      } else {
        if (issue && issue.status === "in_progress") {
          const rolled = issueStore.setIssueStatus(task.issueId, "todo");
          if (rolled) emitIssue(rolled);
        }
        pushInbox({
          kind: "task_failed",
          issueId: task.issueId,
          title: "Leader 未能解析成员",
          body: "Leader 输出中没有有效的 agent mention，且 roster 无可用成员，请手动指定。",
        });
        return;
      }
    }
    for (const agentId of targets) {
      void enqueueForAgent(task.issueId, agentId, "squad_member", {
        force: true,
      });
    }
    return;
  }

  const issue = issueStore.getIssue(task.issueId);
  if (issue && issue.status === "in_progress") {
    const next = issueStore.setIssueStatus(task.issueId, "in_review");
    if (next) emitIssue(next);
  }

  // 成员/普通 agent 回帖：mention 路由 +（若 issue 派给 squad）再唤醒 leader
  void handleCommentTriggers(c);
}

/** session 意外退出 / kill：失败回写。 */
export function onSessionFailed(sessionId: string, error: string): void {
  const task = taskStore.getTaskBySession(sessionId);
  if (!task || task.status !== "running") return;
  failTaskWithInfo(task.id, classifyError(error));
}

export function listTasksForIssue(issueId: string): Task[] {
  return taskStore.listTasksByIssue(issueId);
}

export function listAllTasks(): Task[] {
  return taskStore.listTasks();
}
