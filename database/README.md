# database

MongoDB for PodRadar.

PodRadar runs the official `mongo:8.0` image instead of building its own. This folder holds only the init scripts: docker-compose mounts `init/` into `/docker-entrypoint-initdb.d`, and in Kubernetes they will come from a ConfigMap.

## What the init script creates

`init/01-init.js` runs once, the first time MongoDB starts with an empty data volume:

| What | Why |
|---|---|
| User `podradar` (from `MONGO_APP_USERNAME`), role `readWrite` on the `podradar` database only | The server never connects as root: it can read and write its own data, and nothing else |
| Collection `events` with a TTL index on `timestamp` | What happened in the cluster. MongoDB deletes events older than a week by itself |
| Collection `recoveries` with a TTL index on `recovered_at` | How long the cluster took to replace a deleted pod, kept for a week as well |

Because the script runs only on an empty volume, a change to it takes effect after `docker compose down -v`, which deletes the data.

## Passwords

The root and app passwords come from `.env` in the repository root (copy `.env.example`), which git ignores. In Kubernetes they will come from a Secret.

## Look inside

```bash
docker compose exec mongo sh -c 'mongosh "mongodb://$MONGO_APP_USERNAME:$MONGO_APP_PASSWORD@localhost:27017/podradar"'
```
