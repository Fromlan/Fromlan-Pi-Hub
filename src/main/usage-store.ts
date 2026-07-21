import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
  unlinkSync,
  mkdirSync,
} from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import { getBaseDir } from "./persistence";
import * as issueStore from "./issue-store";
import * as projectStore from "./project-store";
import type {
  UsageAgentRow,
  UsageRecord,
  UsageDailyPoint,
  UsageModelRow,
  UsageProviderRow,
  UsageIssueRow,
  UsageRecentRow,
  UsageSummaryQuery,
  UsageSummaryResult,
  TaskUsageSnapshot,
} from "../shared/types";

/**
 * 用量记录：追加写 jsonl，按需扫描汇总（Multica task_usage 本地切片）。
 * 文件：{userData}/fromlan-pi-hub/usage-records.jsonl
 */

const USAGE_FILE = join(getBaseDir(), "usage-records.jsonl");
/** 进程级去重持久化：跨重启仍能识别"已写过此 sessionId"。原子写避免丢行。 */
const RECORDED_FILE = join(getBaseDir(), "usage-recorded-sessions.json");
/** 保留最近 N 天原始记录。 */
const RETENTION_DAYS = 90;
/** 同一 session 只记一次（会话级累计快照）。 */
const recordedSessions = new Set<string>();
let recordedLoaded = false;

/**
 * 进程内写串行链：appendFileSync 与 pruneIfNeeded 全量重写都走此 Promise chain，
 * 杜绝 append 与 rename 竞争丢行。所有调用 await writeChain 即可排队执行。
 */
let writeChain: Promise<unknown> = Promise.resolve();

function ensureDir(): void {
  const dir = dirname(USAGE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function atomicWriteText(p: string, text: string): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, p);
}

function atomicWriteJson(p: string, data: unknown): void {
  atomicWriteText(p, JSON.stringify(data, null, 2));
}

/** 首次访问 recordedSessions 时从磁盘恢复（保证跨重启去重）。 */
function ensureRecordedLoaded(): void {
  if (recordedLoaded) return;
  recordedLoaded = true;
  if (!existsSync(RECORDED_FILE)) return;
  try {
    const arr = JSON.parse(readFileSync(RECORDED_FILE, "utf8")) as unknown;
    if (Array.isArray(arr)) {
      for (const s of arr) {
        if (typeof s === "string") recordedSessions.add(s);
      }
    }
  } catch {
    // 损坏的 recordedFile 不致命，下次启动自然重建
  }
}

/** 串行化：把 recordedSessions 落盘（tmp + rename）。 */
function persistRecorded(): void {
  atomicWriteJson(RECORDED_FILE, Array.from(recordedSessions));
}

function parseLine(line: string): UsageRecord | null {
  const t = line.trim();
  if (!t) return null;
  try {
    const raw = JSON.parse(t) as UsageRecord;
    if (!raw || typeof raw.id !== "string") return null;
    return {
      id: raw.id,
      sessionId: raw.sessionId,
      taskId: raw.taskId,
      issueId: raw.issueId,
      agentName: raw.agentName,
      provider: String(raw.provider ?? ""),
      model: String(raw.model ?? ""),
      inputTokens: Number(raw.inputTokens) || 0,
      outputTokens: Number(raw.outputTokens) || 0,
      cacheReadTokens: Number(raw.cacheReadTokens) || 0,
      cacheWriteTokens: Number(raw.cacheWriteTokens) || 0,
      costUsd: Number(raw.costUsd) || 0,
      createdAt: Number(raw.createdAt) || 0,
    };
  } catch {
    return null;
  }
}

function loadAll(): UsageRecord[] {
  if (!existsSync(USAGE_FILE)) return [];
  try {
    const text = readFileSync(USAGE_FILE, "utf8");
    const out: UsageRecord[] = [];
    for (const line of text.split(/\r?\n/)) {
      const r = parseLine(line);
      if (r) out.push(r);
    }
    return out;
  } catch {
    return [];
  }
}

function localDateKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayStartMs(daysAgo: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

/** 裁剪超出保留期的记录（写回整文件）。仅在 records 确实变化时落盘。
 *  调用方应通过 writeChain 串行化此操作与 appendRecord。 */
function pruneIfNeeded(records: UsageRecord[]): UsageRecord[] {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const kept = records.filter((r) => r.createdAt >= cutoff);
  if (kept.length === records.length) return records;
  ensureDir();
  const body = kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length ? "\n" : "");
  atomicWriteText(USAGE_FILE, body);
  return kept;
}

export function toTaskUsageSnapshot(r: Pick<
  UsageRecord,
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "costUsd"
>): TaskUsageSnapshot {
  return {
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    cacheReadTokens: r.cacheReadTokens,
    cacheWriteTokens: r.cacheWriteTokens,
    costUsd: r.costUsd,
  };
}

/**
 * 追加一条用量记录。返回 Promise：调用方 await 即串行化，避免 appendFileSync 与
 * pruneIfNeeded 全量重写竞争丢行。同一 sessionId 跨重启不再重复写。
 * 全零且无 cost 的记录仅 add 到 recordedSessions（不写盘）。
 */
