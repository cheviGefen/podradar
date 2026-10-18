import { useState } from "react";

import type { ClusterEvent } from "../api";
import { clockTime } from "../format";

interface Props {
  events: ClusterEvent[] | undefined; // undefined until the first answer
  error: string | null;
}

export function Timeline({ events, error }: Props) {
  const [warningsOnly, setWarningsOnly] = useState(false);
  const shown = (events ?? []).filter((event) => !warningsOnly || event.type === "Warning");

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Events</h2>
        <label className="toggle">
          <input type="checkbox" checked={warningsOnly} onChange={(e) => setWarningsOnly(e.target.checked)} />
          Warnings only
        </label>
      </div>

      {error && <p className="notice">History is unavailable: {error}</p>}

      {events && shown.length === 0 && (
        <p className="empty">
          {warningsOnly ? "No warnings in the latest events." : "No events yet. Delete a pod and watch what happens."}
        </p>
      )}

      <ol className="events">
        {shown.map((event) => (
          <li
            key={`${event.timestamp}-${event.reason}-${event.pod ?? event.deployment}`}
            className={`event event-${event.type}`}
          >
            <time dateTime={event.timestamp}>{clockTime(event.timestamp)}</time>
            <span className="event-type" role="img" aria-label={event.type}>
              {event.type === "Warning" ? "▲" : "●"}
            </span>
            <span className="event-reason">{event.reason}</span>
            <span className="event-object mono" title={event.pod ?? event.deployment}>
              {event.pod ?? event.deployment}
            </span>
            <span className="event-message">{event.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
