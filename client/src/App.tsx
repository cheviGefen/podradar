import { useCallback, useEffect, useState } from "react";

import {
  deletePod,
  getCluster,
  getEvents,
  getHealth,
  getRecoveries,
  restartDeployment,
  scaleDeployment,
  type Health,
} from "./api";
import { ClusterMap } from "./components/ClusterMap";
import { Deployments } from "./components/Deployments";
import { Header } from "./components/Header";
import { Recoveries } from "./components/Recoveries";
import { Summary } from "./components/Summary";
import { Timeline } from "./components/Timeline";
import { usePolling } from "./usePolling";

const CLUSTER_POLL_MS = 1000;
const HISTORY_POLL_MS = 2000;

async function loadHistory() {
  const [events, recoveries] = await Promise.all([getEvents(50), getRecoveries(20)]);
  return { events, recoveries };
}

export default function App() {
  const cluster = usePolling(getCluster, CLUSTER_POLL_MS);
  const history = usePolling(loadHistory, HISTORY_POLL_MS);
  const connected = cluster.data !== null && cluster.error === null;
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Asked again on every reconnect: the server may come back as a new version
  useEffect(() => {
    if (connected) {
      getHealth().then(setHealth, () => setHealth(null));
    }
  }, [connected]);

  const refreshCluster = cluster.refresh;
  const refreshHistory = history.refresh;

  // Runs an action, shows its error if it fails, and refreshes the map and the history right away
  const run = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      refreshCluster();
      refreshHistory();
    },
    [refreshCluster, refreshHistory],
  );

  const killRandomPod = () => {
    const candidates = cluster.data?.pods.filter((pod) => pod.status !== "Terminating") ?? [];
    if (candidates.length > 0) {
      const victim = candidates[Math.floor(Math.random() * candidates.length)];
      run(() => deletePod(victim.name));
    }
  };

  return (
    <div className="app">
      <Header health={health} connected={connected} onChaos={killRandomPod} />

      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}

      {cluster.data ? (
        <>
          <Summary cluster={cluster.data} />
          <main className="layout">
            <Deployments
              deployments={cluster.data.deployments}
              pods={cluster.data.pods}
              onScale={(name, replicas) => run(() => scaleDeployment(name, replicas))}
              onRestart={(name) => run(() => restartDeployment(name))}
            />
            <ClusterMap cluster={cluster.data} onDeletePod={(name) => run(() => deletePod(name))} />
          </main>
          <section className="history-layout">
            <Timeline events={history.data?.events} error={history.error} />
            <Recoveries recoveries={history.data?.recoveries} error={history.error} />
          </section>
        </>
      ) : (
        <p className="loading">Connecting to the server…</p>
      )}
    </div>
  );
}
