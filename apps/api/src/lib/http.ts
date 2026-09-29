import { DomainError } from "./errors";

interface FetchOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  service: string;
  init?: RequestInit;
}

/** fetch with a timeout, the caller's abort signal, and network failures mapped to a domain error. */
export async function fetchWithTimeout(url: string, { timeoutMs, signal, service, init }: FetchOptions): Promise<Response> {
  const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.any(signals),
      headers: { "user-agent": "find-my-path/0.1", ...init?.headers },
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new DomainError("upstream_unavailable", `${service} is not reachable right now.`, { cause: err });
  }
}
