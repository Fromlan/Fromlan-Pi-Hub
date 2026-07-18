import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { formatMention } from "../../shared/mention";
import type { AssigneeKind } from "../../shared/types";

interface Props {
  /** 当前输入文本（用于检测尾部 @）。 */
  value: string;
  onInsert: (mentionMarkdown: string) => void;
  onClose: () => void;
}

/**
 * 评论输入 @ 时弹出：选择 agent / squad / human。
 */
export function MentionPicker({ value, onInsert, onClose }: Props) {
  const agents = useStore((s) => s.agents);
  const squads = useStore((s) => s.squads);
  const [q, setQ] = useState("");

  const atIdx = value.lastIndexOf("@");
  const query =
    atIdx >= 0 ? value.slice(atIdx + 1).replace(/\s.*/, "") : "";

  useEffect(() => {
    setQ(query.toLowerCase());
  }, [query]);

  const items = useMemo(() => {
    const list: { kind: AssigneeKind; id: string; label: string }[] = [];
    for (const a of agents) {
      list.push({ kind: "agent", id: a.name, label: a.name });
    }
    for (const s of squads) {
      list.push({ kind: "squad", id: s.id, label: s.name });
    }
    list.push({ kind: "human", id: "default", label: "me" });
    if (!q) return list;
    return list.filter(
      (i) =>
        i.label.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)
    );
  }, [agents, squads, q]);

  if (atIdx < 0) return null;

  return (
    <div className="mention-picker" role="listbox">
      <header className="mention-picker-head">
        <span>提及</span>
        <button type="button" className="btn-ghost" onClick={onClose}>
          ✕
        </button>
      </header>
      <ul className="mention-picker-list">
        {items.map((i) => (
          <li key={`${i.kind}:${i.id}`}>
            <button
              type="button"
              className="mention-picker-item"
              onClick={() => {
                onInsert(formatMention(i.kind, i.id, i.label));
                onClose();
              }}
            >
              <span className="mention-kind">{i.kind}</span>
              <span>{i.label}</span>
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="muted">无匹配</li>}
      </ul>
    </div>
  );
}
