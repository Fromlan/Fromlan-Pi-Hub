import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getBaseDir } from "./persistence";
import type { InboxItem, InboxKind } from "../shared/types";

const INBOX_FILE = join(getBaseDir(), "inbox.json");

function atomicWrite(p: string, data: unknown): void {
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, p);
}

function load(): InboxItem[] {
  if (!existsSync(INBOX_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(INBOX_FILE, "utf8")) as InboxItem[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

let items: InboxItem[] = load();

function save(): void {
  atomicWrite(INBOX_FILE, items);
}

export function listInbox(): InboxItem[] {
  return items.slice().sort((a, b) => b.createdAt - a.createdAt);
}

export function unreadCount(): number {
  return items.filter((i) => !i.read).length;
}

export function addInboxItem(input: {
  kind: InboxKind;
  issueId?: string;
  title: string;
  body: string;
}): InboxItem {
  const item: InboxItem = {
    id: randomUUID(),
    kind: input.kind,
    issueId: input.issueId,
    title: input.title,
    body: input.body,
    read: false,
    createdAt: Date.now(),
  };
  items.unshift(item);
  // 保留最近 500 条
  if (items.length > 500) items = items.slice(0, 500);
  save();
  return item;
}

export function markRead(id: string): InboxItem | undefined {
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return undefined;
  items[idx] = { ...items[idx], read: true };
  save();
  return items[idx];
}

export function markAllRead(): void {
  let changed = false;
  items = items.map((i) => {
    if (!i.read) {
      changed = true;
      return { ...i, read: true };
    }
    return i;
  });
  if (changed) save();
}

export function clearInbox(): void {
  items = [];
  save();
}
