import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getBaseDir } from "./persistence";
import type {
  Issue,
  Comment,
  IssueCreateInput,
  IssueStatus,
  Assignee,
} from "../shared/types";

/**
 * Issue / Comment 持久化层。
 *
 * 文件：
 *   {userData}/lite-pi/issues.json     — envelope: { schemaVersion, issues, nextKeySeq }
 *   {userData}/lite-pi/comments.json   — Comment[]
 *
 * 写盘用 tmp + rename 原子替换（同卷下原子，跨卷失败则 tmp 残留，下次启动覆盖）。
 * 不迁移历史数据；旧用户首次升级时 envelope 缺失 → 视为空。
 */

const ISSUES_FILE = join(getBaseDir(), "issues.json");
const COMMENTS_FILE = join(getBaseDir(), "comments.json");
const SCHEMA_VERSION = 1;

interface IssuesEnvelope {
  schemaVersion: number;
  issues: Issue[];
  nextKeySeq: number;
}

function atomicWrite(p: string, data: unknown): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
}

function loadEnv(): IssuesEnvelope {
  if (!existsSync(ISSUES_FILE))
    return { schemaVersion: SCHEMA_VERSION, issues: [], nextKeySeq: 1 };
  try {
    const env = JSON.parse(readFileSync(ISSUES_FILE, "utf8")) as IssuesEnvelope;
    if (env.schemaVersion !== SCHEMA_VERSION) {
      console.warn("[issue-store] schema mismatch, resetting");
      return { schemaVersion: SCHEMA_VERSION, issues: [], nextKeySeq: 1 };
    }
    return env;
  } catch {
    return { schemaVersion: SCHEMA_VERSION, issues: [], nextKeySeq: 1 };
  }
}

function loadComments(): Comment[] {
  if (!existsSync(COMMENTS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(COMMENTS_FILE, "utf8")) as Comment[];
  } catch {
    return [];
  }
}

const env: IssuesEnvelope = loadEnv();
let comments: Comment[] = loadComments();

// ── Issue CRUD ──

export function listIssues(): Issue[] {
  return env.issues.slice();
}

export function getIssue(id: string): Issue | undefined {
  return env.issues.find((i) => i.id === id);
}

export function createIssue(input: IssueCreateInput): Issue {
  const now = Date.now();
  const issue: Issue = {
    id: randomUUID(),
    key: `LSN-${env.nextKeySeq++}`,
    title: input.title,
    description: input.description,
    status: input.status ?? "backlog",
    priority: input.priority ?? "medium",
    assignee: input.assignee ?? { kind: "human", id: "default" },
    parent: input.parent,
    createdAt: now,
    updatedAt: now,
    dueDate: input.dueDate,
  };
  env.issues.push(issue);
  atomicWrite(ISSUES_FILE, env);
  return issue;
}

export function updateIssue(
  id: string,
  patch: Partial<Omit<Issue, "id" | "key" | "createdAt">>
): Issue | undefined {
  const idx = env.issues.findIndex((i) => i.id === id);
  if (idx === -1) return undefined;
  env.issues[idx] = { ...env.issues[idx], ...patch, updatedAt: Date.now() };
  atomicWrite(ISSUES_FILE, env);
  return env.issues[idx];
}

export function setIssueStatus(id: string, status: IssueStatus): Issue | undefined {
  return updateIssue(id, { status });
}

export function assignIssue(id: string, assignee: Assignee): Issue | undefined {
  return updateIssue(id, { assignee });
}

export function deleteIssue(id: string): boolean {
  const idx = env.issues.findIndex((i) => i.id === id);
  if (idx === -1) return false;
  env.issues.splice(idx, 1);
  comments = comments.filter((c) => c.issueId !== id);
  atomicWrite(ISSUES_FILE, env);
  atomicWrite(COMMENTS_FILE, comments);
  return true;
}

// ── Comment CRUD ──

export function listComments(issueId: string): Comment[] {
  return comments.filter((c) => c.issueId === issueId);
}

export function addComment(
  input: Omit<Comment, "id" | "createdAt">
): Comment {
  const c: Comment = {
    id: randomUUID(),
    createdAt: Date.now(),
    ...input,
  };
  comments.push(c);
  atomicWrite(COMMENTS_FILE, comments);
  return c;
}

export function deleteComment(id: string): boolean {
  const idx = comments.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  comments.splice(idx, 1);
  atomicWrite(COMMENTS_FILE, comments);
  return true;
}
