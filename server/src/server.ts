import { createApp } from "./app.js";
import { MockCluster } from "./cluster/mock.js";
import { settings } from "./config.js";
import { Database } from "./database.js";
import { History } from "./history.js";

const PORT = 8000;

if (settings.CLUSTER_MODE !== "mock") {
  console.error("CLUSTER_MODE=real is not implemented yet");
  process.exit(1);
}

const database = settings.MONGO_URI ? new Database(settings.MONGO_URI) : undefined;
const history = database ? new History(database.db) : undefined;
if (!database) {
  console.log("MONGO_URI is not set: running without a database, so no history is kept");
}

const cluster = new MockCluster({
  onEvent: (event) => history?.recordEvent(event),
  onRecovery: (recovery) => history?.recordRecovery(recovery),
});
const stopSimulation = cluster.start(settings.MOCK_TICK_SECONDS);

const server = createApp({ cluster, database, history }).listen(PORT, () => {
  console.log(`PodRadar server ${settings.APP_VERSION} listening on port ${PORT}`);
});

// Docker and Kubernetes stop a container with SIGTERM. Node ignores it when it runs as PID 1,
// so without this handler the container would hang until the grace period ends and then get killed.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    stopSimulation();
    server.close(async () => {
      await database?.close();
      process.exit(0);
    });
  });
}
