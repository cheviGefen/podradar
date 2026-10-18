# client

The PodRadar web app: React + Vite + TypeScript, built into static files and served by nginx.

It shows the cluster as a live map: every node is a box, every pod a circle in the color of its status, and pods that are still waiting for a node have a strip of their own. Next to the map, each deployment can be scaled or restarted, a click on a pod deletes it, and "Kill a random pod" deletes one at random.

Below the map is the history, which the server keeps in MongoDB: the event timeline (like `kubectl get events`, with a "Warnings only" filter), and the recovery times of the last 20 lost pods, as the last, average and slowest time and a bar chart with a tooltip per bar (also available as a table). Without a database, these two panels say so and the rest of the page works as usual.

The page asks the server for the cluster state once a second, and for the history every two seconds.

The client calls the server only through the relative path `/api`, never a fixed server address. That way the same image works everywhere: nginx routes `/api` to the server in docker-compose, and the Ingress does it in Kubernetes.

## Structure

```
src/
├── api.ts              Types of the server's responses, and one function per API call
├── usePolling.ts       Calls an API function again and again, keeping the last good answer
├── rollout.ts          Whether a deployment is healthy or in the middle of a rollout
├── format.ts           Times and durations as text
├── App.tsx             Page layout and actions
└── components/         Header, Summary, Deployments, ClusterMap, Timeline, Recoveries
```

## The image

Built in two stages: Node.js compiles the app, and the final image is nginx with the static files only (about 26 MB, no Node.js inside). It runs as a non-root user and listens on port 8080.

nginx sends `/api` to `API_UPSTREAM` (default `server:8000`). It looks that name up on every request rather than once at startup, so it starts before the server exists and keeps working when the server restarts with a new IP.

| Variable | Default | Meaning |
|---|---|---|
| `API_UPSTREAM` | `server:8000` | Where nginx sends `/api`. In Kubernetes use the full Service name, e.g. `server.podradar.svc.cluster.local:8000` |

## Run with Docker

The client needs the server next to it, so run both with Compose from the repository root:

```bash
docker compose up --build
```

Then open http://localhost:8080.

## Run without Docker

Needs Node.js 20.19+ or 22.12+, and the server running on port 8000 (Vite forwards `/api` to it):

```bash
npm install
npm run dev
```
