import { useEffect, useState } from "react";
import { useStore } from "../store";
import { INBOX_KIND_LABEL, PANEL_LABEL } from "../../shared/labels";
import type { InboxItem } from "../../shared/types";

export function InboxPanel() {
  const setActiveIssue = useStore((s) => s.setActiveIssue);
  const setViewMode = useStore((s) => s.setViewMode);
  const setPanel = useStore((s) => s.setPanel);
  const [items, setItems] = useState<InboxItem[]>([]);

  const refresh = () => window.inboxAPI.list().then(setItems);

  useEffect(() => {
    void refresh();
    return window.inboxAPI.onChanged(() => {
      void refresh();
    });
  }, []);

  const unread = items.filter((i) => !i.read).length;

  return (
    <div className="inbox-panel">
      <header className="inbox-header">
        <h2>
          {PANEL_LABEL.inbox}
          {unread > 0 ? <span className="inbox-badge">{unread}</span> : null}
        </h2>
        <div className="form-actions">
          <button
            className="btn"
            onClick={async () => {
              await window.inboxAPI.markAllRead();
              await refresh();
            }}
          >
            全部已读
          </button>
          <button
            className="btn"
            onClick={async () => {
              if (!confirm("清空收件箱？")) return;
              await window.inboxAPI.clear();
              await refresh();
            }}
          >
            清空
          </button>
        </div>
      </header>
      <p className="muted inbox-hint">
        收件箱只给人看。Agent 不会出现在这里——它们被触发即工作。
      </p>
      <ul className="inbox-list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`inbox-item${item.read ? "" : " inbox-item-unread"}`}
          >
            <button
              type="button"
              className="inbox-item-btn"
              onClick={async () => {
                await window.inboxAPI.markRead(item.id);
                if (item.issueId) {
                  setPanel("chat");
                  setActiveIssue(item.issueId);
                  setViewMode("list");
                }
                await refresh();
              }}
            >
              <header>
                <span className="inbox-kind">{INBOX_KIND_LABEL[item.kind]}</span>
                <strong>{item.title}</strong>
                <time>{new Date(item.createdAt).toLocaleString()}</time>
              </header>
              <p>{item.body}</p>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="muted">暂无通知</li>}
      </ul>
    </div>
  );
}
