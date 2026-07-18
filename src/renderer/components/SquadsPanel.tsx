import { useEffect, useState } from "react";
import { useStore } from "../store";
import { PANEL_LABEL } from "../../shared/labels";
import type { Squad, SquadMember } from "../../shared/types";

export function SquadsPanel() {
  const squads = useStore((s) => s.squads);
  const setSquads = useStore((s) => s.setSquads);
  const upsertSquad = useStore((s) => s.upsertSquad);
  const removeSquad = useStore((s) => s.removeSquad);
  const agents = useStore((s) => s.agents);
  const setNotice = useStore((s) => s.setNotice);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [leader, setLeader] = useState("");
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    window.squadAPI.list().then(setSquads);
    window.agentAPI.list().then((list) => useStore.getState().setAgents(list));
    return window.squadAPI.onChanged((s) => {
      if (s.archived) removeSquad(s.id);
      else upsertSquad(s);
    });
  }, [setSquads, upsertSquad, removeSquad]);

  const selected = squads.find((s) => s.id === selectedId) ?? null;

  const create = async () => {
    if (!name.trim() || !leader) {
      setNotice("请填写名称与 Leader");
      return;
    }
    const r = await window.squadAPI.create({
      name: name.trim(),
      leaderAgentName: leader,
      instructions,
      members: agents
        .filter((a) => a.name !== leader)
        .map((a) => ({ kind: "agent" as const, id: a.name, role: "" })),
    });
    if (!r.ok) {
      setNotice(r.error);
      return;
    }
    upsertSquad(r.squad);
    setSelectedId(r.squad.id);
    setCreating(false);
    setName("");
    setInstructions("");
  };

  const saveSelected = async (patch: Partial<Squad>) => {
    if (!selected) return;
    const r = await window.squadAPI.update(selected.id, patch);
    if (r.ok) upsertSquad(r.squad);
    else setNotice(r.error);
  };

  const toggleMember = (agentName: string) => {
    if (!selected) return;
    const exists = selected.members.some(
      (m) => m.kind === "agent" && m.id === agentName
    );
    let members: SquadMember[];
    if (exists) {
      members = selected.members.filter(
        (m) => !(m.kind === "agent" && m.id === agentName)
      );
    } else {
      members = [
        ...selected.members,
        { kind: "agent", id: agentName, role: "" },
      ];
    }
    void saveSelected({ members });
  };

  const setMemberRole = (agentName: string, role: string) => {
    if (!selected) return;
    const members = selected.members.map((m) =>
      m.kind === "agent" && m.id === agentName ? { ...m, role } : m
    );
    // 若尚未在 members 中（仅 leader 勾选态），先加入再写 role
    const has = selected.members.some(
      (m) => m.kind === "agent" && m.id === agentName
    );
    const next = has
      ? members
      : [...selected.members, { kind: "agent" as const, id: agentName, role }];
    void saveSelected({ members: next });
  };

  return (
    <div className="squads-panel">
      <aside className="squads-list">
        <header className="squads-list-head">
          <h2>{PANEL_LABEL.squads}</h2>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            新建
          </button>
        </header>
        <ul>
          {squads.map((s) => (
            <li key={s.id}>
              <button
                className={`squads-item${selectedId === s.id ? " active" : ""}`}
                onClick={() => setSelectedId(s.id)}
              >
                <strong>{s.name}</strong>
                <span className="muted">Leader: {s.leaderAgentName}</span>
              </button>
            </li>
          ))}
          {squads.length === 0 && <li className="muted">还没有小队</li>}
        </ul>
      </aside>

      <main className="squads-detail">
        {creating ? (
          <div className="squads-form">
            <h3>新建小队</h3>
            <label className="form-row">
              <span className="form-label">名称</span>
              <input
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="form-row">
              <span className="form-label">Leader Agent</span>
              <select
                className="form-input"
                value={leader}
                onChange={(e) => setLeader(e.target.value)}
              >
                <option value="">— 选择 —</option>
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span className="form-label">路由说明</span>
              <textarea
                className="form-input"
                rows={4}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="例如：UI 相关派给 ui-specialist…"
              />
            </label>
            <div className="form-actions">
              <button className="btn btn-primary" onClick={create}>
                创建
              </button>
              <button className="btn" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          </div>
        ) : selected ? (
          <div className="squads-form">
            <h3>{selected.name}</h3>
            <p className="muted">
              Leader 只做路由：读 issue → @ 成员 → 停止。Protocol 不可编辑。
            </p>
            <label className="form-row">
              <span className="form-label">Leader</span>
              <select
                className="form-input"
                value={selected.leaderAgentName}
                onChange={(e) =>
                  void saveSelected({ leaderAgentName: e.target.value })
                }
              >
                {agents.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span className="form-label">路由说明</span>
              <textarea
                className="form-input"
                rows={4}
                value={selected.instructions}
                onChange={(e) =>
                  void saveSelected({ instructions: e.target.value })
                }
              />
            </label>
            <fieldset className="squads-members">
              <legend>成员</legend>
              <p className="muted squads-members-hint">
                Role 描述会注入 Leader 的 Roster，用于路由决策。
              </p>
              {agents.map((a) => {
                const member = selected.members.find(
                  (m) => m.kind === "agent" && m.id === a.name
                );
                const isLeader = a.name === selected.leaderAgentName;
                const checked = !!member || isLeader;
                return (
                  <div key={a.name} className="squads-member-row">
                    <label className="squads-member-check">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isLeader}
                        onChange={() => toggleMember(a.name)}
                      />
                      <span>
                        {a.name}
                        {isLeader && (
                          <span className="muted">（Leader）</span>
                        )}
                      </span>
                    </label>
                    {checked && !isLeader && (
                      <input
                        className="form-input squads-member-role"
                        type="text"
                        placeholder="角色，如 owns migrations"
                        value={member?.role ?? ""}
                        onChange={(e) => setMemberRole(a.name, e.target.value)}
                        onBlur={(e) =>
                          setMemberRole(a.name, e.target.value.trim())
                        }
                      />
                    )}
                  </div>
                );
              })}
            </fieldset>
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (
                  !confirm(
                    `归档小队「${selected.name}」？\n已派给该小队的 Issue 将转给 Leader（${selected.leaderAgentName}）。`
                  )
                ) {
                  return;
                }
                const r = await window.squadAPI.delete(selected.id);
                if (r.ok) {
                  removeSquad(selected.id);
                  setSelectedId(null);
                  if (r.transferred && r.transferred > 0) {
                    setNotice(
                      `已归档；${r.transferred} 个 Issue 已转给 @${selected.leaderAgentName}`
                    );
                    void window.issueAPI.list().then((list) =>
                      useStore.getState().setIssues(list)
                    );
                  } else {
                    setNotice("小队已归档");
                  }
                } else {
                  setNotice(r.error ?? "归档失败");
                }
              }}
            >
              归档
            </button>
          </div>
        ) : (
          <div className="empty-state">
            <p>选择或新建一个小队</p>
          </div>
        )}
      </main>
    </div>
  );
}
