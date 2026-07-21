import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  chmodSync,
} from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { getBaseDir } from "./persistence";
import type {
  ProviderAuthType,
  ProviderListResult,
  ProviderProfile,
  ProviderProfilePublic,
  ProviderProfileUpsertInput,
} from "../shared/types";

/**
 * Hub 订阅 Profile：本机 CRUD + 一键激活写回 ~/.pi/agent/auth.json（及可选 models.json）。
 * 密钥落盘在 {userData}/fromlan-pi-hub/provider-profiles.json（尽量 0600）。
 */

const STORE_FILE = join(getBaseDir(), "provider-profiles.json");
const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const AUTH_FILE = join(PI_AGENT_DIR, "auth.json");
const MODELS_FILE = join(PI_AGENT_DIR, "models.json");

const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface StoreData {
  activeProfileId: string | null;
  profiles: ProviderProfile[];
}

function atomicWriteJson(p: string, data: unknown): void {
  const dir = dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
  try {
    chmodSync(p, 0o600);
  } catch {
    // Windows 可能忽略 chmod
  }
}

function load(): StoreData {
  if (!existsSync(STORE_FILE)) {
    return { activeProfileId: null, profiles: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(STORE_FILE, "utf8")) as StoreData;
    return {
      activeProfileId: raw.activeProfileId ?? null,
      profiles: Array.isArray(raw.profiles) ? raw.profiles : [],
    };
  } catch {
    return { activeProfileId: null, profiles: [] };
  }
}

let data: StoreData = load();

function save(): void {
  atomicWriteJson(STORE_FILE, data);
}

/**
 * 进程内写串行链：避免并发 IPC handler 交错覆盖 profile 状态与 auth.json。
 * 所有修改 data 的入口都包到 chain.then 中即可；纯读 (listProfiles/getSecret) 保持同步。
 */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => T): Promise<T> {
  const next = writeChain.then(fn);
  writeChain = next.catch(() => undefined);
  return next as Promise<T>;
}

function saveSynced(): void {
  atomicWriteJson(STORE_FILE, data);
}

function keyMask(key?: string): string {
  if (!key || key.length === 0) return "";
  if (key.length <= 4) return "****";
  return `…${key.slice(-4)}`;
}

export function toPublic(p: ProviderProfile): ProviderProfilePublic {
  return {
    id: p.id,
    name: p.name,
    providerId: p.providerId,
    authType: p.authType,
    hasKey: Boolean(p.apiKey && p.apiKey.length > 0),
    keyMask: keyMask(p.apiKey),
    baseUrl: p.baseUrl,
    notes: p.notes,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    active: data.activeProfileId === p.id,
  };
}

export function listProfiles(): ProviderListResult {
  return {
    profiles: data.profiles.map(toPublic),
    activeProfileId: data.activeProfileId,
  };
}

function assertProviderId(id: string): void {
  if (!PROVIDER_ID_RE.test(id)) {
    throw new Error(
      "无效 providerId（小写字母开头，仅 a-z0-9._-，最长 64）"
    );
  }
}

export async function upsertProfile(
  input: ProviderProfileUpsertInput
): Promise<ProviderProfilePublic> {
  return enqueue(() => {
  const name = input.name.trim();
  const providerId = input.providerId.trim().toLowerCase();
  if (!name) throw new Error("名称不能为空");
  assertProviderId(providerId);

  const authType: ProviderAuthType = input.authType ?? "api_key";
  const now = Date.now();

  if (input.id) {
    const idx = data.profiles.findIndex((p) => p.id === input.id);
    if (idx === -1) throw new Error("Profile 不存在");
    const prev = data.profiles[idx];
    if (prev.authType === "oauth_placeholder" && authType === "api_key") {
      // 允许从 oauth 转为 api_key（用户补 key）
    }
    if (prev.authType === "oauth_placeholder" && !input.apiKey) {
      // 保持 oauth
    }
    const next: ProviderProfile = {
      ...prev,
      name,
      providerId,
      authType:
        input.apiKey && input.apiKey.length > 0 ? "api_key" : prev.authType,
      apiKey:
        input.apiKey !== undefined && input.apiKey !== ""
          ? input.apiKey
          : prev.apiKey,
      baseUrl: input.baseUrl !== undefined ? input.baseUrl.trim() || undefined : prev.baseUrl,
      notes: input.notes !== undefined ? input.notes.trim() || undefined : prev.notes,
      updatedAt: now,
    };
    data.profiles[idx] = next;
    save();
    return toPublic(next);
  }

  const profile: ProviderProfile = {
    id: randomUUID(),
    name,
    providerId,
    authType,
    apiKey: input.apiKey?.trim() || undefined,
    baseUrl: input.baseUrl?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  data.profiles.push(profile);
  save();
  return toPublic(profile);
  });
}

export function deleteProfile(id: string): void {
  void enqueue(() => {
    const idx = data.profiles.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error("Profile 不存在");
    data.profiles.splice(idx, 1);
    if (data.activeProfileId === id) data.activeProfileId = null;
    save();
  });
}

export function getSecret(id: string): string {
  const p = data.profiles.find((x) => x.id === id);
  if (!p) throw new Error("Profile 不存在");
  if (p.authType === "oauth_placeholder" && !p.apiKey) {
    throw new Error("OAuth 凭证由 pi /login 管理，Hub 无明文 key");
  }
  return p.apiKey ?? "";
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  } catch {
    throw new Error(`无法解析 ${path}`);
  }
}

