import { NotFoundError } from "./errors.js";
import type { ClusterEvent, ClusterNode, ClusterSnapshot, Pod, PodStatus, Recovery } from "./models.js";

const NAMESPACE = "default";
const NODE_NAMES = ["node-1", "node-2"];
// Deployment name -> desired number of replicas
const DEPLOYMENTS: Record<string, number> = { web: 3, api: 2, worker: 1 };

// Kubernetes builds pod name suffixes from this alphabet: no vowels, so a random suffix never spells a word
const NAME_ALPHABET = [..."bcdfghjklmnpqrstvwxz2456789"];

// How many ticks a crashed pod waits before it runs again
const BACKOFF_TICKS = { min: 2, max: 4 };
// During a rollout, how many pods may exist above the desired count (maxSurge)
const MAX_SURGE = 1;

export interface MockOptions {
  // Chance per tick that one running pod crashes, or dies for good
  crashChance: number;
  deathChance: number;
  // Source of randomness. Tests pass a seeded one, so a random run is the same every time.
  random: () => number;
  // The current time. Tests pass a fake clock, to get exact recovery times.
  now: () => Date;
  // Called for everything that happens in the cluster
  onEvent: (event: ClusterEvent) => void;
  // Called when a deployment gets back a running pod it had lost
  onRecovery: (recovery: Recovery) => void;
}

// A running pod that a deployment lost, waiting for a replacement to start
interface Outage {
  pod: string;
  cause: Recovery["cause"];
  startedAt: Date;
}

/** A simulated cluster, so the app works without Kubernetes. */
export class MockCluster {
  readonly options: MockOptions;
  private readonly nodes: ClusterNode[] = NODE_NAMES.map((name) => ({ name, ready: true }));
  private readonly desiredReplicas = new Map(Object.entries(DEPLOYMENTS));
  // Like a real ReplicaSet, all pods of one deployment share a template hash: web-7d4b9c8f6d-x2k9p
  private readonly templateHashes = new Map<string, string>();
  // Pod name -> ticks left until a crashed pod runs again
  private readonly backoffTicks = new Map<string, number>();
  // Deployment -> pods it lost and has not replaced yet, oldest first
  private readonly outages = new Map<string, Outage[]>();
  // Deployments in the middle of a rollout
  private readonly rollingOut = new Set<string>();
  private pods: Pod[] = [];

  constructor(options: Partial<MockOptions> = {}) {
    this.options = {
      crashChance: 0.15,
      deathChance: 0.05,
      random: Math.random,
      now: () => new Date(),
      onEvent: () => {},
      onRecovery: () => {},
      ...options,
    };
    for (const [deployment, replicas] of this.desiredReplicas) {
      this.templateHashes.set(deployment, this.randomSuffix(10));
      for (let i = 0; i < replicas; i++) {
        this.pods.push(this.newPod(deployment, "Running"));
      }
    }
  }

