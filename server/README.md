# server

The PodRadar API: Node.js + TypeScript + Express.

It reads the cluster state (simulated or real, see `CLUSTER_MODE` in the main README) and runs actions on the cluster.

The simulated cluster has 2 nodes and three deployments (`web`, `api`, `worker`). Every tick, a pod may crash and come back, or die and get replaced, and a reconcile loop brings each deployment back to its desired number of pods, the way the Kubernetes controllers do. A restart replaces the pods with a rolling update (`maxSurge=1`, `maxUnavailable=0`).

## API

| Method and path | What it does |
|---|---|
| `GET /api/healthz` | Liveness check: is the process alive? Status, version and cluster mode |
| `GET /api/readyz` | Readiness check: `200` when MongoDB answers, `503` while it cannot be reached |
| `GET /api/cluster` | Nodes, deployments and pods, as they are right now |
| `POST /api/deployments/{name}/scale` | Body `{"replicas": 0-10}`. Sets the desired number of pods |
| `POST /api/deployments/{name}/restart` | Replaces every pod of the deployment with a rolling update |
| `DELETE /api/pods/{name}` | Deletes a pod; its deployment creates a replacement |
| `GET /api/events?limit=50` | What happened in the cluster, newest first (needs MongoDB) |
| `GET /api/recoveries?limit=50` | How long each lost pod took to be replaced, newest first (needs MongoDB) |
| `GET /api/docs` | Interactive API docs |

Unknown names answer `404`, an invalid replica count or limit `422`, and the history endpoints `503` when there is no database or it cannot be reached. Every error has a JSON body with a `detail` field.

## History

Everything that happens in the cluster becomes an event shaped like a Kubernetes event (`kubectl get events`): a `Normal` or `Warning` type, a reason and a message.

| Reason | When |
|---|---|
| `SuccessfulCreate`, `Scheduled`, `Started` | A new pod is created, placed on a node, and its container starts |
| `BackOff` (Warning) | A container crashed and waits before it restarts |
| `Evicted` (Warning) | A pod was evicted from its node |
| `Killing` | A pod is stopped: deleted by a user, scaled down, evicted, or replaced in a rollout |
| `ScalingReplicaSet` | A deployment was scaled |
| `RolloutStarted`, `RolloutComplete` | A restart began, and every pod runs the new version |

When a deployment loses a running pod it did not mean to lose (deleted or evicted, but not scaled down or replaced in a rollout), the server times how long it takes until a replacement is running, and stores that as a recovery.

Both go to MongoDB in the background, so the simulation never waits for the database. While MongoDB is down they are lost, and the log says so once.

All configuration comes from environment variables, so in Kubernetes it can be supplied by ConfigMaps and Secrets without rebuilding the image.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `CLUSTER_MODE` | `mock` | `mock` for a simulated cluster, `real` for a real one (not implemented yet) |
| `APP_VERSION` | `dev` | Version reported by the API |
| `MOCK_TICK_SECONDS` | `2` | Seconds between steps of the simulated cluster, where pods crash, recover and get replaced |
| `MONGO_URI` | none | MongoDB connection string. Without it the server runs with no database |

The server starts even while MongoDB is down, and the driver reconnects by itself when it comes back. That is why there are two health endpoints: `/api/healthz` says the process is alive (restarting it would not help with a missing database), and `/api/readyz` says whether it can do its work right now. In Kubernetes they become the liveness and the readiness probe.

## Run with Docker

From the `server` folder:

```bash
docker build -t podradar-server .
docker run --rm -p 8000:8000 -e APP_VERSION=v1 podradar-server
```

Then open http://localhost:8000/api/healthz, or the API docs at http://localhost:8000/api/docs.

The image is built in two stages: the first compiles the TypeScript, and the second keeps only the compiled JavaScript and the production dependencies.

## Run without Docker

Needs Node.js 24 or newer:

```bash
npm install
npm run dev
```

`npm run dev` restarts the server on every change in `src/`.

## Tests

The tests use Node's built-in test runner. They cover the simulation (scaling, replacing pods, a rolling update that never drops below the desired count, a 5,000-tick random run that must always settle back, and the events and recovery times it reports, timed with a fake clock) and the HTTP API, with stand-ins for MongoDB.

```bash
npm test
```

Without Node.js installed, run them in the build stage of the image, which has all the dev dependencies:

```bash
docker build --target build -t podradar-server-build .
docker run --rm podradar-server-build npm test
```
