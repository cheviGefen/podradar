import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotFoundError } from "./errors.js";
import { MockCluster } from "./mock.js";
import type { ClusterEvent, Recovery } from "./models.js";

const NO_FAILURES = { crashChance: 0, deathChance: 0 };

// A clock that moves only when the test says so, so recovery times come out exact
function fakeClock() {
  let ms = Date.parse("2026-01-01T12:00:00Z");
  return {
    now: () => new Date(ms),
    advance: (seconds: number) => {
      ms += seconds * 1000;
    },
  };
}

/** A cluster that keeps every event and recovery it reports, with a fake clock. */
function recordingCluster(options: { crashChance?: number; deathChance?: number; random?: () => number } = {}) {
  const clock = fakeClock();
  const events: ClusterEvent[] = [];
  const recoveries: Recovery[] = [];
  const cluster = new MockCluster({
    ...NO_FAILURES,
    ...options,
    now: clock.now,
    onEvent: (event) => events.push(event),
    onRecovery: (recovery) => recoveries.push(recovery),
  });
  // One tick that takes two seconds, like the default MOCK_TICK_SECONDS
  const tick = () => {
    clock.advance(2);
    cluster.tick();
  };
  return { cluster, events, recoveries, tick };
}

const reasonsFor = (events: ClusterEvent[], pod: string) =>
  events.filter((event) => event.pod === pod).map((event) => event.reason);

// A small seeded random generator (mulberry32), so the random run below is the same every time
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function podsOf(cluster: MockCluster, deployment: string) {
  return cluster.snapshot().pods.filter((pod) => pod.deployment === deployment);
}

/** Every deployment has exactly its desired number of pods, all running and all on the current template. */
function isSettled(cluster: MockCluster): boolean {
  const { deployments, pods } = cluster.snapshot();
  return deployments.every((deployment) => {
    const own = pods.filter((pod) => pod.deployment === deployment.name);
    return (
      own.length === deployment.replicas &&
      own.every((pod) => pod.status === "Running") &&
      deployment.updated_replicas === deployment.replicas
    );
  });
}

