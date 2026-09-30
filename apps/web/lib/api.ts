import type { ApiError, ParseResponse, Pin, Route, RouteIntent } from "@find-my-path/shared";

export class RequestError extends Error {}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new RequestError((json as ApiError | null)?.error?.message ?? "Something went wrong. Try again.");
  }
  return json as T;
}

export const parseQuery = (query: string, pins: Pin[], signal?: AbortSignal) =>
  post<ParseResponse>("intent", { query, pins }, signal);

export const planRoute = (intent: RouteIntent, pins: Pin[], signal?: AbortSignal) =>
  post<Route>("routes", { intent, pins }, signal);
