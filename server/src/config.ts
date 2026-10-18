import { z } from "zod";

// Server configuration, read from environment variables.
// An invalid value stops the server at startup instead of failing later.
const Settings = z.object({
  CLUSTER_MODE: z.enum(["mock", "real"]).default("mock"),
  APP_VERSION: z.string().default("dev"),
  MOCK_TICK_SECONDS: z.coerce.number().positive().default(2),
  // Optional: without it the server runs with no database
  MONGO_URI: z.url({ protocol: /^mongodb(\+srv)?$/ }).optional(),
});

const parsed = Settings.safeParse(process.env);
if (!parsed.success) {
  console.error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const settings = parsed.data;
