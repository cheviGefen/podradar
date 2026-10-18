import { z } from "zod";

import { ClusterEvent, ClusterSnapshot, Recovery, ScaleRequest } from "./cluster/models.js";
import { settings } from "./config.js";

// The API description shown at /api/docs. Express does not generate one, so the paths are written
// here by hand; the schemas come from the zod models, so they never drift from the code.

const json = (schema: object) => ({ "application/json": { schema } });

const nameParameter = (what: string) => ({
  name: "name",
  in: "path",
  required: true,
  description: `${what} name`,
  schema: { type: "string" },
});

const limitParameter = {
  name: "limit",
  in: "query",
  description: "How many to return, newest first",
  schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
};

const historyErrors = {
  "422": { description: "`limit` is out of range" },
  "503": { description: "No database is configured, or it cannot be reached" },
};

const done = { "204": { description: "Done" } };
const notFound = (what: string) => ({ "404": { description: `No ${what} with this name` } });

export const openApiDocument = {
  openapi: "3.1.0",
  info: { title: "PodRadar API", version: settings.APP_VERSION },
  paths: {
    "/api/healthz": {
      get: {
        summary: "Answers as long as the process is alive. Kubernetes will use it as the liveness probe.",
        responses: {
          "200": {
            description: "The server is alive",
            content: json({
              type: "object",
              properties: {
                status: { type: "string" },
                version: { type: "string" },
                cluster_mode: { type: "string", enum: ["mock", "real"] },
              },
            }),
          },
        },
      },
    },
    "/api/readyz": {
      get: {
        summary:
          "Answers 200 when the server can do its work, and 503 while MongoDB cannot be reached. " +
          "Kubernetes will use it as the readiness probe.",
        responses: {
          "200": { description: "Ready" },
          "503": { description: "Not ready: MongoDB cannot be reached" },
        },
      },
    },
    "/api/cluster": {
      get: {
        summary: "The current state of the cluster: nodes, deployments and pods.",
        responses: { "200": { description: "The cluster", content: json(z.toJSONSchema(ClusterSnapshot)) } },
      },
    },
    "/api/deployments/{name}/scale": {
      post: {
        summary: "Sets the desired number of pods. The cluster then adds or removes pods to match it.",
        parameters: [nameParameter("Deployment")],
        requestBody: { required: true, content: json(z.toJSONSchema(ScaleRequest)) },
        responses: {
          ...done,
          ...notFound("deployment"),
          "422": { description: "`replicas` is missing or out of range" },
        },
      },
    },
    "/api/deployments/{name}/restart": {
      post: {
        summary: "Replaces every pod with a rolling update, without dropping below the desired count.",
        parameters: [nameParameter("Deployment")],
        responses: { ...done, ...notFound("deployment") },
      },
    },
    "/api/events": {
      get: {
        summary: "What happened in the cluster, like `kubectl get events`. Kept for a week.",
        parameters: [limitParameter],
        responses: {
          "200": { description: "Events, newest first", content: json(z.toJSONSchema(z.array(ClusterEvent))) },
          ...historyErrors,
        },
      },
    },
    "/api/recoveries": {
      get: {
        summary: "How long the cluster took to replace each running pod that was deleted or evicted.",
        parameters: [limitParameter],
        responses: {
          "200": { description: "Recoveries, newest first", content: json(z.toJSONSchema(z.array(Recovery))) },
          ...historyErrors,
        },
      },
    },
    "/api/pods/{name}": {
      delete: {
        summary: "Deletes a pod. Its deployment notices the missing pod and creates a replacement.",
        parameters: [nameParameter("Pod")],
        responses: { ...done, ...notFound("pod") },
      },
    },
  },
};
