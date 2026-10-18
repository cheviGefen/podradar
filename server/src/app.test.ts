import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import type { Express } from "express";

import { createApp } from "./app.js";
import { MockCluster } from "./cluster/mock.js";
import type { ClusterEvent } from "./cluster/models.js";

/**
 * Runs an app for the tests of one describe block, and returns a function that builds URLs to it.
 * The server starts in `before`, when the block's tests are about to run, not when the file loads.
 */
function serve(makeApp: () => Express): (path: string) => string {
  let server: Server;
  let base = "";
  before(async () => {
    server = makeApp().listen(0); // port 0: the operating system picks a free port
    await once(server, "listening");
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());
  return (path) => base + path;
}

describe("API", () => {
  const cluster = new MockCluster({ crashChance: 0, deathChance: 0 });
  const url = serve(() => createApp({ cluster }));

  const scale = (deployment: string, body: string) =>
    fetch(url(`/api/deployments/${deployment}/scale`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

  it("returns the cluster", async () => {
    const response = await fetch(url("/api/cluster"));
    assert.equal(response.status, 200);
    const cluster = await response.json();
    assert.equal(cluster.nodes.length, 2);
    assert.equal(cluster.pods.length, 6);
  });

  it("scales a deployment", async () => {
    const response = await scale("worker", JSON.stringify({ replicas: 3 }));
    assert.equal(response.status, 204);
    const worker = cluster.snapshot().deployments.find((deployment) => deployment.name === "worker");
    assert.equal(worker?.replicas, 3);
  });

  it("rejects a replica count that is missing or out of range", async () => {
    for (const body of [{ replicas: 11 }, { replicas: -1 }, { replicas: 1.5 }, { replicas: "3" }, {}]) {
      const response = await scale("worker", JSON.stringify(body));
      assert.equal(response.status, 422, `expected 422 for ${JSON.stringify(body)}`);
    }
  });

  it("rejects a body that is not JSON", async () => {
    const response = await scale("worker", "{oops");
    assert.equal(response.status, 400);
  });

  it("restarts a deployment and deletes a pod", async () => {
    const restart = await fetch(url("/api/deployments/web/restart"), { method: "POST" });
    assert.equal(restart.status, 204);

    const pod = cluster.snapshot().pods[0].name;
    const deletion = await fetch(url(`/api/pods/${pod}`), { method: "DELETE" });
    assert.equal(deletion.status, 204);
  });

  it("is ready when no database is configured", async () => {
    const response = await fetch(url("/api/readyz"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).database, "not configured");
  });

  it("answers 503 for history when no database is configured", async () => {
    assert.equal((await fetch(url("/api/events"))).status, 503);
    assert.equal((await fetch(url("/api/recoveries"))).status, 503);
  });

  it("answers 404 in JSON for names and routes that do not exist", async () => {
    for (const [method, path] of [
      ["POST", "/api/deployments/nope/restart"],
      ["DELETE", "/api/pods/nope"],
      ["GET", "/api/nope"],
    ]) {
      const response = await fetch(url(path), { method });
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.ok((await response.json()).detail);
    }
  });
});

describe("API with a database", () => {
  // A stand-in for MongoDB that the test can take down
  let databaseUp = true;
  const database = {
    ping: async () => {
      if (!databaseUp) throw new Error("unreachable");
    },
  };
  // A stand-in for the history in MongoDB, which remembers the limit it was asked for
  let askedLimit = 0;
  const event: ClusterEvent = {
    timestamp: new Date("2026-01-01T12:00:00Z"),
    type: "Warning",
    reason: "BackOff",
    deployment: "web",
    pod: "web-abc-def",
    message: "Container crashed, restarting it after a back-off",
  };
  const history = {
    latestEvents: async (limit: number) => {
      askedLimit = limit;
      return [event];
    },
    latestRecoveries: async () => [],
  };

  const url = serve(() => createApp({ cluster: new MockCluster(), database, history }));

  it("returns the events, with the limit from the query or 50", async () => {
    const response = await fetch(url("/api/events"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ ...event, timestamp: "2026-01-01T12:00:00.000Z" }]);
    assert.equal(askedLimit, 50);

    await fetch(url("/api/events?limit=5"));
    assert.equal(askedLimit, 5);
  });

  it("rejects a limit out of range", async () => {
    for (const limit of ["0", "201", "abc"]) {
      const response = await fetch(url(`/api/events?limit=${limit}`));
      assert.equal(response.status, 422, `expected 422 for limit=${limit}`);
    }
  });

  it("returns the recoveries", async () => {
    const response = await fetch(url("/api/recoveries"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), []);
  });

  // Last in this block: it takes the database down
  it("is ready only while the database answers, and stays alive either way", async () => {
    assert.equal((await fetch(url("/api/readyz"))).status, 200);

    databaseUp = false;
    const readiness = await fetch(url("/api/readyz"));
    assert.equal(readiness.status, 503);
    assert.equal((await readiness.json()).database, "unreachable");
    assert.equal((await fetch(url("/api/healthz"))).status, 200);
  });
});
