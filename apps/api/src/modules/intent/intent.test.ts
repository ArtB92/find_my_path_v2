import { describe, expect, it } from "vitest";
import { createFakeIntentAdapter } from "./intent.adapter";
import type { LlmIntent } from "./intent.schema";
import { createIntentService } from "./intent.service";

const base: LlmIntent = {
  isRouteRequest: true,
  start: "Versailles",
  end: null,
  loop: true,
  via: [],
  distanceKm: 80,
  elevationGainM: 500,
  bike: null,
  outAndBack: false,
  notes: [],
};

const serviceReturning = (over: Partial<LlmIntent>) =>
  createIntentService({ llm: createFakeIntentAdapter(() => ({ ...base, ...over })) });

describe("intent service", () => {
  it("maps a loop request to an intent with a default bike", async () => {
    const { intent } = await serviceReturning({}).parse("boucle de 80km depuis Versaille, 500m D+", []);
    expect(intent).toEqual({
      start: { type: "text", text: "Versailles" },
      end: null,
      via: [],
      distanceKm: 80,
      elevationGainM: 500,
      bike: "road",
      outAndBack: false,
    });
  });

  it("maps pins and keeps via order", async () => {
    const service = serviceReturning({
      start: "pin:A",
      end: "Paris",
      loop: false,
      via: [
        { place: "pin:B", kind: "point" },
        { place: "forêt de Meudon", kind: "area" },
      ],
    });
    const pins = [
      { label: "A", lat: 48.8, lon: 2.1 },
      { label: "B", lat: 48.7, lon: 2.2 },
    ];
    const { intent } = await service.parse("from A to Paris via B and the Meudon forest", pins);
    expect(intent.start).toEqual({ type: "pin", label: "A" });
    expect(intent.end).toEqual({ type: "text", text: "Paris" });
    expect(intent.via.map((v) => v.kind)).toEqual(["point", "area"]);
  });

  it("rejects a pin that isn't on the map", async () => {
    await expect(serviceReturning({ start: "pin:C" }).parse("loop from C", [])).rejects.toMatchObject({ code: "intent_unclear" });
  });

  it("asks for a start when there is none", async () => {
    await expect(serviceReturning({ start: null }).parse("80 km please", [])).rejects.toThrow(/Where should the ride start/);
  });

  it("explains that free text needs an API key", async () => {
    await expect(createIntentService({ llm: null }).parse("loop from Paris", [])).rejects.toMatchObject({
      code: "intent_unavailable",
    });
  });
});
