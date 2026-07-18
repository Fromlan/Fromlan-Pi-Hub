import { app } from "electron";
import { join, resolve, sep } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "fs";
import type { SessionSnapshot } from "../shared/types";
import type { MsgData } from "../shared/types";

/**
 * Fromlan Pi Hub 持久化层
 * 数据存放于 {userData}/fromlan-pi-hub/：
 *   sessions.json          — 历史会话索引
 *   messages/{id}.json     — 每个会话的消息数组
 */

const BASE = (() => {
  try {
    return join(app.getPath("userData"), "fromlan-pi-hub");
  } catch {
    // fallback（非 Electron 环境）
    return join(process.cwd(), ".fromlan-pi-hub-data");
  }
})();
const MSGS_DIR = join(BASE, "messages");

/** 仅允许安全标识（UUID 等），防止 `../` 穿越 messages/。 */
const SAFE_SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function assertSafeSessionId(sessionId: string): void {
  if (typeof sessionId !== "string" || !SAFE_SESSION_ID.test(sessionId) || sessionId.includes("..")) {
    throw new Error(`拒绝访问：非法 sessionId`);
  }
}

/** 解析 messages/{id}.json 并确认仍在 MSGS_DIR 内。 */
function messagesPath(sessionId: string): string {
  assertSafeSessionId(sessionId);
  const base = resolve(MSGS_DIR);
  const path = resolve(MSGS_DIR, `${sessionId}.json`);
  const prefix = base.endsWith(sep) ? base : base + sep;
  if (path !== join(base, `${sessionId}.json`) && !path.startsWith(prefix)) {
    throw new Error(`拒绝访问：路径超出 messages 目录`);
  }
  if (path !== resolve(base, `${sessionId}.json`)) {
    throw new Error(`拒绝访问：路径超出 messages 目录`);
  }
  return path;
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function atomicWrite(p: string, data: unknown): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
}

// ── 会话索引 ──

export function saveSessions(sessions: SessionSnapshot[]): void {
  ensureDir(BASE);
  atomicWrite(join(BASE, "sessions.json"), sessions);
}

export function loadSessions(): SessionSnapshot[] {
  ensureDir(BASE);
  const path = join(BASE, "sessions.json");
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as SessionSnapshot[];
  } catch {
    return [];
  }
}

// ── 消息 ──

export function saveMessages(sessionId: string, messages: MsgData[]): void {
  ensureDir(MSGS_DIR);
  const path = messagesPath(sessionId);
  atomicWrite(path, messages);
}

export function loadMessages(sessionId: string): MsgData[] {
  let path: string;
  try {
    path = messagesPath(sessionId);
  } catch {
    return [];
  }
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as MsgData[];
  } catch {
    return [];
  }
}

// ── 删除 ──

export function deleteSessionData(sessionId: string): void {
  let msgPath: string;
  try {
    msgPath = messagesPath(sessionId);
  } catch {
    return;
  }
  if (existsSync(msgPath)) unlinkSync(msgPath);
  // 注意：sessions.json 由调用方负责更新（需要先读再写）
}

// ── 工具 ──

export function getBaseDir(): string {
  return BASE;
}
