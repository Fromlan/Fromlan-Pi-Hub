import { useStore } from "../store";
import type { Assignee } from "../../shared/types";

/**
 * Polymorphic assignee picker —— 阶段 1 仅 agent 可选；
 * human / squad 渲染 disabled + tooltip（推迟到阶段 3/6）。
 */
export function AssigneePicker({
  value,
  onChange,
}: {
  value: Assignee;
  onChange: (a: Assignee) => void;
}) {
  const agents = useStore((s) => s.agents);
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
      <option value="human:default" disabled title="v0.9 才可用">
        Human（暂不可用）
      </option>
      <option value="squad:" disabled title="v0.6 才可用">
        Squad（暂不可用）
      </option>
    </select>
  );
}
