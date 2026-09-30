import { ParseRequestSchema } from "@find-my-path/shared";
import { Hono } from "hono";
import { parseBody } from "../../lib/http-errors";
import type { IntentService } from "./intent.service";

export function intentRoutes(intent: IntentService) {
  return new Hono().post("/intent", async (c) => {
    const { query, pins } = await parseBody(c, ParseRequestSchema);
    return c.json(await intent.parse(query, pins, c.req.raw.signal));
  });
}
