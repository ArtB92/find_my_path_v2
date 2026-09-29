import { z } from "zod";

const BboxSchema = z
  .string()
  .transform((s) => s.split(",").map(Number))
  .pipe(z.tuple([z.number(), z.number(), z.number(), z.number()]));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(8787),
  BROUTER_URL: z.url().default("http://localhost:17777"),
  /** Who reads free-text requests: a free local model (Ollama) or Claude. */
  INTENT_PROVIDER: z.enum(["ollama", "anthropic"]).default("ollama"),
  OLLAMA_URL: z.url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("qwen2.5:3b"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  INTENT_MODEL: z.string().default("claude-opus-5-5"),
  GEOCODER_BAN_URL: z.url().default("https://data.geopf.fr/geocodage"),
  GEOCODER_PHOTON_URL: z.url().default("https://photon.komoot.io"),
  /** minLon,minLat,maxLon,maxLat of the area we can route in (Île-de-France for now). */
  SERVICE_AREA_BBOX: BboxSchema.default([1.44, 48.12, 3.56, 49.24]),
  SERVICE_AREA_NAME: z.string().default("Île-de-France"),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
  return EnvSchema.parse(cleaned);
}
