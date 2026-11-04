import type { Collection } from "mongodb";

import type { ClusterEvent, Recovery } from "./cluster/models.js";
import type { Database } from "./database.js";

/**
 * Keeps what happened in the cluster in MongoDB: the events, and how long each recovery took.
 * The collections and their TTL indexes come from database/init/01-init.js.
 */
export class History {
  private readonly database: Pick<Database, "db">;
  private writesFailing = false;

  constructor(database: Pick<Database, "db">) {
    this.database = database;
  }

  recordEvent(event: ClusterEvent): void {
    // A copy: insertOne adds an _id to the object it gets
    const document = { ...event };
    this.write(this.events().then((events) => events.insertOne(document)));
  }

  recordRecovery(recovery: Recovery): void {
    const document = { ...recovery };
    this.write(this.recoveries().then((recoveries) => recoveries.insertOne(document)));
  }

  /** Newest first */
  async latestEvents(limit: number): Promise<ClusterEvent[]> {
    const events = await this.events();
    return events.find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).limit(limit).toArray();
  }

  /** Newest first */
  async latestRecoveries(limit: number): Promise<Recovery[]> {
    const recoveries = await this.recoveries();
    return recoveries.find({}, { projection: { _id: 0 } }).sort({ recovered_at: -1 }).limit(limit).toArray();
  }

  // Asked for on every operation rather than once at startup, so a database that was not reachable
  // when the server started is picked up as soon as it is
  private async events(): Promise<Collection<ClusterEvent>> {
    return (await this.database.db()).collection<ClusterEvent>("events");
  }

  private async recoveries(): Promise<Collection<Recovery>> {
    return (await this.database.db()).collection<Recovery>("recoveries");
  }

  // Writes run in the background: the simulation never waits for MongoDB. While MongoDB is down
  // the writes are lost, and the log says so once, not on every tick.
  private write(operation: Promise<unknown>): void {
    operation.then(
      () => {
        if (this.writesFailing) {
          this.writesFailing = false;
          console.log("MongoDB is back: recording history again");
        }
      },
      (error: Error) => {
        if (!this.writesFailing) {
          this.writesFailing = true;
          console.error(`Cannot write history to MongoDB, events are lost until it is back: ${error.message}`);
        }
      },
    );
  }
}
