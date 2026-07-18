import { BrowserWindow, Notification } from "electron";
import * as settingsStore from "./settings-store";
import type { InboxItem } from "../shared/types";

let lastNotifyAt = 0;
const THROTTLE_MS = 2000;

function shouldNotify(): boolean {
  const mode = settingsStore.getSettings().notifyMode;
  if (mode === "off") return false;
  if (mode === "always") return true;
  // background：仅当无聚焦窗口时弹
  const focused = BrowserWindow.getFocusedWindow();
  return !focused || !focused.isFocused();
}

/** 桌面通知（去重节流）；agent 不进 inbox 的原则由调用方保证。 */
export function notifyInboxItem(item: InboxItem): void {
  if (!shouldNotify()) return;
  if (!Notification.isSupported()) return;
  const now = Date.now();
  if (now - lastNotifyAt < THROTTLE_MS) return;
  lastNotifyAt = now;

  const n = new Notification({
    title: item.title,
    body: item.body.slice(0, 200),
  });
  n.on("click", () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins[0] && !wins[0].isDestroyed()) {
      if (wins[0].isMinimized()) wins[0].restore();
      wins[0].focus();
    }
  });
  n.show();
}
