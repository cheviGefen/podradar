import type { Collection, Db } from "mongodb";

import type { ClusterEvent, Recovery } from "./cluster/models.js";

/**
 * Keeps what happened in the cluster in MongoDB: the events, and how long each recovery took.
 * The collections and their TTL indexes come from database/init/01-init.js.
 */
export class History {
  private readonly events: Collection<ClusterEvent>;
  private readonly recoveries: Collection<Recovery>;
  private writesFailing = false;

  constructor(db: Db) {
    this.events = db.collection<ClusterEvent>("events");
    this.recoveries = db.collection<Recovery>("recoveries");
  }

  recordEvent(event: ClusterEvent): void {
    // A copy: insertOne adds an _id to the object it gets
    this.write(this.events.insertOne({ ...event }));
  }

  recordRecovery(recovery: Recovery): void {
    this.write(this.recoveries.insertOne({ ...recovery }));
  }

  /** Newest first */
  latestEvents(limit: number): Promise<ClusterEvent[]> {
    return this.events.find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).limit(limit).toArray();
  }

  /** Newest first */
  latestRecoveries(limit: number): Promise<Recovery[]> {
    return this.recoveries.find({}, { projection: { _id: 0 } }).sort({ recovered_at: -1 }).limit(limit).toArray();
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
