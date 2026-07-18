/**
 * UI 显示文案（中文优先）—— 枚举 → 可读标签的单一事实源。
 * 本仓无 i18n 框架；组件硬编码文案逐步迁到此处。
 */
import type {
  AutopilotRun,
  InboxKind,
  IssuePriority,
  IssueStatus,
  ProjectStatus,
  TaskErrorReason,
  TaskStatus,
  TaskTrigger,
} from "./types";

/** Issue / 看板列状态 */
export const STATUS_LABEL: Record<IssueStatus, string> = {
  backlog: "待办池",
  todo: "待处理",
  in_progress: "进行中",
  in_review: "待审",
  done: "完成",
  blocked: "阻塞",
  cancelled: "取消",
};

/** 项目状态 */
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  planned: "计划中",
  in_progress: "进行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
};

/** Issue 优先级 */
export const PRIORITY_LABEL: Record<IssuePriority, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

/** IconRail / 面板导航标题（短名） */
export const PANEL_LABEL = {
  kanban: "看板",
  projects: "项目",
  agents: "代理",
  squads: "小队",
  plugins: "插件",
  autopilots: "自动派活",
  inbox: "收件箱",
  settings: "设置",
} as const;

/** IconRail tooltip（中英对照，与「代理 (Agents)」风格一致） */
export const PANEL_TOOLTIP = {
  kanban: "看板 (Kanban)",
  projects: "项目 (Projects)",
  agents: "代理 (Agents)",
  squads: "小队 (Squads)",
  plugins: "插件 (Plugins)",
  autopilots: "自动派活 (Autopilots)",
  inbox: "收件箱 (Inbox)",
  settings: "设置",
} as const;

/** Issue 详情 / 卡片 */
export const ISSUE_UI = {
  working: "执行中",
  activity: "动态",
  properties: "属性",
} as const;

/** Inbox 通知类型 */
export const INBOX_KIND_LABEL: Record<InboxKind, string> = {
  mention: "提及",
  assign: "指派",
  task_failed: "任务失败",
  subscription: "订阅",
};

/** Task 状态 */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  queued: "排队",
  dispatched: "已派活",
  running: "执行中",
  completed: "完成",
  failed: "失败",
  cancelled: "取消",
};

/** Task 触发来源 */
export const TASK_TRIGGER_LABEL: Record<TaskTrigger, string> = {
  assign: "指派",
  status: "状态变更",
  rerun: "重跑",
  create: "创建",
  mention: "提及",
  cron: "定时",
  squad_leader: "小队 Leader",
  squad_member: "小队成员",
  retry: "重试",
};

/** Task 失败原因 */
export const TASK_REASON_LABEL: Record<TaskErrorReason, string> = {
  timeout: "超时",
  runtime_offline: "离线",
  runtime_recovery: "恢复",
  agent_error: "Agent 错误",
  unknown: "未知",
};

/** Autopilot 运行结果 */
export const AUTOPILOT_RUN_STATUS_LABEL: Record<AutopilotRun["status"], string> = {
  ok: "成功",
  failed: "失败",
  skipped: "跳过",
};

/** 指派人：本机用户 */
export const HUMAN_ME_LABEL = "我";

/** @ 提及类型徽章 */
export const ASSIGNEE_KIND_LABEL: Record<"human" | "agent" | "squad", string> = {
  human: "人",
  agent: "Agent",
  squad: "小队",
};
