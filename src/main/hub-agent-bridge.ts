import { createServer, type Server, type IncomingMessage, type ServerResponse } from "http";
import { randomBytes } from "crypto";
import * as issueStore from "./issue-store";
import * as taskStore from "./task-store";
import type {
  IssueCreateInput,
  IssuePriority,
  IssueStatus,
  Task,
} from "../shared/types";
import { IPC } from "../shared/types";

/**
 * 本机 loopback 桥：pi extension 通过 HTTP 调用 Hub Issue API。
 * 仅绑 127.0.0.1；鉴权用 FROMLAN_HUB_BRIDGE_KEY（避开 env 白名单对 *TOKEN* 的剔除）。
 */

export type BridgeBroadcast = (channel: string, payload: unknown) => void;

const VALID_STATUS: ReadonlySet<IssueStatus> = new Set([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
]);

const VALID_PRIORITY: ReadonlySet<IssuePriority> = new Set([
  "urgent",
  "high",
  "medium",
  "low",
]);

let server: Server | null = null;
let port = 0;
let bridgeKey = "";
let broadcast: BridgeBroadcast | null = null;

export function getBridgeEnv(hubSessionId: string): Record<string, string> {
  if (!server || !port) {
    throw new Error("hub-agent-bridge 未启动");
  }
  return {
    FROMLAN_HUB_BRIDGE_URL: `http://127.0.0.1:${port}`,
    FROMLAN_HUB_BRIDGE_KEY: bridgeKey,
    FROMLAN_HUB_SESSION_ID: hubSessionId,
  };
}

