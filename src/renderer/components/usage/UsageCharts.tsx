import type {
  UsageDailyPoint,
  UsageModelRow,
  UsageAgentRow,
} from "../../../shared/types";

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function fmtCost(n: number): string {
  if (n >= 10) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  if (n > 0) return `$${n.toFixed(4)}`;
  return "$0";
}

function xForIndex({
  i,
  len,
  padL,
  innerW,
}: {
  i: number;
  len: number;
  padL: number;
  innerW: number;
}): number {
  if (len <= 1) return padL + innerW / 2;
  return padL + (i / (len - 1)) * innerW;
}

function dateLabel(d: string): string {
  // YYYY-MM-DD -> MM-DD
  return d.slice(5);
}

export function StackedDailyTokenChart({
  daily,
}: {
  daily: UsageDailyPoint[];
}) {
  const w = 720;
  const h = 210;
  const pad = { t: 14, r: 16, b: 28, l: 52 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const maxTok = Math.max(
    ...daily.map((d) => d.inputTokens + d.outputTokens + d.cacheReadTokens + d.cacheWriteTokens),
    1
  );

  const barW = Math.max(3, innerW / Math.max(daily.length, 1) * 0.55);
  const ticks = [0, 0.5, 1];

  const points = daily.map((d, i) => {
    const x = xForIndex({ i, len: daily.length, padL: pad.l, innerW });
    const baseY = pad.t + innerH;
    const inH = (d.inputTokens / maxTok) * innerH;
    const outH = (d.outputTokens / maxTok) * innerH;
    const crH = (d.cacheReadTokens / maxTok) * innerH;
    const cwH = (d.cacheWriteTokens / maxTok) * innerH;

    return { d, x, baseY, inH, outH, crH, cwH };
  });

  return (
    <svg
      className="usage-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="Token 堆叠趋势图"
    >
      {ticks.map((t) => {
        const y = pad.t + innerH * (1 - t);
        return (
          <g key={t}>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={y}
              y2={y}
              className="usage-chart-grid"
            />
            <text x={pad.l - 8} y={y} textAnchor="end" className="usage-chart-axis">
              {fmtTokens(t * maxTok)}
            </text>
          </g>
        );
      })}

      {points.map((p) => {
        const inY = p.baseY - p.inH;
        const outY = inY - p.outH;
        const crY = outY - p.crH;
        const cwY = crY - p.cwH;
        return (
          <g key={p.d.date}>
            <rect
              x={p.x - barW / 2}
              y={inY}
              width={barW}
              height={Math.max(0, p.inH)}
              className="usage-chart-seg-in"
            />
            <rect
              x={p.x - barW / 2}
              y={outY}
              width={barW}
              height={Math.max(0, p.outH)}
              className="usage-chart-seg-out"
            />
            <rect
              x={p.x - barW / 2}
              y={crY}
              width={barW}
              height={Math.max(0, p.crH)}
              className="usage-chart-seg-cache-r"
            />
            <rect
              x={p.x - barW / 2}
              y={cwY}
              width={barW}
              height={Math.max(0, p.cwH)}
              className="usage-chart-seg-cache-w"
            />

            <title>
              {p.d.date}: in {fmtTokens(p.d.inputTokens)} / out {fmtTokens(p.d.outputTokens)} · cache r{" "}
              {fmtTokens(p.d.cacheReadTokens)} / w {fmtTokens(p.d.cacheWriteTokens)} · {fmtCost(p.d.costUsd)}
            </title>
          </g>
        );
      })}

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
            {dateLabel(p.d.date)}
          </text>
        ))}
    </svg>
  );
}

export function DailyCostChart({
  daily,
}: {
  daily: UsageDailyPoint[];
}) {
  const w = 720;
  const h = 210;
  const pad = { t: 14, r: 16, b: 28, l: 52 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const maxCost = Math.max(...daily.map((d) => d.costUsd), 0.0001);
  const ticks = [0, 0.5, 1];

  const points = daily.map((d, i) => {
    const x = xForIndex({ i, len: daily.length, padL: pad.l, innerW });
    const y = pad.t + innerH - (d.costUsd / maxCost) * innerH;
    return { x, y, d };
  });

  const baseY = pad.t + innerH;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  const areaPath = [
    `M${points[0].x.toFixed(1)},${baseY.toFixed(1)}`,
    ...points.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    `L${points[points.length - 1].x.toFixed(1)},${baseY.toFixed(1)}`,
    "Z",
  ].join(" ");

  return (
    <svg
      className="usage-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="费用趋势图"
    >
      {ticks.map((t) => {
        const y = pad.t + innerH * (1 - t);
        return (
          <g key={t}>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={y}
              y2={y}
              className="usage-chart-grid"
            />
            <text x={pad.l - 8} y={y} textAnchor="end" className="usage-chart-axis">
              {fmtCost(t * maxCost)}
            </text>
          </g>
        );
      })}

      <path d={areaPath} className="usage-chart-cost-area" />
      <path d={linePath} className="usage-chart-line" fill="none" />
      {points.map((p) => (
        <circle
          key={`c-${p.d.date}`}
          cx={p.x}
          cy={p.y}
          r={2.5}
          className="usage-chart-dot"
        >
          <title>
            {p.d.date}: {fmtCost(p.d.costUsd)} / runs {p.d.runCount}
          </title>
        </circle>
      ))}

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
            {dateLabel(p.d.date)}
          </text>
        ))}
    </svg>
  );
}

export type UsageRankRow = { label: string; value: number; title?: string };

export function HorizontalRankChart({
  rows,
  formatValue = fmtCost,
  topN = 8,
}: {
  rows: UsageRankRow[];
  formatValue?: (v: number) => string;
  topN?: number;
}) {
  const w = 560;
  const h = 220;
  const pad = { t: 14, r: 14, b: 14, l: 148 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const data = rows.slice(0, topN);
  const maxV = Math.max(...data.map((r) => r.value), 0.0001);
  const rowH = data.length > 0 ? innerH / data.length : innerH;
  const barH = Math.max(10, rowH * 0.55);

  return (
    <svg
      className="usage-chart"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label="排行图"
    >
      {data.length === 0 ? null : (
        <>
          {data.map((r, i) => {
            const yCenter = pad.t + i * rowH + rowH / 2;
            const x0 = pad.l;
            const barW = (r.value / maxV) * innerW;
            return (
              <g key={`${r.label}-${r.value}-${i}`}>
                <text
                  x={pad.l - 8}
                  y={yCenter}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="usage-chart-axis"
                >
                  {r.label.length > 22 ? r.label.slice(0, 21) + "…" : r.label}
                </text>
                <rect
                  x={x0}
                  y={yCenter - barH / 2}
                  width={Math.max(2, barW)}
                  height={barH}
                  className="usage-rank-bar"
                >
                  <title>{r.title ?? `${r.label}: ${formatValue(r.value)}`}</title>
                </rect>
                <text
                  x={w - pad.r}
                  y={yCenter}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="usage-chart-axis"
                >
                  {formatValue(r.value)}
                </text>
              </g>
            );
          })}
        </>
      )}
    </svg>
  );
}

// Keep these exports referenced by consumers (avoid TS unused warnings).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _usageChartTypes = {} as {
  UsageModelRow: UsageModelRow;
  UsageAgentRow: UsageAgentRow;
};

