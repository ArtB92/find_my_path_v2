import type { ApiError, ErrorCode } from "@find-my-path/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";
import { DomainError } from "./errors";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  place_not_found: 422,
  outside_service_area: 422,
  no_route: 422,
  target_unreachable: 422,
  intent_unclear: 422,
  upstream_unavailable: 503,
  internal: 500,
};

export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new DomainError("bad_request", first ? `${first.path.join(".") || "body"}: ${first.message}` : "Invalid request.");
  }
  return parsed.data;
}

/** Domain errors keep their message; anything else is logged and hidden from the client. */
export function errorResponse(err: unknown, c: Context) {
  if (err instanceof DomainError) {
    return c.json<ApiError>({ error: { code: err.code, message: err.message } }, STATUS[err.code]);
  }
  console.error(err);
  return c.json<ApiError>({ error: { code: "internal", message: "Something went wrong on our side." } }, 500);
}
