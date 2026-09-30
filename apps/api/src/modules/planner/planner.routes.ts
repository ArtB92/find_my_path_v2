import { PlanRequestSchema } from "@find-my-path/shared";
import { Hono } from "hono";
import { parseBody } from "../../lib/http-errors";
import type { PlannerService } from "./planner.service";

export function plannerRoutes(planner: PlannerService) {
  return new Hono().post("/routes", async (c) => {
    const { intent, pins } = await parseBody(c, PlanRequestSchema);
    return c.json(await planner.plan(intent, pins, c.req.raw.signal));
  });
}
