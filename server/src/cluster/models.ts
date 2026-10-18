import { z } from "zod";

// Each model is a zod schema. One definition gives three things: the TypeScript type (z.infer),
// validation of incoming requests, and the JSON Schema shown in /api/docs.

export const MAX_REPLICAS = 10;

// The pod states PodRadar shows, named as `kubectl get pods` shows them
export const PodStatus = z.enum(["Pending", "ContainerCreating", "Running", "CrashLoopBackOff", "Terminating"]);
export type PodStatus = z.infer<typeof PodStatus>;

export const ClusterNode = z.object({
  name: z.string(),
  ready: z.boolean(),
});
export type ClusterNode = z.infer<typeof ClusterNode>;

export const Pod = z.object({
  name: z.string(),
  namespace: z.string(),
  deployment: z.string(),
  // The pod template the pod was created from (the pod-template-hash label). It changes on every rollout.
  template_hash: z.string(),
  node: z.string().nullable(), // null while the pod is Pending and not yet scheduled to a node
  status: PodStatus,
  restarts: z.int(),
  created_at: z.iso.datetime(),
});
export type Pod = z.infer<typeof Pod>;

export const Deployment = z.object({
  name: z.string(),
  namespace: z.string(),
  replicas: z.int(), // desired
  ready_replicas: z.int(),
  updated_replicas: z.int(), // pods already on the current template; below `replicas` while a rollout runs
});
export type Deployment = z.infer<typeof Deployment>;

export const ClusterSnapshot = z.object({
  nodes: z.array(ClusterNode),
  deployments: z.array(Deployment),
  pods: z.array(Pod),
});
export type ClusterSnapshot = z.infer<typeof ClusterSnapshot>;

export const ScaleRequest = z.object({
  replicas: z.int().min(0).max(MAX_REPLICAS),
});

// Something that happened in the cluster, shaped like a Kubernetes event (`kubectl get events`):
// a Normal or Warning type, a short reason such as BackOff or Killing, and a message for people.
export const ClusterEvent = z.object({
  timestamp: z.iso.datetime(),
  type: z.enum(["Normal", "Warning"]),
  reason: z.string(),
  deployment: z.string(),
  pod: z.string().nullable(), // null for events about the whole deployment, e.g. scaling
  message: z.string(),
});
// In the server and in MongoDB the timestamp is a Date; JSON turns it into the ISO string above
export type ClusterEvent = Omit<z.infer<typeof ClusterEvent>, "timestamp"> & { timestamp: Date };

// A deployment lost a running pod (deleted or evicted) and got a replacement running again
export const Recovery = z.object({
  deployment: z.string(),
  pod: z.string(), // the pod that was lost
  replacement: z.string(),
  cause: z.enum(["deleted", "evicted"]),
  started_at: z.iso.datetime(),
  recovered_at: z.iso.datetime(),
  seconds: z.number(),
});
export type Recovery = Omit<z.infer<typeof Recovery>, "started_at" | "recovered_at"> & {
  started_at: Date;
  recovered_at: Date;
};

// ?limit= for the history endpoints
export const HistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
