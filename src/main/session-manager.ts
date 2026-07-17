import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { join } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import { PiRpcClient } from "./pi-rpc-client";
import * as persistence from "./persistence";
import type {
  SessionSnapshot,
  SessionStatus,
  StartSessionOpts,
  ModelInfo,
  PiEvent,
  MsgData,
} from "../shared/types";

/**
 * 从 pi 自身的 ~/.pi/agent/auth.json 读取已配置的 provider。
 * 找不到或解析失败时回退到 ["anthropic","openai","google"] 等常见名。
 */
function readConfiguredProviders(): string[] {
  const fallback = ["anthropic", "openai", "google", "azure", "bedrock"];
  try {
    const authPath = join(homedir(), ".pi", "agent", "auth.json");
    if (!existsSync(authPath)) return fallback;
    const raw = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
    const keys = Object.keys(raw);
    if (keys.length === 0) return fallback;
    return keys;
  } catch {
    return fallback;
  }
}

interface ManagedSession {
  id: string;
  provider: string;
  model: string;
  cwd?: string;
  title: string;
  status: SessionStatus;
  messageCount: number;
  pendingMessageCount: number;
  piSessionId?: string;
  createdAt: number;
  lastActivityAt: number;
  agentName?: string;
  client: PiRpcClient;
}

/**
 * 管理多个 PiRpcClient 实例，每个对应一个对话标签。
 *
 * 事件：
 * - "spawned"(snapshot) / "killed"(id) / "change"(snapshot)
 * - "event"({ sessionId, event })  转发底层 pi 事件流
 */
export class SessionManager extends EventEmitter {
  private sessions = new Map<string, ManagedSession>();
  private _persistedSessions: SessionSnapshot[] = [];

  /** 创建一个新的 pi session 并等待其就绪。 */
  async start(opts: StartSessionOpts): Promise<SessionSnapshot> {
    const id = randomUUID();
    const client = new PiRpcClient({
      provider: opts.provider,
      model: opts.model,
      cwd: opts.cwd,
      noSession: opts.noSession ?? false,
      agentName: opts.agentName,
    });
    const session: ManagedSession = {
      id,
      provider: opts.provider,
      model: opts.model,
      cwd: opts.cwd,
      title: opts.title ?? opts.model,
      status: "starting",
      messageCount: 0,
      pendingMessageCount: 0,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      agentName: opts.agentName,
      client,
    };
    this.sessions.set(id, session);

    client.on("event", (event: PiEvent) => this.handleEvent(id, event));
    client.on("error", (err) => {
      // EventEmitter 在无 error 监听时会抛未捕获异常把主进程带崩，
      // 这里兜底打印；同时记录到状态机以让 UI 能感知。
      console.error(`[pi-rpc ${id}] error:`, err);
      if (this.sessions.has(id)) {
        session.status = "exited";
        this.emit("change", this.toSnapshot(session));
      }
    });
    client.on("exit", () => {
      session.status = "exited";
      this.emit("change", this.toSnapshot(session));
      // 进程意外退出时自动持久化；kill() 已从 sessions 中 delete 了条目，不会重复
      if (this.sessions.has(id) && session.messageCount > 0) {
        this.sessions.delete(id);
        const snap = this.toSnapshot(session);
        snap.status = "exited";
        this._persistedSessions.push(snap);
        persistence.saveSessions(this._persistedSessions);
        this.emit("killed", id);
      }
    });

    try {
      const state = await client.send<{
        sessionId?: string;
        messageCount?: number;
        pendingMessageCount?: number;
      }>({ type: "get_state" });
      session.piSessionId = state?.sessionId;
      session.messageCount = state?.messageCount ?? 0;
      session.pendingMessageCount = state?.pendingMessageCount ?? 0;
      session.status = "idle";
    } catch {
      session.status = "exited";
    }

    const snap = this.toSnapshot(session);
    this.emit("spawned", snap);
    this.emit("change", snap);
    return snap;
  }

