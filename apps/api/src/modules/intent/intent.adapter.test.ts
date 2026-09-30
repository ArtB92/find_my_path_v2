import { afterEach, describe, expect, it, vi } from "vitest";
import { createOllamaIntentAdapter } from "./intent.adapter";
import type { LlmIntent } from "./intent.schema";

const answer: LlmIntent = {
  isRouteRequest: true,
  start: "Versailles",
  end: null,
  loop: true,
  via: [],
  distanceKm: 80,
  elevationGainM: null,
  bike: null,
  outAndBack: false,
  avoid: [],
  direction: null,
  notes: [],
};

afterEach(() => vi.unstubAllGlobals());

describe("ollama intent adapter", () => {
  const adapter = createOllamaIntentAdapter({ baseUrl: "http://ollama:11434", model: "qwen2.5:3b", serviceAreaName: "Île-de-France" });

  it("asks for JSON matching the intent schema and parses the answer", async () => {
    const fetchMock = vi.fn(async () => Response.json({ message: { content: JSON.stringify(answer) } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await adapter.extract("boucle de 80 km depuis Versaille", [])).toEqual(answer);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(url).toBe("http://ollama:11434/api/chat");
    expect(body).toMatchObject({ model: "qwen2.5:3b", stream: false, format: { type: "object" } });
    expect(body.messages[1].content).toContain("boucle de 80 km depuis Versaille");
  });

  it("reports an answer that isn't a valid intent as unclear", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ message: { content: "not json" } }));
    await expect(adapter.extract("hello", [])).rejects.toMatchObject({ code: "intent_unclear" });
  });

  it("explains when the model isn't pulled yet", async () => {
    vi.stubGlobal("fetch", async () => new Response("model not found", { status: 404 }));
    await expect(adapter.extract("loop from Paris", [])).rejects.toMatchObject({ code: "upstream_unavailable" });
  });
});
