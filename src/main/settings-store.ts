import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { getBaseDir } from "./persistence";
import type { AppSettings } from "../shared/types";

/**
 * 应用设置持久化：{userData}/fromlan-pi-hub/settings.json
 */

const SETTINGS_FILE = join(getBaseDir(), "settings.json");

export const DEFAULT_SETTINGS: AppSettings = {
  defaultProvider: "",
  defaultModel: "",
  defaultCwd: "",
  dispatchTimeoutMs: 5 * 60 * 1000,
  runningTimeoutMs: 2.5 * 60 * 60 * 1000,
  maxRetries: 2,
  notifyMode: "background",
};

function atomicWrite(p: string, data: unknown): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
}

function normalize(raw: Partial<AppSettings>): AppSettings {
  return {
    defaultProvider: raw.defaultProvider ?? DEFAULT_SETTINGS.defaultProvider,
    defaultModel: raw.defaultModel ?? DEFAULT_SETTINGS.defaultModel,
    defaultCwd: raw.defaultCwd ?? DEFAULT_SETTINGS.defaultCwd ?? homedir(),
    dispatchTimeoutMs:
      typeof raw.dispatchTimeoutMs === "number" && raw.dispatchTimeoutMs > 0
        ? raw.dispatchTimeoutMs
        : DEFAULT_SETTINGS.dispatchTimeoutMs,
    runningTimeoutMs:
      typeof raw.runningTimeoutMs === "number" && raw.runningTimeoutMs > 0
        ? raw.runningTimeoutMs
        : DEFAULT_SETTINGS.runningTimeoutMs,
    maxRetries:
      typeof raw.maxRetries === "number" && raw.maxRetries >= 1
        ? Math.floor(raw.maxRetries)
        : DEFAULT_SETTINGS.maxRetries,
    notifyMode:
      raw.notifyMode === "always" || raw.notifyMode === "off"
        ? raw.notifyMode
        : DEFAULT_SETTINGS.notifyMode,
  };
}

function load(): AppSettings {
  if (!existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS, defaultCwd: homedir() };
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as Partial<AppSettings>;
    return normalize(raw);
  } catch {
    return { ...DEFAULT_SETTINGS, defaultCwd: homedir() };
  }
}

let settings: AppSettings = load();

export function getSettings(): AppSettings {
  return { ...settings };
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  settings = normalize({ ...settings, ...patch });
  atomicWrite(SETTINGS_FILE, settings);
  return { ...settings };
}