  /** 向已存在的 session 灌入一条消息（流式，结果通过 "event" 推回）。 */
  prompt(id: string, message: string): { sent: boolean } {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    const command: Record<string, unknown> = { type: "prompt", message };
    // 若 agent 正在流式运行，必须指定 streamingBehavior 才能入队。
    if (session.status === "busy" || session.status === "compacting") {
      command.streamingBehavior = "steer";
    }
    session.client.sendFireAndForget(command);
    session.lastActivityAt = Date.now();
    return { sent: true };
  }

  /** 在流式运行中插入一条转向消息。 */
  steer(id: string, message: string): { sent: boolean } {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Session ${id} not found`);
    session.client.sendFireAndForget({ type: "steer", message });
    session.lastActivityAt = Date.now();
    return { sent: true };
  }

  async abort(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    // abort 本质是通知 pi 停止流式响应，pi 不会回送 response，
    // 用 send 等响应可能永久 pending。改为 fire-and-forget。
    try {
      session.client.sendFireAndForget({ type: "abort" });
    } catch {
      // 进程可能已退出，忽略
    }
  }

  async kill(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    // 先删除（这样 exit 回调看到 !this.sessions.has(id) 就不会重复持久化）
    this.sessions.delete(id);
    await session.client.close();
    // 保存到历史列表，标记为已退出
    const snap = this.toSnapshot(session);
    snap.status = "exited";
    this._persistedSessions.push(snap);
    persistence.saveSessions(this._persistedSessions);
    this.emit("killed", id);
  }

  async killAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.kill(id)));
  }

  // ── 持久化 / 历史会话 ──

  persistedSessions(): SessionSnapshot[] {
    return this._persistedSessions;
  }

  loadPersisted(): void {
    this._persistedSessions = persistence.loadSessions();
  }

  async resume(id: string): Promise<SessionSnapshot> {
    // 从历史记录中找到对应会话元数据
    const idx = this._persistedSessions.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`Persisted session ${id} not found`);
    const old = this._persistedSessions[idx];

    // 从历史移除
    this._persistedSessions.splice(idx, 1);

    const client = new PiRpcClient({
      provider: old.provider,
      model: old.model,
      cwd: old.cwd,
      noSession: false,
      sessionId: old.piSessionId,
      agentName: old.agentName,
    });
    const session: ManagedSession = {
      id,
      provider: old.provider,
      model: old.model,
      cwd: old.cwd,
      title: old.title,
      status: "starting",
      messageCount: old.messageCount,
      pendingMessageCount: 0,
      createdAt: old.createdAt,
      lastActivityAt: Date.now(),
      agentName: old.agentName,
      client,
    };
    this.sessions.set(id, session);

    client.on("event", (event: PiEvent) => this.handleEvent(id, event));
    client.on("error", (err) => {
      // EventEmitter 在无 error 监听时会抛未捕获异常把主进程带崩，
      // 这里兜底打印；同时记录到状态机以让 UI 能感知。
      console.error(`[pi-rpc ${id}] error:`, err);
      if (this.sessions.has(id)) {
        session.status = "exited";
        this.emit("change", this.toSnapshot(session));
      }
    });
    client.on("exit", () => {
      session.status = "exited";
      this.emit("change", this.toSnapshot(session));
      // 进程意外退出时自动持久化；kill() 已从 sessions 中 delete 了条目，不会重复
      if (this.sessions.has(id) && session.messageCount > 0) {
        this.sessions.delete(id);
        const snap = this.toSnapshot(session);
        snap.status = "exited";
        this._persistedSessions.push(snap);
        persistence.saveSessions(this._persistedSessions);
        this.emit("killed", id);
      }
    });

    try {
      const state = await client.send<{
        sessionId?: string;
        messageCount?: number;
        pendingMessageCount?: number;
      }>({ type: "get_state" });
      session.piSessionId = state?.sessionId;
      session.messageCount = state?.messageCount ?? old.messageCount;
      session.pendingMessageCount = state?.pendingMessageCount ?? 0;
      session.status = "idle";
    } catch {
      session.status = "exited";
    }

    const snap = this.toSnapshot(session);
    // 重新持久化会话列表（移除了该条目）
    persistence.saveSessions(this._persistedSessions);
    this.emit("spawned", snap);
    this.emit("change", snap);
    return snap;
  }

  getPersistedMessages(id: string): MsgData[] {
    return persistence.loadMessages(id);
  }

  saveMessagesFromRenderer(id: string, messages: MsgData[]): void {
    persistence.saveMessages(id, messages);
  }

  deletePersisted(id: string): void {
    persistence.deleteSessionData(id);
    this._persistedSessions = this._persistedSessions.filter((s) => s.id !== id);
    persistence.saveSessions(this._persistedSessions);
  }

  updateTitle(id: string, title: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    const trimmed = title.trim();
    if (!trimmed) return false;
    session.title = trimmed;
    this.emit("change", this.toSnapshot(session));
    return true;
  }

  /** 拉取某个 session 的全部消息（用于历史回填）。 */
  async getMessages(id: string): Promise<unknown[]> {
    const session = this.sessions.get(id);
    if (!session) return [];
    try {
      const data = await session.client.send<{ messages?: unknown[] }>({
        type: "get_messages",
      });
      return data?.messages ?? [];
    } catch {
      return [];
    }
  }

  /** 拉取可用模型列表（get_available_models）。若无 session 则临时起一个探测进程。 */
  async getModels(id?: string): Promise<ModelInfo[]> {
    const existing = id ? this.sessions.get(id) : undefined;
    if (existing) {
      return this.queryModels(existing.client);
    }
    // 临时探测进程：从 pi 自带的 auth.json 读已配置的 provider，
    // 逐个尝试拉取模型列表；任何一个成功即返回（避免依赖硬编码 provider）。
    const providers = readConfiguredProviders();
    for (const provider of providers) {
      const probe = new PiRpcClient({ provider, model: "*", noSession: true });
      try {
        const models = await this.queryModels(probe);
        if (models.length > 0) return models;
      } catch {
        // 该 provider 起不来或无模型，尝试下一个
      } finally {
        await probe.close();
      }
    }
    return [];
  }

  private async queryModels(client: PiRpcClient): Promise<ModelInfo[]> {
    try {
      const data = await client.send<{ models?: Array<Record<string, unknown>> }>({
        type: "get_available_models",
      });
      const models = data?.models ?? [];
      return models.map((m) => ({
        provider: String(m.provider ?? ""),
        id: String(m.id ?? ""),
        name: String(m.name ?? m.id ?? ""),
      }));
    } catch {
      return [];
    }
  }

  list(): SessionSnapshot[] {
    return Array.from(this.sessions.values()).map((s) => this.toSnapshot(s));
  }

  get(id: string): SessionSnapshot | undefined {
    const s = this.sessions.get(id);
    return s ? this.toSnapshot(s) : undefined;
  }

  activeCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.status !== "exited") n++;
    }
    return n;
  }

  private handleEvent(id: string, event: PiEvent): void {
    const session = this.sessions.get(id);
    if (!session) return;
    switch (event.type) {
      case "agent_start":
      case "turn_start":
        session.status = "busy";
        break;
      case "agent_settled":
      case "agent_end":
      case "turn_end":
        session.status = "idle";
        break;
      case "compaction_start":
        session.status = "compacting";
        break;
      case "compaction_end":
        session.status = "idle";
        break;
      case "message_end": {
        // 只统计 assistant 消息，与 pi 内部 messageCount 语义一致。
        // (user 消息走 get_state 初始化 / message_start 时已计入)
        const msg = event.message as { role?: string } | undefined;
        if (msg?.role === "assistant") {
          session.messageCount = (session.messageCount ?? 0) + 1;
        }
        break;
      }
    }
    session.lastActivityAt = Date.now();
    this.emit("event", { sessionId: id, event });
    this.emit("change", this.toSnapshot(session));
  }

  private toSnapshot(s: ManagedSession): SessionSnapshot {
    return {
      id: s.id,
      provider: s.provider,
      model: s.model,
      cwd: s.cwd,
      title: s.title,
      status: s.status,
      messageCount: s.messageCount,
      pendingMessageCount: s.pendingMessageCount,
      piSessionId: s.piSessionId,
      pid: s.client.pid,
      createdAt: s.createdAt,
      lastActivityAt: s.lastActivityAt,
      agentName: s.agentName,
    };
  }
}
