import { app } from "electron";
import { join } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "fs";
import type { SessionSnapshot } from "../shared/types";
import type { MsgData } from "../shared/types";

/**
 * Lite-Pi 持久化层
 * 数据存放于 {userData}/lite-pi/：
 *   sessions.json          — 历史会话索引
 *   messages/{id}.json     — 每个会话的消息数组
 */

const BASE = (() => {
  try {
    return join(app.getPath("userData"), "lite-pi");
  } catch {
    // fallback（非 Electron 环境）
    return join(process.cwd(), ".lite-pi-data");
  }
})();
const MSGS_DIR = join(BASE, "messages");

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
  writeFileSync(
    join(MSGS_DIR, `${sessionId}.json`),
    JSON.stringify(messages, null, 2),
    "utf8"
  );
}

export function loadMessages(sessionId: string): MsgData[] {
  const path = join(MSGS_DIR, `${sessionId}.json`);
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
  // 删消息文件
  const msgPath = join(MSGS_DIR, `${sessionId}.json`);
  if (existsSync(msgPath)) unlinkSync(msgPath);
  // 注意：sessions.json 由调用方负责更新（需要先读再写）
}

// ── 工具 ──

export function getBaseDir(): string {
  return BASE;
}
