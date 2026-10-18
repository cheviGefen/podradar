# PodRadar

A live dashboard for a Kubernetes cluster: watch every pod start, crash and recover, break things on purpose, and measure how fast the cluster heals itself.

PodRadar is a Kubernetes learning project. It is made of three separate services, each packaged as its own container:

| Service | Tech | Role |
|---|---|---|
| `client` | React + Vite + TypeScript, served by nginx | Live cluster map, event timeline and chaos panel |
| `server` | Node.js + TypeScript + Express | Reads the cluster state and runs actions on it (scale, delete pod, restart) |
| `database` | MongoDB | Keeps the event history and the measured recovery times |

## Run it

Needs only Docker. Once, copy the example settings and choose the database passwords:

```bash
cp .env.example .env
```

Then:

```bash
docker compose up --build
```

Then open http://localhost:8080. The API docs are at http://localhost:8080/api/docs.

Only the client's port 8080 is published to the host. The client's nginx forwards `/api` to the server, and the server talks to MongoDB, all inside the Compose network. Compose starts them in order (MongoDB, then the server once MongoDB is healthy, then the client once the server is healthy), restarts a container whose process exits, and keeps MongoDB's data in the `mongo-data` volume.

```bash
docker compose ps              # both services and the server's health
docker compose logs -f server  # the server's log
docker compose down            # stop and remove the containers; the data stays
docker compose down -v         # also delete the database volume
```

## Cluster modes

The server reads its cluster from one of two sources, chosen by the `CLUSTER_MODE` environment variable:

- `mock` (default): a simulated cluster where pods start, crash and recover on their own. No Kubernetes needed.
- `real`: a real cluster, reached through a kubeconfig file when the server runs outside the cluster, or through a ServiceAccount when it runs inside it.

## Project structure

```
podradar/
├── client/     React app
├── server/     Express app
├── database/   MongoDB init scripts
├── k8s/        Kubernetes manifests
└── docker-compose.yml
```

## Roadmap

- [x] Repository skeleton
- [x] Server: simulated cluster, actions and tests + Dockerfile
- [x] Client: live cluster map and actions + Dockerfile
- [x] docker-compose: run the services together
- [x] Database: MongoDB with an init script, a least-privilege user and a readiness check
- [x] Server: record events and recovery times in MongoDB
- [x] Client: event timeline and recovery times
- [ ] Live updates with Server-Sent Events instead of polling
- [ ] Real cluster mode: read a local cluster through kubeconfig
- [ ] Kubernetes manifests: Deployments, Services, StatefulSet, ConfigMap, Secret, RBAC, Ingress