export function appendRecord(
  input: Omit<UsageRecord, "id" | "createdAt"> & { createdAt?: number }
): Promise<UsageRecord | null> {
  ensureRecordedLoaded();
  // 同步 fast-path：已知 session 已写过，直接返回 null，不入队。
  if (input.sessionId && recordedSessions.has(input.sessionId)) {
    return Promise.resolve(null);
  }
  const record: UsageRecord = {
    id: randomUUID(),
    sessionId: input.sessionId,
    taskId: input.taskId,
    issueId: input.issueId,
    agentName: input.agentName,
    provider: input.provider,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheReadTokens: input.cacheReadTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    costUsd: input.costUsd,
    createdAt: input.createdAt ?? Date.now(),
  };
  const total =
    record.inputTokens +
    record.outputTokens +
    record.cacheReadTokens +
    record.cacheWriteTokens;

  const next = writeChain.then(async () => {
    // 在串行链内二次检查：避免 has/add 之间的 race（其它 append 可能已写入并 add）。
    if (input.sessionId && recordedSessions.has(input.sessionId)) {
      return null as UsageRecord | null;
    }
    if (total === 0 && record.costUsd === 0) {
      // 全零跳过：不写盘，但仍标记已处理（避免下次重复试探）
      if (input.sessionId) {
        recordedSessions.add(input.sessionId);
        persistRecorded();
      }
      return null as UsageRecord | null;
    }
    ensureDir();
    appendFileSync(USAGE_FILE, JSON.stringify(record) + "\n", "utf8");
    if (input.sessionId) {
      recordedSessions.add(input.sessionId);
      persistRecorded();
    }
    return record as UsageRecord | null;
  });
  // 防止 writeChain 上挂未捕获异常导致后续调用 hang 死。
  writeChain = next.catch(() => undefined);
  return next;
}