export function isBridgeRunning(): boolean {
  return server != null && port > 0;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX = 512 * 1024;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function authorize(req: IncomingMessage): boolean {
  const h = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return !!m && m[1] === bridgeKey;
}

/** 校验 hubSessionId 对应运行中 task，返回该 task。 */
function requireRunningTask(hubSessionId: string): Task {
  const task = taskStore.getTaskBySession(hubSessionId);
  if (!task || task.status !== "running") {
    throw Object.assign(new Error("session 无运行中的 task"), { status: 403 });
  }
  return task;
}

function emitIssue(issue: ReturnType<typeof issueStore.getIssue>): void {
  if (issue && broadcast) broadcast(IPC.issueChanged, issue);
}

function emitComment(c: ReturnType<typeof issueStore.addComment>): void {
  if (broadcast) broadcast(IPC.commentAdded, c);
}

function emitTask(task: Task): void {
  if (broadcast) broadcast(IPC.taskChanged, task);
}

function setAgentStatusOverride(task: Task, status: IssueStatus): void {
  const updated = taskStore.updateTask(task.id, {
    agentStatusOverride: status,
  });
  if (updated) emitTask(updated);
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!authorize(req)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    const url = req.url ?? "";
    const raw = await readBody(req);
    let body: Record<string, unknown> = {};
    if (raw.trim()) {
      body = JSON.parse(raw) as Record<string, unknown>;
    }

    const hubSessionId = String(body.hubSessionId ?? "");
    if (!hubSessionId) {
      sendJson(res, 400, { ok: false, error: "缺少 hubSessionId" });
      return;
    }
    const task = requireRunningTask(hubSessionId);

    if (req.method === "POST" && url === "/v1/issue/status") {
      const status = String(body.status ?? "") as IssueStatus;
      if (!VALID_STATUS.has(status)) {
        sendJson(res, 400, { ok: false, error: `非法 status: ${status}` });
        return;
      }
      const issue = issueStore.setIssueStatus(task.issueId, status);
      if (!issue) {
        sendJson(res, 404, { ok: false, error: "Issue 不存在" });
        return;
      }
      setAgentStatusOverride(task, status);
      emitIssue(issue);
      sendJson(res, 200, { ok: true, issue });
      return;
    }

    if (req.method === "POST" && url === "/v1/issue/blocker") {
      const reason = String(body.reason ?? body.message ?? "Agent 报告阻塞").trim();
      const issue = issueStore.setIssueStatus(task.issueId, "blocked");
      if (!issue) {
        sendJson(res, 404, { ok: false, error: "Issue 不存在" });
        return;
      }
      setAgentStatusOverride(task, "blocked");
      emitIssue(issue);
      const c = issueStore.addComment({
        issueId: task.issueId,
        author: {
          kind: "agent",
          id: task.agentName,
          name: task.agentName,
        },
        body: `[blocker]\n${reason}`,
        mentions: [],
      });
      emitComment(c);
      sendJson(res, 200, { ok: true, issue, comment: c });
      return;
    }

    if (req.method === "POST" && url === "/v1/issue/comment") {
      const text = String(body.body ?? "").trim();
      if (!text) {
        sendJson(res, 400, { ok: false, error: "空评论" });
        return;
      }
      const c = issueStore.addComment({
        issueId: task.issueId,
        author: {
          kind: "agent",
          id: task.agentName,
          name: task.agentName,
        },
        body: text.slice(0, 8000),
        mentions: [],
      });
      emitComment(c);
      sendJson(res, 200, { ok: true, comment: c });
      return;
    }

    if (req.method === "POST" && url === "/v1/issue/create") {
      const title = String(body.title ?? "").trim();
      if (!title) {
        sendJson(res, 400, { ok: false, error: "缺少 title" });
        return;
      }
      const parentIssue = issueStore.getIssue(task.issueId);
      const input: IssueCreateInput = {
        title: title.slice(0, 200),
        description:
          typeof body.description === "string"
            ? body.description.slice(0, 8000)
            : undefined,
        status: "todo",
        priority:
          typeof body.priority === "string" &&
          VALID_PRIORITY.has(body.priority as IssuePriority)
            ? (body.priority as IssuePriority)
            : parentIssue?.priority ?? "medium",
        parent:
          body.parent === true || body.parent === "true"
            ? task.issueId
            : typeof body.parent === "string" && body.parent
              ? body.parent
              : task.issueId,
        projectId: parentIssue?.projectId,
      };
      if (
        typeof body.assigneeKind === "string" &&
        typeof body.assigneeId === "string" &&
        body.assigneeId
      ) {
        const kind = body.assigneeKind as "human" | "agent" | "squad";
        if (kind === "human" || kind === "agent" || kind === "squad") {
          input.assignee = { kind, id: body.assigneeId };
        }
      }
      const issue = issueStore.createIssue(input);
      emitIssue(issue);
      if (broadcast) broadcast(IPC.issueCreated, issue);
      const note = issueStore.addComment({
        issueId: task.issueId,
        author: {
          kind: "agent",
          id: task.agentName,
          name: task.agentName,
        },
        body: `已创建子 Issue ${issue.key}: ${issue.title}`,
        mentions: [],
      });
      emitComment(note);
      sendJson(res, 200, { ok: true, issue });
      return;
    }

    sendJson(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    const err = e as Error & { status?: number };
    sendJson(res, err.status ?? 500, {
      ok: false,
      error: err.message || String(e),
    });
  }
}

export function startHubAgentBridge(bc: BridgeBroadcast): void {
  if (server) return;
  broadcast = bc;
  bridgeKey = randomBytes(24).toString("hex");

  server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  server.listen(0, "127.0.0.1", () => {
    const addr = server?.address();
    if (addr && typeof addr === "object") {
      port = addr.port;
      console.log(`[hub-bridge] listening on 127.0.0.1:${port}`);
    }
  });

  server.on("error", (err) => {
    console.error("[hub-bridge] error:", err);
  });
}

export function stopHubAgentBridge(): void {
  if (!server) return;
  const s = server;
  server = null;
  port = 0;
  bridgeKey = "";
  broadcast = null;
  s.close();
}
