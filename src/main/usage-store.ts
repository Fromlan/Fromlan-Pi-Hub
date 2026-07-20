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
/** 保留最近 N 天原始记录。 */
const RETENTION_DAYS = 90;
/** 同一 session 只记一次（会话级累计快照）。 */
const recordedSessions = new Set<string>();

function ensureDir(): void {
  const dir = dirname(USAGE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function atomicWriteText(p: string, text: string): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, p);
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

/** 裁剪超出保留期的记录（写回整文件）。 */
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

export function appendRecord(
  input: Omit<UsageRecord, "id" | "createdAt"> & { createdAt?: number }
): UsageRecord | null {
  if (input.sessionId && recordedSessions.has(input.sessionId)) {
    return null;
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
  // 全零且无 cost 则跳过（探测进程 / 空会话）
  const total =
    record.inputTokens +
    record.outputTokens +
    record.cacheReadTokens +
    record.cacheWriteTokens;
  if (total === 0 && record.costUsd === 0) {
    if (input.sessionId) recordedSessions.add(input.sessionId);
    return null;
  }
  ensureDir();
  appendFileSync(USAGE_FILE, JSON.stringify(record) + "\n", "utf8");
  if (input.sessionId) recordedSessions.add(input.sessionId);
  return record;
}

export function listByIssue(issueId: string): UsageRecord[] {
  return loadAll()
    .filter((r) => r.issueId === issueId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function clearUsage(): void {
  recordedSessions.clear();
  ensureDir();
  if (existsSync(USAGE_FILE)) {
    try {
      unlinkSync(USAGE_FILE);
    } catch {
      atomicWriteText(USAGE_FILE, "");
    }
  }
}

export function summarize(query: UsageSummaryQuery = {}): UsageSummaryResult {
  const days = Math.max(1, Math.min(365, query.days ?? 30));
  const projectId = query.projectId || undefined;
  const provider = query.provider || undefined;
  const agentNameFilter = query.agentName || undefined;
  let records = pruneIfNeeded(loadAll());
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