export function listByIssue(issueId: string): UsageRecord[] {
  return loadAll()
    .filter((r) => r.issueId === issueId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function clearUsage(): void {
  recordedSessions.clear();
  recordedLoaded = true;
  ensureDir();
  if (existsSync(USAGE_FILE)) {
    try {
      unlinkSync(USAGE_FILE);
    } catch {
      atomicWriteText(USAGE_FILE, "");
    }
  }
  if (existsSync(RECORDED_FILE)) {
    try {
      unlinkSync(RECORDED_FILE);
    } catch {
      atomicWriteText(RECORDED_FILE, "[]");
    }
  }
}

/** 汇总接口。async 以便 await 串行链：保证 prune 看到的写入已全部落盘，避免丢行。 */
export async function summarize(query: UsageSummaryQuery = {}): Promise<UsageSummaryResult> {
  // 先排空写链：让所有挂起的 appendRecord 完成
  await writeChain;
  const days = Math.max(1, Math.min(365, query.days ?? 30));
  const projectId = query.projectId || undefined;
  const provider = query.provider || undefined;
  const agentNameFilter = query.agentName || undefined;
  // prune 也走 writeChain（写盘动作），与后续 append 串行
  let records: UsageRecord[] = loadAll();
  const pruneTask = writeChain.then(() => pruneIfNeeded(records));
  writeChain = pruneTask.catch(() => undefined);
  records = await pruneTask;
  const since = dayStartMs(days - 1);

  if (projectId) {
    const issueIds = new Set(
      issueStore
        .listIssues()
        .filter((i) => i.projectId === projectId)
        .map((i) => i.id)
    );
    records = records.filter((r) => r.issueId && issueIds.has(r.issueId));
  }

  records = records.filter((r) => r.createdAt >= since);

  const normalizeAgentName = (a: string | undefined): string =>
    a && a.trim().length ? a : "";

  if (provider) {
    records = records.filter((r) => r.provider === provider);
  }
  if (agentNameFilter) {
    if (agentNameFilter === "__none__") {
      records = records.filter((r) => !normalizeAgentName(r.agentName));
    } else {
      records = records.filter(
        (r) => normalizeAgentName(r.agentName) === agentNameFilter
      );
    }
  }

  const dailyMap = new Map<string, UsageDailyPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const key = localDateKey(dayStartMs(i));
    dailyMap.set(key, {
      date: key,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      runCount: 0,
    });
  }

  const modelMap = new Map<string, UsageModelRow>();
  const agentMap = new Map<string, UsageAgentRow>();
  const providerMap = new Map<string, UsageProviderRow>();
  const issueMap = new Map<string, UsageIssueRow>();

  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    runCount: 0,
  };

  const projectNameById = new Map(
    projectStore.listProjects().map((p) => [p.id, p.name] as const)
  );
  const issueMetaById = new Map<
    string,
    {
      issueKey: string;
      issueTitle: string;
      projectId?: string;
      projectName?: string;
    }
  >();
  for (const i of issueStore.listIssues()) {
    issueMetaById.set(i.id, {
      issueKey: i.key,
      issueTitle: i.title,
      projectId: i.projectId,
      projectName: i.projectId ? projectNameById.get(i.projectId) : undefined,
    });
  }

  for (const r of records) {
    const key = localDateKey(r.createdAt);
    const day = dailyMap.get(key);
    if (day) {
      day.inputTokens += r.inputTokens;
      day.outputTokens += r.outputTokens;
      day.cacheReadTokens += r.cacheReadTokens;
      day.cacheWriteTokens += r.cacheWriteTokens;
      day.costUsd += r.costUsd;
      day.runCount += 1;
    }

    const mk = `${r.provider}\0${r.model}`;
    let row = modelMap.get(mk);
    if (!row) {
      row = {
        provider: r.provider,
        model: r.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        runCount: 0,
      };
      modelMap.set(mk, row);
    }
    row.inputTokens += r.inputTokens;
    row.outputTokens += r.outputTokens;
    row.cacheReadTokens += r.cacheReadTokens;
    row.cacheWriteTokens += r.cacheWriteTokens;
    row.costUsd += r.costUsd;
    row.runCount += 1;

    totals.inputTokens += r.inputTokens;
    totals.outputTokens += r.outputTokens;
    totals.cacheReadTokens += r.cacheReadTokens;
    totals.cacheWriteTokens += r.cacheWriteTokens;
    totals.costUsd += r.costUsd;
    totals.runCount += 1;

    // By agent
    const aKey = normalizeAgentName(r.agentName);
    let aRow = agentMap.get(aKey);
    if (!aRow) {
      aRow = {
        agentName: aKey,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        runCount: 0,
      };
      agentMap.set(aKey, aRow);
    }
    aRow.inputTokens += r.inputTokens;
    aRow.outputTokens += r.outputTokens;
    aRow.cacheReadTokens += r.cacheReadTokens;
    aRow.cacheWriteTokens += r.cacheWriteTokens;
    aRow.costUsd += r.costUsd;
    aRow.runCount += 1;

    // By provider
    const pKey = r.provider;
    let pRow = providerMap.get(pKey);
    if (!pRow) {
      pRow = {
        provider: pKey,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        runCount: 0,
      };
      providerMap.set(pKey, pRow);
    }
    pRow.inputTokens += r.inputTokens;
    pRow.outputTokens += r.outputTokens;
    pRow.cacheReadTokens += r.cacheReadTokens;
    pRow.cacheWriteTokens += r.cacheWriteTokens;
    pRow.costUsd += r.costUsd;
    pRow.runCount += 1;

    // By issue
    if (r.issueId) {
      const meta = issueMetaById.get(r.issueId);
      let iRow = issueMap.get(r.issueId);
      if (!iRow) {
        iRow = {
          issueId: r.issueId,
          issueKey: meta?.issueKey ?? r.issueId,
          issueTitle: meta?.issueTitle ?? r.issueId,
          projectId: meta?.projectId,
          projectName: meta?.projectName,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0,
          runCount: 0,
        };
        issueMap.set(r.issueId, iRow);
      }
      iRow.inputTokens += r.inputTokens;
      iRow.outputTokens += r.outputTokens;
      iRow.cacheReadTokens += r.cacheReadTokens;
      iRow.cacheWriteTokens += r.cacheWriteTokens;
      iRow.costUsd += r.costUsd;
      iRow.runCount += 1;
    }
  }

  const byModel = Array.from(modelMap.values()).sort(
    (a, b) => b.costUsd - a.costUsd || b.runCount - a.runCount
  );

  const byAgent = Array.from(agentMap.values()).sort(
    (a, b) => b.costUsd - a.costUsd || b.runCount - a.runCount
  );
  const byProvider = Array.from(providerMap.values()).sort(
    (a, b) => b.costUsd - a.costUsd || b.runCount - a.runCount
  );
  const byIssue = Array.from(issueMap.values()).sort(
    (a, b) => b.costUsd - a.costUsd || b.runCount - a.runCount
  );

  const recentRecords = [...records]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50);

  const recent: UsageRecentRow[] = recentRecords.map((r) => {
    const meta = r.issueId ? issueMetaById.get(r.issueId) : undefined;
    return {
      ...r,
      issueKey: meta?.issueKey,
      issueTitle: meta?.issueTitle,
      projectName: meta?.projectName,
    };
  });

  return {
    days,
    projectId,
    provider,
    agentName: agentNameFilter,
    daily: Array.from(dailyMap.values()),
    byModel,
    byAgent,
    byProvider,
    byIssue,
    recent,
    totals,
  };
}

/** 解析 get_session_stats 响应。 */
export function parseSessionStats(data: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
} | null {
  if (!data || typeof data !== "object") return null;
  const d = data as {
    tokens?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
    cost?: number | { total?: number };
  };
  const tokens = d.tokens ?? {};
  let costUsd = 0;
  if (typeof d.cost === "number") costUsd = d.cost;
  else if (d.cost && typeof d.cost === "object" && typeof d.cost.total === "number") {
    costUsd = d.cost.total;
  }
  return {
    inputTokens: Number(tokens.input) || 0,
    outputTokens: Number(tokens.output) || 0,
    cacheReadTokens: Number(tokens.cacheRead) || 0,
    cacheWriteTokens: Number(tokens.cacheWrite) || 0,
    costUsd,
  };
}
