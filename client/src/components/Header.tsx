import type { Health } from "../api";

interface Props {
  health: Health | null;
  connected: boolean;
  onChaos: () => void;
}

export function Header({ health, connected, onChaos }: Props) {
  return (
    <header className="header">
      <div className="brand">
        <span className="radar" aria-hidden="true" />
        <h1>PodRadar</h1>
      </div>
      <div className="header-meta">
        <span className={`badge live ${connected ? "" : "off"}`}>{connected ? "Live" : "Disconnected"}</span>
        {health && (
          <>
            <span className="badge">{health.cluster_mode === "mock" ? "Simulated cluster" : "Real cluster"}</span>
            <span className="badge mono">{health.version}</span>
          </>
        )}
        <button className="chaos" onClick={onChaos} disabled={!connected}>
          Kill a random pod
        </button>
      </div>
    </header>
  );
}
