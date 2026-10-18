import type { ClusterSnapshot } from "../api";
import { rolloutState } from "../rollout";

export function Summary({ cluster }: { cluster: ClusterSnapshot }) {
  const alive = cluster.pods.filter((pod) => pod.status !== "Terminating").length;
  const running = cluster.pods.filter((pod) => pod.status === "Running").length;
  const restarts = cluster.pods.reduce((total, pod) => total + pod.restarts, 0);
  const healthy = cluster.deployments.filter((deployment) => rolloutState(deployment, cluster.pods).healthy).length;
  const readyNodes = cluster.nodes.filter((node) => node.ready).length;

  const tiles = [
    { label: "Nodes ready", value: `${readyNodes}/${cluster.nodes.length}` },
    { label: "Pods running", value: `${running}/${alive}` },
    { label: "Deployments healthy", value: `${healthy}/${cluster.deployments.length}` },
    { label: "Container restarts", value: String(restarts) },
  ];

  return (
    <section className="summary" aria-label="Cluster summary">
      {tiles.map((tile) => (
        <div key={tile.label} className="tile">
          <div className="tile-label">{tile.label}</div>
          <div className="tile-value">{tile.value}</div>
        </div>
      ))}
    </section>
  );
}
