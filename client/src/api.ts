// The shapes the server returns. They mirror server/src/cluster/models.ts.

export type PodStatus = "Pending" | "ContainerCreating" | "Running" | "CrashLoopBackOff" | "Terminating";

export interface ClusterNode {
  name: string;
  ready: boolean;
}

export interface Pod {
  name: string;
  namespace: string;
  deployment: string;
  template_hash: string;
  node: string | null;
  status: PodStatus;
  restarts: number;
  created_at: string;
}

export interface Deployment {
  name: string;
  namespace: string;
  replicas: number;
  ready_replicas: number;
  updated_replicas: number;
}

export interface ClusterSnapshot {
  nodes: ClusterNode[];
  deployments: Deployment[];
  pods: Pod[];
}

// Something that happened in the cluster, shaped like a Kubernetes event
export interface ClusterEvent {
  timestamp: string;
  type: "Normal" | "Warning";
  reason: string;
  deployment: string;
  pod: string | null;
  message: string;
}

// A running pod that was lost (deleted or evicted), and how long until a replacement was running
export interface Recovery {
  deployment: string;
  pod: string;
  replacement: string;
  cause: "deleted" | "evicted";
  started_at: string;
  recovered_at: string;
  seconds: number;
}

export interface Health {
  status: string;
  version: string;
  cluster_mode: "mock" | "real";
}

export const MAX_REPLICAS = 10;

// A request that takes longer than this counts as failed, so the UI notices quickly when the server is gone
const TIMEOUT_MS = 5000;

// Relative paths only, never a server address: nginx, the Ingress or the Vite dev server sends /api to the server
async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.json().then(
      (data) => data.detail,
      () => undefined,
    );
    throw new Error(typeof detail === "string" ? detail : `Request failed with status ${response.status}`);
  }
  return response;
}

export async function getCluster(): Promise<ClusterSnapshot> {
  return (await request("GET", "/api/cluster")).json();
}

// Newest first. Both answer 503 when the server has no database or cannot reach it.
export async function getEvents(limit: number): Promise<ClusterEvent[]> {
  return (await request("GET", `/api/events?limit=${limit}`)).json();
}

export async function getRecoveries(limit: number): Promise<Recovery[]> {
  return (await request("GET", `/api/recoveries?limit=${limit}`)).json();
}

export async function getHealth(): Promise<Health> {
  return (await request("GET", "/api/healthz")).json();
}

export async function scaleDeployment(name: string, replicas: number): Promise<void> {
  await request("POST", `/api/deployments/${encodeURIComponent(name)}/scale`, { replicas });
}

export async function restartDeployment(name: string): Promise<void> {
  await request("POST", `/api/deployments/${encodeURIComponent(name)}/restart`);
}

export async function deletePod(name: string): Promise<void> {
  await request("DELETE", `/api/pods/${encodeURIComponent(name)}`);
}
