import { useState } from "react";

import type { Recovery } from "../api";
import { clockTime, seconds } from "../format";

interface Props {
  recoveries: Recovery[] | undefined; // newest first; undefined until the first answer
  error: string | null;
}

export function Recoveries({ recoveries, error }: Props) {
  const list = recoveries ?? [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Recovery time</h2>
        {list.length > 0 && <span className="muted small">last {list.length} lost pods</span>}
      </div>

      {error && <p className="notice">History is unavailable: {error}</p>}

      {recoveries && list.length === 0 && (
        <p className="empty">Nothing to measure yet. Delete a running pod, and the time until its replacement runs shows up here.</p>
      )}

      {list.length > 0 && <RecoveryChart list={list} />}
    </section>
  );
}

const keyOf = (recovery: Recovery) => `${recovery.recovered_at}-${recovery.pod}`;

function RecoveryChart({ list }: { list: Recovery[] }) {
  // By key, not position: new recoveries shift the bars, and the tooltip must stay on its own bar
  const [hovered, setHovered] = useState<string | null>(null);
  // Oldest on the left, newest on the right
  const bars = [...list].reverse();
  const values = list.map((recovery) => recovery.seconds);
  const max = Math.max(...values);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const activeIndex = bars.findIndex((recovery) => keyOf(recovery) === hovered);
  const active = activeIndex === -1 ? null : bars[activeIndex];

  return (
    <>
      <div className="recovery-stats">
        <Stat label="Last" value={seconds(list[0].seconds)} />
        <Stat label="Average" value={seconds(average)} />
        <Stat label="Slowest" value={seconds(max)} />
      </div>

      <div
        className="chart"
        role="img"
        aria-label={`Recovery times of the last ${list.length} lost pods, between ${seconds(Math.min(...values))} and ${seconds(max)}`}
        onMouseLeave={() => setHovered(null)}
      >
        <div className="chart-max muted">{seconds(max)}</div>
        <div className="bars">
          {bars.map((recovery) => (
            // The whole column is the hover target, not just the bar, so short bars are easy to hit
            <div
              key={keyOf(recovery)}
              className={`bar-slot ${hovered === keyOf(recovery) ? "active" : ""}`}
              onMouseEnter={() => setHovered(keyOf(recovery))}
            >
              <div className="bar" style={{ height: `${Math.max((recovery.seconds / max) * 100, 2)}%` }} />
            </div>
          ))}
        </div>
        {active && (
          <div className="chart-tooltip" style={tooltipPosition(activeIndex, bars.length)}>
            <strong>{seconds(active.seconds)}</strong> · {active.cause} at {clockTime(active.started_at)}
            <div className="mono">{active.pod}</div>
            <div className="muted">replaced by</div>
            <div className="mono">{active.replacement}</div>
          </div>
        )}
      </div>
      <div className="chart-axis muted">
        <span>older</span>
        <span>newer</span>
      </div>

      <details className="table-view">
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>Lost at</th>
              <th>Pod</th>
              <th>Cause</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {list.map((recovery) => (
              <tr key={keyOf(recovery)}>
                <td>{clockTime(recovery.started_at)}</td>
                <td className="mono">{recovery.pod}</td>
                <td>{recovery.cause}</td>
                <td className="num">{seconds(recovery.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="tile-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

// Centered over the bar, but kept inside the chart near its edges
function tooltipPosition(index: number, count: number) {
  const center = ((index + 0.5) / count) * 100;
  const shift = center < 25 ? "0" : center > 75 ? "-100%" : "-50%";
  return { left: `${center}%`, transform: `translateX(${shift})` };
}
