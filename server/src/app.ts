import express, { type NextFunction, type Request, type Response } from "express";
import { MongoError } from "mongodb";
import swaggerUi from "swagger-ui-express";

import { NotFoundError } from "./cluster/errors.js";
import type { MockCluster } from "./cluster/mock.js";
import { HistoryQuery, ScaleRequest } from "./cluster/models.js";
import { settings } from "./config.js";
import type { Database } from "./database.js";
import type { History } from "./history.js";
import { openApiDocument } from "./openapi.js";

type HistoryReader = Pick<History, "latestEvents" | "latestRecoveries">;

interface Dependencies {
  cluster: MockCluster;
  // Both optional: without MONGO_URI the server runs with no database
  database?: Pick<Database, "ping">;
  history?: HistoryReader;
}

export function createApp({ cluster, database, history }: Dependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  // Liveness: is the process alive? Never checks MongoDB, since restarting the server would not fix it.
  app.get("/api/healthz", (_req, res) => {
    res.json({
      status: "ok",
      version: settings.APP_VERSION,
      cluster_mode: settings.CLUSTER_MODE,
    });
  });

  // Readiness: can the server do its work right now? 503 while MongoDB cannot be reached.
  app.get("/api/readyz", async (_req, res) => {
    if (!database) {
      res.json({ status: "ready", database: "not configured" });
      return;
    }
    try {
      await database.ping();
      res.json({ status: "ready", database: "ok" });
    } catch {
      res.status(503).json({ status: "not ready", database: "unreachable" });
    }
  });

  app.get("/api/cluster", (_req, res) => {
    res.json(cluster.snapshot());
  });

  app.post("/api/deployments/:name/scale", (req, res) => {
    const body = ScaleRequest.safeParse(req.body);
    if (!body.success) {
      res.status(422).json({ detail: body.error.issues });
      return;
    }
    cluster.scale(req.params.name, body.data.replicas);
    res.status(204).end();
  });

  app.post("/api/deployments/:name/restart", (req, res) => {
    cluster.restart(req.params.name);
    res.status(204).end();
  });

  app.delete("/api/pods/:name", (req, res) => {
    cluster.deletePod(req.params.name);
    res.status(204).end();
  });

  // The history endpoints read from MongoDB: newest first, ?limit= 1-200 (default 50)
  const historyRoute =
    (read: (history: HistoryReader, limit: number) => Promise<unknown>) => async (req: Request, res: Response) => {
      if (!history) {
        res.status(503).json({ detail: "No database configured (MONGO_URI is not set)" });
        return;
      }
      const query = HistoryQuery.safeParse(req.query);
      if (!query.success) {
        res.status(422).json({ detail: query.error.issues });
        return;
      }
      res.json(await read(history, query.data.limit));
    };

  app.get("/api/events", historyRoute((history, limit) => history.latestEvents(limit)));
  app.get("/api/recoveries", historyRoute((history, limit) => history.latestRecoveries(limit)));

  // Every route lives under /api, the docs included, because the Ingress
  // will send only /api to the server and everything else to the client.
  app.get("/api/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

  // Unknown routes answer in JSON like the rest of the API, not with Express's default HTML page
  app.use((_req, res) => {
    res.status(404).json({ detail: "Not Found" });
  });

  // Errors thrown in the routes above end up here
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof NotFoundError) {
      res.status(404).json({ detail: error.message });
    } else if (error instanceof SyntaxError) {
      // express.json() could not parse the request body
      res.status(400).json({ detail: "Request body is not valid JSON" });
    } else if (error instanceof MongoError) {
      res.status(503).json({ detail: "The database cannot be reached right now" });
    } else {
      next(error);
    }
  });

  return app;
}
