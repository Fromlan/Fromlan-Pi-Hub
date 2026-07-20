import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { PANEL_LABEL } from "../../shared/labels";
import type { UsageSummaryResult } from "../../shared/types";
import {
  DailyCostChart,
  HorizontalRankChart,
  StackedDailyTokenChart,
} from "./usage/UsageCharts";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtCost(n: number): string {
  if (n >= 10) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return "$0";
}

function DailyChart({
  daily,
}: {
  daily: UsageSummaryResult["daily"];
}) {
  const w = 640;
  const h = 180;
  const pad = { t: 12, r: 12, b: 28, l: 40 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const maxCost = Math.max(...daily.map((d) => d.costUsd), 0.0001);
  const maxTok = Math.max(
    ...daily.map((d) => d.inputTokens + d.outputTokens),
    1
  );

  const points = daily.map((d, i) => {
    const x =
      pad.l +
      (daily.length <= 1 ? innerW / 2 : (i / (daily.length - 1)) * innerW);
    const yCost = pad.t + innerH - (d.costUsd / maxCost) * innerH;
    const yTok =
      pad.t +
      innerH -
      ((d.inputTokens + d.outputTokens) / maxTok) * innerH;
    return { x, yCost, yTok, d };
  });

  const costPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.yCost.toFixed(1)}`)
    .join(" ");
  const barW = Math.max(2, innerW / Math.max(daily.length, 1) * 0.55);

  return (
    <svg
      className="usage-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="按天用量图表"
    >
      {/* 网格 */}
      {[0, 0.5, 1].map((t) => {
        const y = pad.t + innerH * (1 - t);
        return (
          <line
            key={t}
            x1={pad.l}
            x2={w - pad.r}
            y1={y}
            y2={y}
            className="usage-chart-grid"
          />
        );
      })}
      {/* token 柱 */}
      {points.map((p) => (
        <rect
          key={`b-${p.d.date}`}
          x={p.x - barW / 2}
          y={p.yTok}
          width={barW}
          height={Math.max(0, pad.t + innerH - p.yTok)}
          className="usage-chart-bar"
        >
          <title>
            {p.d.date}: {fmtTokens(p.d.inputTokens + p.d.outputTokens)} tokens ·{" "}
            {fmtCost(p.d.costUsd)}
          </title>
        </rect>
      ))}
      {/* cost 折线 */}
      <path d={costPath} className="usage-chart-line" fill="none" />
      {points.map((p) => (
        <circle
          key={`c-${p.d.date}`}
          cx={p.x}
          cy={p.yCost}
          r={2.5}
          className="usage-chart-dot"
        />
      ))}
      {/* x 轴标签（稀疏） */}
      {points
        .filter((_, i) => {
          if (daily.length <= 10) return true;
          const step = Math.ceil(daily.length / 7);
          return i % step === 0 || i === daily.length - 1;
        })
        .map((p) => (
          <text
            key={`l-${p.d.date}`}
            x={p.x}
            y={h - 6}
            textAnchor="middle"
            className="usage-chart-label"
          >
            {p.d.date.slice(5)}
          </text>
        ))}
    </svg>
  );
}

export function UsagePanel() {
  const projects = useStore((s) => s.projects);
  const setNotice = useStore((s) => s.setNotice);
  const agents = useStore((s) => s.agents);
  const setAgents = useStore((s) => s.setAgents);
  const setPanel = useStore((s) => s.setPanel);
  const setActiveIssue = useStore((s) => s.setActiveIssue);
  const setViewMode = useStore((s) => s.setViewMode);
  const [days, setDays] = useState(30);
  const [projectId, setProjectId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [summary, setSummary] = useState<UsageSummaryResult | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await window.usageAPI.summary({
        days,
        projectId: projectId || undefined,
        provider: providerId || undefined,
        agentName: agentName || undefined,
      });
      setSummary(r);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (agents.length > 0) return;
    void window.agentAPI.list().then((list) => setAgents(list));
  }, [agents.length, setAgents]);

  useEffect(() => {
    void refresh();
    return window.usageAPI.onChanged(() => {
      void refresh();
    });
  }, [days, projectId, providerId, agentName]);

  const legend = useMemo(
    () => (
      <div className="usage-legend">
        <span className="usage-legend-seg-in">In</span>
        <span className="usage-legend-seg-out">Out</span>
        <span className="usage-legend-seg-cache-r">Cache R</span>
        <span className="usage-legend-seg-cache-w">Cache W</span>
        <span className="usage-legend-line">Cost</span>
      </div>
    ),
    []
  );

  const totals = summary?.totals;
  const totalTokens = totals ? totals.inputTokens + totals.outputTokens : 0;
  const cacheTotal = totals
    ? totals.cacheReadTokens + totals.cacheWriteTokens
    : 0;
  const avgCost = totals && totals.runCount > 0 ? totals.costUsd / totals.runCount : 0;
  const avgTokens = totals && totals.runCount > 0 ? totalTokens / totals.runCount : 0;
  const cacheHitRate =
    totals && totals.inputTokens + totals.cacheReadTokens > 0
      ? totals.cacheReadTokens / (totals.inputTokens + totals.cacheReadTokens)
      : null;
  const costSharePct = (v: number): string => {
    const denom = totals?.costUsd ?? 0;
    if (denom <= 0) return "—";
    return `${((v / denom) * 100).toFixed(1)}%`;
  };

  const rankEmpty =
    summary != null &&
    summary.byModel.length === 0 &&
    summary.byAgent.length === 0;

  return (
    <div className="usage-panel">
      <header className="usage-header">
        <h2>{PANEL_LABEL.usage}</h2>
        <p className="usage-subtitle">
          按天聚合会话用量（来自 pi get_session_stats）
        </p>
      </header>

      <div className="usage-toolbar">
        <select
          className="form-input usage-toolbar-days"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="天数"
        >
          <option value={7}>近 7 天</option>
          <option value={30}>近 30 天</option>
          <option value={90}>近 90 天</option>
        </select>
        <select
          className="form-input"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="项目过滤"
        >
          <option value="">全部项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="form-input"
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          aria-label="Provider 过滤"
        >
          <option value="">全部 Provider</option>
          {summary?.byProvider.map((r) => (
            <option key={r.provider} value={r.provider}>
              {r.provider}
            </option>
          ))}
        </select>
        <select
          className="form-input"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          aria-label="Agent 过滤"
        >
          <option value="">全部 Agent</option>
          <option value="__none__">(未指定)</option>
          {agents
            .map((a) => a.name)
            .filter((n) => n.trim().length > 0)
            .map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
        </select>
        <button
          className="btn usage-toolbar-clear"
          type="button"
          onClick={async () => {
            if (!confirm("清空全部用量记录？此操作不可恢复。")) return;
            await window.usageAPI.clear();
            setNotice("用量记录已清空");
            await refresh();
          }}
        >
          清空
        </button>
      </div>

      {loading && !summary ? (
        <p className="usage-empty">加载中…</p>
      ) : summary ? (
        <>
          <div className="usage-kpi-primary">
            <div className="usage-kpi">
              <span className="usage-kpi-label">总 Token</span>
              <span className="usage-kpi-value tabular">
                {fmtTokens(totalTokens)}
              </span>
              <span className="usage-kpi-hint">
                in {fmtTokens(summary.totals.inputTokens)} / out{" "}
                {fmtTokens(summary.totals.outputTokens)}
              </span>
            </div>
            <div className="usage-kpi">
              <span className="usage-kpi-label">总费用</span>
              <span className="usage-kpi-value tabular">
                {fmtCost(summary.totals.costUsd)}
              </span>
              <span className="usage-kpi-hint">pi 回报 cost</span>
            </div>
            <div className="usage-kpi">
              <span className="usage-kpi-label">会话次数</span>
              <span className="usage-kpi-value tabular">
                {summary.totals.runCount}
              </span>
              <span className="usage-kpi-hint">含聊天与派活</span>
            </div>
          </div>

          <div className="usage-kpi-secondary">
            <div className="usage-kpi">
              <span className="usage-kpi-label">均次费用</span>
              <span className="usage-kpi-value tabular">{fmtCost(avgCost)}</span>
              <span className="usage-kpi-hint">cost / runs</span>
            </div>
            <div className="usage-kpi">
              <span className="usage-kpi-label">均次 Token</span>
              <span className="usage-kpi-value tabular">{fmtTokens(avgTokens)}</span>
              <span className="usage-kpi-hint">avg token</span>
            </div>
            <div className="usage-kpi">
              <span className="usage-kpi-label">Cache</span>
              <span className="usage-kpi-value tabular">
                {fmtTokens(cacheTotal)}
              </span>
              <span className="usage-kpi-hint">
                r {fmtTokens(summary.totals.cacheReadTokens)} / w{" "}
                {fmtTokens(summary.totals.cacheWriteTokens)}
              </span>
            </div>
            <div className="usage-kpi">
              <span className="usage-kpi-label">Cache 命中率</span>
              <span className="usage-kpi-value tabular">
                {cacheHitRate == null ? "—" : `${(cacheHitRate * 100).toFixed(1)}%`}
              </span>
              <span className="usage-kpi-hint">r/(in+r)</span>
            </div>
          </div>

          <section className="usage-section">
            <div className="usage-section-head">
              <h3>按天</h3>
              {legend}
            </div>
            <div className="usage-grid-2">
              <StackedDailyTokenChart daily={summary.daily} />
              <DailyCostChart daily={summary.daily} />
            </div>
          </section>

          <section className="usage-section">
            <div className="usage-section-head">
              <h3>费用排行</h3>
            </div>
            {rankEmpty ? (
              <p className="usage-empty">
                暂无数据。完成一次会话后会出现在这里。
              </p>
            ) : (
              <div className="usage-grid-2">
                <div>
                  <h3>按模型</h3>
                  {summary.byModel.length === 0 ? (
                    <p className="usage-empty">暂无数据。</p>
                  ) : (
                    <HorizontalRankChart
                      rows={summary.byModel.map((r) => ({
                        label: `${r.provider}/${r.model}`,
                        value: r.costUsd,
                        title: `${r.provider} / ${r.model}`,
                      }))}
                    />
                  )}
                </div>
                <div>
                  <h3>按 Agent</h3>
                  {summary.byAgent.length === 0 ? (
                    <p className="usage-empty">暂无数据。</p>
                  ) : (
                    <HorizontalRankChart
                      rows={summary.byAgent.map((r) => ({
                        label: r.agentName ? r.agentName : "(未指定)",
                        value: r.costUsd,
                        title: r.agentName ? r.agentName : "(未指定)",
                      }))}
                    />
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="usage-section">
            <div className="usage-section-head">
              <h3>按 Issue</h3>
            </div>
            {summary.byIssue.length === 0 ? (
              <p className="usage-empty">暂无 Issue 用量。派活到 Issue 后会开始统计。</p>
            ) : (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>标题</th>
                    <th className="tabular">Runs</th>
                    <th className="tabular">Tokens</th>
                    <th className="tabular">Cost</th>
                    <th className="tabular">占比</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byIssue.map((r) => {
                    const tokensAll =
                      r.inputTokens +
                      r.outputTokens +
                      r.cacheReadTokens +
                      r.cacheWriteTokens;
                    return (
                      <tr key={r.issueId}>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setPanel("chat");
                              setActiveIssue(r.issueId);
                              setViewMode("list");
                            }}
                          >
                            {r.issueKey}
                          </button>
                        </td>
                        <td title={r.issueTitle}>{r.issueTitle}</td>
                        <td className="tabular">{r.runCount}</td>
                        <td className="tabular">{fmtTokens(tokensAll)}</td>
                        <td className="tabular">{fmtCost(r.costUsd)}</td>
                        <td className="tabular">{costSharePct(r.costUsd)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="usage-section">
            <div className="usage-section-head">
              <h3>按模型（完整）</h3>
            </div>
            {summary.byModel.length === 0 ? (
              <p className="usage-empty">暂无数据。</p>
            ) : (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model</th>
                    <th className="tabular">Runs</th>
                    <th className="tabular">In</th>
                    <th className="tabular">Out</th>
                    <th className="tabular">Cache R</th>
                    <th className="tabular">Cache W</th>
                    <th className="tabular">Cost</th>
                    <th className="tabular">Cost%</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byModel.map((r) => (
                    <tr key={`${r.provider}/${r.model}`}>
                      <td>{r.provider}</td>
                      <td title={r.model}>{r.model}</td>
                      <td className="tabular">{r.runCount}</td>
                      <td className="tabular">{fmtTokens(r.inputTokens)}</td>
                      <td className="tabular">{fmtTokens(r.outputTokens)}</td>
                      <td className="tabular">{fmtTokens(r.cacheReadTokens)}</td>
                      <td className="tabular">{fmtTokens(r.cacheWriteTokens)}</td>
                      <td className="tabular">{fmtCost(r.costUsd)}</td>
                      <td className="tabular">{costSharePct(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="usage-section">
            <div className="usage-section-head">
              <h3>近期会话（最多 50 条）</h3>
            </div>
            {summary.recent.length === 0 ? (
              <p className="usage-empty">暂无近期会话。</p>
            ) : (
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>Issue</th>
                    <th>Agent</th>
                    <th>Provider/Model</th>
                    <th className="tabular">In</th>
                    <th className="tabular">Out</th>
                    <th className="tabular">Cache R</th>
                    <th className="tabular">Cache W</th>
                    <th className="tabular">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.createdAt).toLocaleString()}</td>
                      <td>
                        {r.issueId ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => {
                              setPanel("chat");
                              setActiveIssue(r.issueId ?? null);
                              setViewMode("list");
                            }}
                          >
                            {r.issueKey ?? r.issueId}
                          </button>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{r.agentName ? r.agentName : "(未指定)"}</td>
                      <td title={`${r.provider}/${r.model}`}>
                        {r.provider}/{r.model}
                      </td>
                      <td className="tabular">{fmtTokens(r.inputTokens)}</td>
                      <td className="tabular">{fmtTokens(r.outputTokens)}</td>
                      <td className="tabular">
                        {fmtTokens(r.cacheReadTokens)}
                      </td>
                      <td className="tabular">
                        {fmtTokens(r.cacheWriteTokens)}
                      </td>
                      <td className="tabular">{fmtCost(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : (
        <p className="usage-empty">无法加载用量</p>
      )}
    </div>
  );
}