describe("MockCluster", () => {
  it("starts with every deployment at its desired size", () => {
    assert.ok(isSettled(new MockCluster(NO_FAILURES)));
  });

  it("scales a deployment up and down", () => {
    const cluster = new MockCluster(NO_FAILURES);

    cluster.scale("web", 5);
    assert.equal(podsOf(cluster, "web").filter((pod) => pod.status === "Pending").length, 2);
    cluster.tick(); // Pending -> ContainerCreating
    cluster.tick(); // ContainerCreating -> Running
    assert.ok(isSettled(cluster));

    cluster.scale("web", 1);
    assert.equal(podsOf(cluster, "web").filter((pod) => pod.status === "Terminating").length, 4);
    cluster.tick();
    assert.equal(podsOf(cluster, "web").length, 1);
  });

  it("replaces a deleted pod right away", () => {
    const cluster = new MockCluster(NO_FAILURES);
    const victim = podsOf(cluster, "api")[0].name;

    cluster.deletePod(victim);

    const pods = podsOf(cluster, "api");
    assert.equal(pods.find((pod) => pod.name === victim)?.status, "Terminating");
    assert.equal(pods.filter((pod) => pod.status === "Pending").length, 1);
  });

  it("rolls out a restart without dropping below the desired count", () => {
    const cluster = new MockCluster(NO_FAILURES);
    cluster.restart("web");

    for (let tick = 1; !isSettled(cluster); tick++) {
      assert.ok(tick <= 10, "the rollout did not finish within 10 ticks");
      cluster.tick();
      const pods = podsOf(cluster, "web");
      const running = pods.filter((pod) => pod.status === "Running").length;
      const alive = pods.filter((pod) => pod.status !== "Terminating").length;
      assert.ok(running >= 3, `only ${running} pods running: maxUnavailable=0 is broken`);
      assert.ok(alive <= 4, `${alive} pods alive: maxSurge=1 is broken`);
    }
  });

  it("always settles back to the desired state after random failures and actions", () => {
    const random = seededRandom(7);
    const cluster = new MockCluster({ random });
    const deployments = ["web", "api", "worker"];
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];

    for (let tick = 0; tick < 5000; tick++) {
      const roll = random();
      if (roll < 0.03) {
        cluster.scale(pick(deployments), Math.floor(random() * 11));
      } else if (roll < 0.06) {
        const pods = cluster.snapshot().pods;
        if (pods.length > 0) {
          cluster.deletePod(pick(pods).name);
        }
      } else if (roll < 0.08) {
        cluster.restart(pick(deployments));
      }
      cluster.tick();
    }

    // Once the failures stop, the cluster must find its way back. A rollout of 10 pods takes about 20 ticks.
    cluster.options.crashChance = 0;
    cluster.options.deathChance = 0;
    for (let tick = 1; !isSettled(cluster); tick++) {
      assert.ok(tick <= 50, "the cluster did not settle within 50 ticks");
      cluster.tick();
    }
  });

  it("reports a deleted pod and the whole life of its replacement", () => {
    const { cluster, events, tick } = recordingCluster();
    const before = podsOf(cluster, "api").map((pod) => pod.name);
    const victim = before[0];

    cluster.deletePod(victim);
    tick();
    tick();

    assert.deepEqual(reasonsFor(events, victim), ["Killing"]);
    const replacement = podsOf(cluster, "api").find((pod) => !before.includes(pod.name))!;
    assert.equal(replacement.status, "Running");
    assert.deepEqual(reasonsFor(events, replacement.name), ["SuccessfulCreate", "Scheduled", "Started"]);
  });

  it("times how long a deleted pod takes to be replaced", () => {
    const { cluster, recoveries, tick } = recordingCluster();
    const victim = podsOf(cluster, "web")[0].name;

    cluster.deletePod(victim);
    tick(); // the replacement: Pending -> ContainerCreating
    tick(); // ContainerCreating -> Running

    assert.equal(recoveries.length, 1);
    const recovery = recoveries[0];
    assert.equal(recovery.pod, victim);
    assert.equal(recovery.cause, "deleted");
    assert.equal(recovery.seconds, 4);
    assert.equal(podsOf(cluster, "web").find((pod) => pod.name === recovery.replacement)?.status, "Running");
  });

  it("times the recovery after an eviction too", () => {
    // deathChance 1: every tick evicts one running pod
    const { recoveries, events, tick, cluster } = recordingCluster({ deathChance: 1 });
    tick();
    const evicted = events.find((event) => event.reason === "Evicted")!;
    assert.equal(evicted.type, "Warning");
    cluster.options.deathChance = 0;
    tick();
    tick();
    assert.equal(recoveries.length, 1);
    assert.equal(recoveries[0].pod, evicted.pod);
    assert.equal(recoveries[0].cause, "evicted");
  });

  it("does not count scaling down or a rollout as a lost pod", () => {
    const { cluster, recoveries, tick } = recordingCluster();
    cluster.scale("web", 1);
    cluster.restart("api");
    for (let i = 0; i < 10; i++) tick();
    assert.ok(isSettled(cluster));
    assert.equal(recoveries.length, 0);
  });

  it("reports scaling, a crash, and the start and end of a rollout", () => {
    const { cluster, events, tick } = recordingCluster();

    cluster.scale("worker", 2);
    const scaled = events.find((event) => event.reason === "ScalingReplicaSet")!;
    assert.equal(scaled.deployment, "worker");
    assert.equal(scaled.message, "Scaled from 1 to 2 pods");

    cluster.restart("web");
    while (!isSettled(cluster)) tick();
    const rollout = events.filter((event) => event.deployment === "web" && event.pod === null);
    assert.deepEqual(
      rollout.map((event) => event.reason),
      ["RolloutStarted", "RolloutComplete"],
    );

    cluster.options.crashChance = 1;
    tick();
    const crash = events.at(-1)!;
    assert.equal(crash.reason, "BackOff");
    assert.equal(crash.type, "Warning");
  });

  it("rejects names that do not exist", () => {
    const cluster = new MockCluster(NO_FAILURES);
    assert.throws(() => cluster.scale("nope", 1), NotFoundError);
    assert.throws(() => cluster.restart("nope"), NotFoundError);
    assert.throws(() => cluster.deletePod("nope"), NotFoundError);
  });
});