/** 将 Profile 写入 pi auth.json；有 baseUrl 时合并 models.json。 */
export async function activateProfile(id: string): Promise<ProviderProfilePublic> {
  return enqueue(() => {
    const profile = data.profiles.find((p) => p.id === id);
    if (!profile) throw new Error("Profile 不存在");

    if (profile.authType === "oauth_placeholder" && !profile.apiKey) {
      throw new Error(
        "OAuth Profile 无法通过 Hub 激活写 key；请在 pi 中 /login，或改为 API Key"
      );
    }
    if (!profile.apiKey) {
      throw new Error("请先填写 API Key");
    }

    if (!existsSync(PI_AGENT_DIR)) {
      mkdirSync(PI_AGENT_DIR, { recursive: true });
    }

    const auth = readJsonFile(AUTH_FILE);
    auth[profile.providerId] = {
      type: "api_key",
      key: profile.apiKey,
    };
    atomicWriteJson(AUTH_FILE, auth);

    if (profile.baseUrl) {
      const modelsRoot = readJsonFile(MODELS_FILE);
      const providers =
        modelsRoot.providers &&
        typeof modelsRoot.providers === "object" &&
        !Array.isArray(modelsRoot.providers)
          ? { ...(modelsRoot.providers as Record<string, unknown>) }
          : {};
      const prev =
        providers[profile.providerId] &&
        typeof providers[profile.providerId] === "object" &&
        !Array.isArray(providers[profile.providerId])
          ? { ...(providers[profile.providerId] as Record<string, unknown>) }
          : {};
      providers[profile.providerId] = {
        ...prev,
        baseUrl: profile.baseUrl,
      };
      modelsRoot.providers = providers;
      atomicWriteJson(MODELS_FILE, modelsRoot);
    }

    data.activeProfileId = id;
    profile.updatedAt = Date.now();
    save();
    return toPublic(profile);
  });
}

/**
 * 从现有 auth.json 导入 Profile（不覆盖同名 providerId 已有 Hub Profile）。
 * OAuth 条目导入为 oauth_placeholder（无明文 key）。
 */
export async function importFromAuth(): Promise<{
  imported: number;
  profiles: ProviderProfilePublic[];
}> {
  return enqueue(() => {
    if (!existsSync(AUTH_FILE)) {
      return { imported: 0, profiles: listProfiles().profiles };
    }
    const auth = readJsonFile(AUTH_FILE);
    const existingProviderIds = new Set(data.profiles.map((p) => p.providerId));
    let imported = 0;
    const now = Date.now();

    for (const [providerId, value] of Object.entries(auth)) {
      if (!PROVIDER_ID_RE.test(providerId)) continue;
      if (existingProviderIds.has(providerId)) continue;
      if (!value || typeof value !== "object") continue;
      const entry = value as { type?: string; key?: string };

      if (entry.type === "api_key" && typeof entry.key === "string" && entry.key) {
        data.profiles.push({
          id: randomUUID(),
          name: providerId,
          providerId,
          authType: "api_key",
          apiKey: entry.key,
          createdAt: now,
          updatedAt: now,
        });
        imported += 1;
        existingProviderIds.add(providerId);
        continue;
      }

      // oauth / 其他：占位
      data.profiles.push({
        id: randomUUID(),
        name: `${providerId} (OAuth)`,
        providerId,
        authType: "oauth_placeholder",
        notes: "由 pi /login 管理，Hub 仅展示状态",
        createdAt: now,
        updatedAt: now,
      });
      imported += 1;
      existingProviderIds.add(providerId);
    }

    if (imported > 0) save();
    return { imported, profiles: listProfiles().profiles };
  });
}

/** 常见 provider 预设（UI 下拉）。 */
export const PROVIDER_PRESETS = [
  "anthropic",
  "openai",
  "google",
  "deepseek",
  "openrouter",
  "groq",
  "mistral",
  "xai",
  "minimax",
  "minimax-cn",
  "zai",
  "opencode",
] as const;
