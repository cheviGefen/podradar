import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Db } from "mongodb";

import { Database } from "./database.js";

/**
 * Stand-ins for the driver's client: each new client's connect() fails while MongoDB is "down"
 * (the first `failures` clients), and works after that. Counts how many were created and closed.
 */
function fakeClients(failures: number) {
  const counts = { created: 0, closed: 0 };
  const db = { command: async () => ({ ok: 1 }) } as unknown as Db;
  const create = () => {
    counts.created += 1;
    const mongoIsDown = counts.created <= failures;
    return {
      connect: async () => {
        if (mongoIsDown) throw new Error("connect ECONNREFUSED mongo:27017");
      },
      db: () => db,
      close: async () => {
        counts.closed += 1;
      },
    };
  };
  return { create, counts };
}

const URI = "mongodb://mongo:27017/podradar";

describe("Database", () => {
  it("does not connect before it is used", () => {
    const clients = fakeClients(0);
    new Database(URI, clients.create);
    assert.equal(clients.counts.created, 0);
  });

  it("recovers on its own once MongoDB is up, after failing while it was down", async () => {
    // The cold start that got the server stuck: MongoDB is not up yet when the server starts
    const clients = fakeClients(2);
    const database = new Database(URI, clients.create);

    await assert.rejects(database.ping(), /ECONNREFUSED/);
    await assert.rejects(database.ping(), /ECONNREFUSED/);
    await database.ping(); // MongoDB is up now

    // Each failed client was thrown away, and a fresh one was created for the next try
    assert.deepEqual(clients.counts, { created: 3, closed: 2 });
  });

  it("keeps one client once connected", async () => {
    const clients = fakeClients(0);
    const database = new Database(URI, clients.create);
    await database.ping();
    await database.ping();
    await database.db();
    assert.equal(clients.counts.created, 1);
  });

  it("shares one connection attempt between calls that arrive together", async () => {
    const clients = fakeClients(0);
    const database = new Database(URI, clients.create);
    await Promise.all([database.ping(), database.ping(), database.db()]);
    assert.equal(clients.counts.created, 1);
  });
});
