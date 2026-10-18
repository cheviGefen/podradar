// Runs once, the first time MongoDB starts with an empty data directory: the official image runs
// every script in /docker-entrypoint-initdb.d. Changes here take effect only on a fresh volume
// (docker compose down -v). `db` is the MONGO_INITDB_DATABASE database, podradar.

const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;

// The server connects as this user, never as root: it may read and write the podradar database only
db.createUser({
  user: process.env.MONGO_APP_USERNAME,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: "readWrite", db: db.getName() }],
});

// What happened in the cluster: pods that crashed, were deleted or replaced, and actions people ran.
// A TTL index: MongoDB itself deletes events older than a week. It also serves "newest first" queries.
db.createCollection("events");
db.events.createIndex({ timestamp: 1 }, { expireAfterSeconds: WEEK_IN_SECONDS });

// How long the cluster took to replace a pod that was deleted
db.createCollection("recoveries");
db.recoveries.createIndex({ recovered_at: 1 }, { expireAfterSeconds: WEEK_IN_SECONDS });
