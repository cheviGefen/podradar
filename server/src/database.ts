import { MongoClient, type Db } from "mongodb";

// The part of the driver's client that Database uses, so tests can pass a fake one
export interface Client {
  connect(): Promise<unknown>;
  db(): Db;
  close(): Promise<void>;
}

export type ClientFactory = (uri: string) => Client;

// An operation that cannot reach MongoDB fails after 2 seconds
const createClient: ClientFactory = (uri) => new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });

/**
 * The connection to MongoDB. It connects on first use, not at startup: in Kubernetes there is no
 * startup order, so MongoDB may not be reachable yet when the server starts. A connection attempt that
 * fails is thrown away, and the next call tries again with a fresh client, so the server recovers on its
 * own once MongoDB is up (the readiness probe calls ping every few seconds). Once connected, the driver
 * itself reconnects after MongoDB restarts.
 */
export class Database {
  private readonly uri: string;
  private readonly create: ClientFactory;
  private client: Client | null = null;
  // The attempt in progress, shared by every call that arrives while it runs
  private connecting: Promise<Client> | null = null;

  constructor(uri: string, create: ClientFactory = createClient) {
    this.uri = uri;
    this.create = create;
  }

  /** The database named in the connection string, connecting first if needed. Throws while MongoDB cannot be reached. */
  async db(): Promise<Db> {
    return (await this.connect()).db();
  }

  /** Resolves if MongoDB answers right now, and throws if it does not. */
  async ping(): Promise<void> {
    await (await this.db()).command({ ping: 1 });
  }

  async close(): Promise<void> {
    await this.client?.close();
    this.client = null;
  }

  private connect(): Promise<Client> {
    if (this.client) {
      return Promise.resolve(this.client);
    }
    this.connecting ??= this.attempt().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async attempt(): Promise<Client> {
    const client = this.create(this.uri);
    try {
      await client.connect();
    } catch (error) {
      // A client whose first connection failed stays closed for good ("Topology is closed"),
      // so throw it away: the next call starts from a fresh one
      await client.close().catch(() => {});
      throw error;
    }
    console.log("Connected to MongoDB");
    this.client = client;
    return client;
  }
}
