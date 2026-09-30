import { serve } from "@hono/node-server";
import { createAppFromConfig } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const app = await createAppFromConfig(config);

serve({ fetch: app.fetch, port: config.PORT }, ({ port }) => {
  const reader = config.INTENT_PROVIDER === "ollama" ? `Ollama ${config.OLLAMA_MODEL}` : `Claude ${config.INTENT_MODEL}`;
  console.log(`api listening on :${port}, reading requests with ${reader}`);
});
