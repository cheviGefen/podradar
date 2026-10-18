import type { Deployment, Pod } from "./api";

/**
 * Where a deployment stands, judged the way `kubectl rollout status` does: `updated_replicas` alone is
 * not enough, because new pods count as updated as soon as they are created, while old pods may still
 * be running. A rollout is over only when no old pod is left.
 */
export function rolloutState(deployment: Deployment, pods: Pod[]) {
  const alive = pods.filter((pod) => pod.deployment === deployment.name && pod.status !== "Terminating").length;
  const oldPods = Math.max(0, alive - deployment.updated_replicas);
  const rollingOut = oldPods > 0 || deployment.updated_replicas < deployment.replicas;
  const replaced = Math.max(0, deployment.replicas - oldPods);
  return {
    rollingOut,
    healthy: !rollingOut && deployment.ready_replicas === deployment.replicas,
    // How many of the desired pods are already on the new version
    replaced,
    progress: deployment.replicas === 0 ? 1 : replaced / deployment.replicas,
  };
}
