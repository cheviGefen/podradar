import type { ClusterSnapshot, Pod, PodStatus } from "../api";

const STATUSES: PodStatus[] = ["Running", "Pending", "ContainerCreating", "CrashLoopBackOff", "Terminating"];

interface Props {
  cluster: ClusterSnapshot;
  onDeletePod: (name: string) => void;
}

export function ClusterMap({ cluster, onDeletePod }: Props) {
  const newest = newestTemplates(cluster.pods);
  const deploymentNames = cluster.deployments.map((deployment) => deployment.name);

  const podGroups = (pods: Pod[]) =>
    deploymentNames
      .map((name) => ({ name, pods: pods.filter((pod) => pod.deployment === name) }))
      .filter((group) => group.pods.length > 0)
      .map((group) => (
        <div key={group.name} className="group">
          <div className="group-label mono">{group.name}</div>
          <div className="pods">
            {group.pods.map((pod) => (
              <PodDot
                key={pod.name}
                pod={pod}
                old={pod.template_hash !== newest.get(pod.deployment)}
                onDelete={onDeletePod}
              />
            ))}
          </div>
        </div>
      ));

  const unscheduled = cluster.pods.filter((pod) => pod.node === null);

  return (
    <section className="panel">
      <h2>Cluster map</h2>

      <div className="unscheduled">
        <span className="muted">Waiting for a node</span>
        <div className="pods">
          {unscheduled.map((pod) => (
            <PodDot key={pod.name} pod={pod} old={false} onDelete={onDeletePod} />
          ))}
        </div>
      </div>

      <div className="nodes">
        {cluster.nodes.map((node) => (
          <div key={node.name} className="node">
            <div className="node-head mono">
              <span>{node.name}</span>
              <span className={node.ready ? "ok-text" : "bad-text"}>{node.ready ? "Ready" : "NotReady"}</span>
            </div>
            {podGroups(cluster.pods.filter((pod) => pod.node === node.name))}
          </div>
        ))}
      </div>

      <ul className="legend" aria-label="Legend">
        {STATUSES.map((status) => (
          <li key={status}>
            <span className={`pod pod-${status}`} /> {status}
          </li>
        ))}
        <li>
          <span className="pod pod-Running pod-old" /> Old version, during a rollout
        </li>
      </ul>
    </section>
  );
}

function PodDot({ pod, old, onDelete }: { pod: Pod; old: boolean; onDelete: (name: string) => void }) {
  return (
    <button
      className={`pod pod-${pod.status} ${old ? "pod-old" : ""}`}
      title={`${pod.name}\n${pod.status} · ${pod.restarts} restarts · age ${age(pod.created_at)}\nClick to delete`}
      aria-label={`Delete pod ${pod.name}, ${pod.status}`}
      disabled={pod.status === "Terminating"}
      onClick={() => onDelete(pod.name)}
    >
      {pod.restarts > 0 && <span className="restarts">{pod.restarts}</span>}
    </button>
  );
}

// During a rollout a deployment has pods from two templates, and the newest pod is on the new one
function newestTemplates(pods: Pod[]): Map<string, string> {
  const newest = new Map<string, Pod>();
  for (const pod of pods) {
    const current = newest.get(pod.deployment);
    if (!current || pod.created_at > current.created_at) {
      newest.set(pod.deployment, pod);
    }
  }
  return new Map([...newest].map(([deployment, pod]) => [deployment, pod.template_hash]));
}

// Pod age the way `kubectl get pods` shows it: 45s, 3m, 2h
function age(createdAt: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(createdAt)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}
