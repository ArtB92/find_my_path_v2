import type { NextRequest } from "next/server";

/** Forwards /api/* to the API service, so the browser only ever talks to this origin. */
async function forward(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const target = new URL(`${path.join("/")}${req.nextUrl.search}`, `${process.env.API_URL ?? "http://localhost:8787"}/`);
  try {
    const res = await fetch(target, {
      method: req.method,
      headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
      body: req.method === "GET" ? undefined : await req.text(),
      signal: req.signal,
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  } catch {
    return Response.json({ error: { code: "upstream_unavailable", message: "The route service is not reachable." } }, { status: 503 });
  }
}

export { forward as GET, forward as POST };