  /** Advances the simulation one tick every `tickSeconds`. Returns a function that stops it. */
  start(tickSeconds: number): () => void {
    // Node runs one thing at a time, so a tick never overlaps a request that reads or changes the cluster
    const timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        // An error thrown inside setInterval would crash the whole server
        console.error("Mock cluster tick failed", error);
      }
    }, tickSeconds * 1000);
    return () => clearInterval(timer);
  }

  /**
   * One step of the simulation: pods move along their lifecycle, random failures happen,
   * and each deployment is brought back to its desired number of pods.
   */
  tick(): void {
    this.advanceLifecycles();
    this.maybeFailAPod();
    this.reconcile();
  }

  scale(deployment: string, replicas: number): void {
    const previous = this.desiredReplicas.get(deployment);
    if (previous === undefined) {
      throw new NotFoundError(`Deployment '${deployment}' not found`);
    }
    this.desiredReplicas.set(deployment, replicas);
    if (replicas !== previous) {
      this.emit("Normal", "ScalingReplicaSet", deployment, null, `Scaled from ${previous} to ${replicas} pods`);
    }
    if (replicas < previous) {
      // Fewer pods are wanted now, so lost pods may never be replaced: stop waiting for them
      this.outages.delete(deployment);
    }
    // Like a real controller, react to the change right away instead of waiting for the next tick
    this.reconcile();
  }

  deletePod(name: string): void {
    const pod = this.pods.find((pod) => pod.name === name);
    if (!pod) {
      throw new NotFoundError(`Pod '${name}' not found`);
    }
    if (pod.status === "Terminating") {
      return;
    }
    this.terminate(pod, "deleted by a user", "deleted");
    this.reconcile();
  }

  /** Like `kubectl rollout restart`: a new pod template, so every pod gets replaced, one at a time. */
  restart(deployment: string): void {
    if (!this.templateHashes.has(deployment)) {
      throw new NotFoundError(`Deployment '${deployment}' not found`);
    }
    this.templateHashes.set(deployment, this.randomSuffix(10));
    this.rollingOut.add(deployment);
    this.emit("Normal", "RolloutStarted", deployment, null, "Restarting: every pod will be replaced, one at a time");
    this.reconcile();
  }

  snapshot(): ClusterSnapshot {
    const deployments = [...this.desiredReplicas].map(([name, replicas]) => {
      const pods = this.pods.filter((pod) => pod.deployment === name);
      return {
        name,
        namespace: NAMESPACE,
        replicas,
        ready_replicas: pods.filter((pod) => pod.status === "Running").length,
        updated_replicas: pods.filter(
          (pod) => pod.template_hash === this.templateHashes.get(name) && pod.status !== "Terminating",
        ).length,
      };
    });
    // Copies, so later ticks do not change a snapshot that was already taken
    return {
      nodes: this.nodes.map((node) => ({ ...node })),
      deployments,
      pods: this.pods.map((pod) => ({ ...pod })),
    };
  }

  private newPod(deployment: string, status: PodStatus): Pod {
    const templateHash = this.templateHashes.get(deployment)!;
    return {
      name: `${deployment}-${templateHash}-${this.randomSuffix(5)}`,
      namespace: NAMESPACE,
      deployment,
      template_hash: templateHash,
      node: status === "Pending" ? null : this.leastBusyNode(),
      status,
      restarts: 0,
      created_at: this.options.now().toISOString(),
    };
  }

  /** Spreads pods across nodes, roughly like the Kubernetes scheduler does. */
  private leastBusyNode(): string {
    const podsOn = (node: string) => this.pods.filter((pod) => pod.node === node).length;
    return NODE_NAMES.reduce((best, node) => (podsOn(node) < podsOn(best) ? node : best));
  }

  private advanceLifecycles(): void {
    // Pods that were terminating are gone now
    for (const pod of this.pods.filter((pod) => pod.status === "Terminating")) {
      this.backoffTicks.delete(pod.name);
    }
    this.pods = this.pods.filter((pod) => pod.status !== "Terminating");

    for (const pod of this.pods) {
      switch (pod.status) {
        case "Pending":
          pod.node = this.leastBusyNode();
          pod.status = "ContainerCreating";
          this.emit("Normal", "Scheduled", pod.deployment, pod.name, `Assigned to ${pod.node}`);
          break;
        case "ContainerCreating":
          pod.status = "Running";
          this.emit("Normal", "Started", pod.deployment, pod.name, "Container started");
          this.endOutage(pod);
          break;
        case "CrashLoopBackOff": {
          const ticksLeft = this.backoffTicks.get(pod.name)! - 1;
          if (ticksLeft === 0) {
            this.backoffTicks.delete(pod.name);
            pod.status = "Running";
            this.emit("Normal", "Started", pod.deployment, pod.name, `Container restarted (restart ${pod.restarts})`);
          } else {
            this.backoffTicks.set(pod.name, ticksLeft);
          }
          break;
        }
      }
    }
  }

  private maybeFailAPod(): void {
    const running = this.pods.filter((pod) => pod.status === "Running");
    if (running.length === 0) {
      return;
    }
    const { crashChance, deathChance } = this.options;
    const roll = this.options.random();
    if (roll < deathChance) {
      // The pod is gone for good; the reconcile step will replace it
      const pod = this.pick(running);
      this.emit("Warning", "Evicted", pod.deployment, pod.name, "The pod was evicted from its node");
      this.terminate(pod, "evicted", "evicted");
    } else if (roll < deathChance + crashChance) {
      // The container crashed and is restarted in place, in the same pod.
      // Simplified: a real pod shows Error first, and reaches CrashLoopBackOff only after repeated crashes.
      const pod = this.pick(running);
      pod.status = "CrashLoopBackOff";
      pod.restarts += 1;
      this.backoffTicks.set(pod.name, this.randomInt(BACKOFF_TICKS.min, BACKOFF_TICKS.max));
      this.emit("Warning", "BackOff", pod.deployment, pod.name, "Container crashed, restarting it after a back-off");
    }
  }

  /**
   * What the Deployment and ReplicaSet controllers do: compare the pods that exist with the desired
   * state and fix the difference.
   *
   * After a restart the pod template changes, and the old pods are replaced by a rolling update with
   * maxSurge=1 and maxUnavailable=0: a new pod comes up first, and only then does an old one go away.
   */
  private reconcile(): void {
    for (const [deployment, desired] of this.desiredReplicas) {
      const currentHash = this.templateHashes.get(deployment);
      // Terminating pods are on their way out, so they no longer count
      const alive = this.pods.filter((pod) => pod.deployment === deployment && pod.status !== "Terminating");
      let current = alive.filter((pod) => pod.template_hash === currentHash);
      let old = alive.filter((pod) => pod.template_hash !== currentHash);

      // More current pods than desired (after a scale down): remove the extra ones
      for (const pod of current.slice(desired)) {
        this.terminate(pod, "scaled down");
      }
      current = current.slice(0, desired);

      // An old pod may go only while enough other pods are running (maxUnavailable=0).
      // An old pod that is not running serves nothing, so it can go right away.
      let running = [...current, ...old].filter((pod) => pod.status === "Running").length;
      for (const pod of old) {
        if (pod.status !== "Running") {
          this.terminate(pod, "replaced by the new version");
        } else if (running > desired) {
          this.terminate(pod, "replaced by the new version");
          running -= 1;
        }
      }
      old = old.filter((pod) => pod.status !== "Terminating");

      // Bring the current pods up to the desired count, never more than MAX_SURGE pods above it in total
      const missing = Math.min(desired - current.length, desired + MAX_SURGE - current.length - old.length);
      for (let i = 0; i < missing; i++) {
        const pod = this.newPod(deployment, "Pending");
        this.pods.push(pod);
        this.emit("Normal", "SuccessfulCreate", deployment, pod.name, `Created pod ${pod.name}`);
      }

      const done = old.length === 0 && missing <= 0 && current.every((pod) => pod.status === "Running");
      if (this.rollingOut.has(deployment) && done) {
        this.rollingOut.delete(deployment);
        this.emit("Normal", "RolloutComplete", deployment, null, "Every pod runs the new version");
      }
    }
  }

  /** Marks a pod Terminating. If it was running and nobody wanted it gone, the deployment lost capacity. */
  private terminate(pod: Pod, why: string, lost?: Recovery["cause"]): void {
    if (lost && pod.status === "Running") {
      const outages = this.outages.get(pod.deployment) ?? [];
      outages.push({ pod: pod.name, cause: lost, startedAt: this.options.now() });
      this.outages.set(pod.deployment, outages);
    }
    pod.status = "Terminating";
    this.emit("Normal", "Killing", pod.deployment, pod.name, `Stopping pod: ${why}`);
  }

  /** A new pod started: if its deployment was waiting for a replacement, the oldest outage is over. */
  private endOutage(pod: Pod): void {
    const outage = this.outages.get(pod.deployment)?.shift();
    if (!outage) {
      return;
    }
    const recoveredAt = this.options.now();
    this.options.onRecovery({
      deployment: pod.deployment,
      pod: outage.pod,
      replacement: pod.name,
      cause: outage.cause,
      started_at: outage.startedAt,
      recovered_at: recoveredAt,
      seconds: (recoveredAt.getTime() - outage.startedAt.getTime()) / 1000,
    });
  }

  private emit(type: ClusterEvent["type"], reason: string, deployment: string, pod: string | null, message: string) {
    this.options.onEvent({ timestamp: this.options.now(), type, reason, deployment, pod, message });
  }

  private randomSuffix(length: number): string {
    return Array.from({ length }, () => this.pick(NAME_ALPHABET)).join("");
  }

  private randomInt(min: number, max: number): number {
    return min + Math.floor(this.options.random() * (max - min + 1));
  }

  private pick<T>(items: T[]): T {
    return items[Math.floor(this.options.random() * items.length)];
  }
}
