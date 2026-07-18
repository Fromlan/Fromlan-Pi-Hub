import { useEffect } from "react";
import { useStore } from "../store";
import { HUMAN_ME_LABEL, PANEL_LABEL } from "../../shared/labels";
import type { Assignee } from "../../shared/types";

/**
 * Polymorphic assignee picker：agent / squad 可选；human 仅展示。
 */
export function AssigneePicker({
  value,
  onChange,
}: {
  value: Assignee;
  onChange: (a: Assignee) => void;
}) {
  const agents = useStore((s) => s.agents);
  const squads = useStore((s) => s.squads);
  const setSquads = useStore((s) => s.setSquads);

  useEffect(() => {
    if (squads.length === 0) {
      window.squadAPI.list().then(setSquads);
    }
  }, [squads.length, setSquads]);

  return (
    <select
      className="assignee-picker"
      value={`${value.kind}:${value.id}`}
      onChange={(e) => {
        const [kind, ...rest] = e.target.value.split(":");
        onChange({ kind: kind as Assignee["kind"], id: rest.join(":") });
      }}
    >
      <option value="agent:" disabled>
        — 选择 Agent —
      </option>
      {agents.map((a) => (
        <option key={a.name} value={`agent:${a.name}`}>
          {a.name}
        </option>
      ))}
      {squads.length > 0 && (
        <option value="squad:" disabled>
          — {PANEL_LABEL.squads} —
        </option>
      )}
      {squads.map((s) => (
        <option key={s.id} value={`squad:${s.id}`}>
          {PANEL_LABEL.squads}: {s.name}
        </option>
      ))}
      <option value="human:default">{HUMAN_ME_LABEL}</option>
    </select>
  );
}
