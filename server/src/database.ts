import { MongoClient, type Db } from "mongodb";

export class Database {
  private readonly client: MongoClient;
  readonly db: Db;

  constructor(uri: string) {
    // The driver connects in the background and reconnects by itself, so the server starts and keeps
    // running while MongoDB is down. An operation that cannot reach MongoDB fails after 2 seconds.
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });
    // The database named in the connection string: podradar
    this.db = this.client.db();
  }

  /** Resolves if MongoDB answers right now, and throws if it does not. */
  async ping(): Promise<void> {
    await this.db.command({ ping: 1 });
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
