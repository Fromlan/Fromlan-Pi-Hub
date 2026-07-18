import { useEffect } from "react";
import { useStore } from "../store";
import { PANEL_LABEL } from "../../shared/labels";

/** Issue 属性 / 创建对话框共用的项目选择器。 */
export function ProjectPicker({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (projectId: string | undefined) => void;
}) {
  const projects = useStore((s) => s.projects);
  const setProjects = useStore((s) => s.setProjects);

  useEffect(() => {
    if (projects.length === 0) {
      window.projectAPI.list().then(setProjects);
    }
  }, [projects.length, setProjects]);

  return (
    <select
      className="form-input"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      aria-label={PANEL_LABEL.projects}
    >
      <option value="">— 无 —</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.icon ? `${p.icon} ` : ""}
          {p.name}
        </option>
      ))}
    </select>
  );
}
