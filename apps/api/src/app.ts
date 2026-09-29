import { Hono } from "hono";
import type { Config } from "./config";
import { errorResponse } from "./lib/http-errors";
import { createBanGeocoder, createGeocodingService, createPhotonGeocoder } from "./modules/geocoding";
import {
  createClaudeIntentAdapter,
  createIntentService,
  createOllamaIntentAdapter,
  intentRoutes,
  type IntentLlmAdapter,
} from "./modules/intent";
import { createPlannerService, plannerRoutes } from "./modules/planner";
import { createBrouterAdapter, type RoutingAdapter } from "./modules/routing";

interface AppDeps {
  llm: IntentLlmAdapter | null;
  routing: RoutingAdapter;
  geocoding: ReturnType<typeof createGeocodingService>;
}

export function createApp({ llm, routing, geocoding }: AppDeps) {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/", intentRoutes(createIntentService({ llm })));
  app.route("/", plannerRoutes(createPlannerService({ geocoding, routing })));
  app.onError(errorResponse);
  return app;
}

export function createAppFromConfig(config: Config) {
  return createApp({
    llm: intentAdapter(config),
    routing: createBrouterAdapter(config.BROUTER_URL),
    geocoding: createGeocodingService({
      ban: createBanGeocoder(config.GEOCODER_BAN_URL),
      photon: createPhotonGeocoder(config.GEOCODER_PHOTON_URL),
      serviceArea: { bbox: config.SERVICE_AREA_BBOX, name: config.SERVICE_AREA_NAME },
    }),
  });
}

function intentAdapter(config: Config): IntentLlmAdapter | null {
  const serviceAreaName = config.SERVICE_AREA_NAME;
  if (config.INTENT_PROVIDER === "ollama") {
    return createOllamaIntentAdapter({ baseUrl: config.OLLAMA_URL, model: config.OLLAMA_MODEL, serviceAreaName });
  }
  return config.ANTHROPIC_API_KEY
    ? createClaudeIntentAdapter({ apiKey: config.ANTHROPIC_API_KEY, model: config.INTENT_MODEL, serviceAreaName })
    : null;
}
