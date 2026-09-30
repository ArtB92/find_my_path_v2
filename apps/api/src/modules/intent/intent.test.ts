import { describe, expect, it } from "vitest";
import { DomainError } from "../../lib/errors";
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
  avoid: [],
  direction: null,
  notes: [],
};

const serviceReturning = (over: Partial<LlmIntent>) =>
  createIntentService({ llm: createFakeIntentAdapter(() => ({ ...base, ...over })) });

describe("intent service", () => {
  it("reads common requests without the language model", async () => {
    const service = createIntentService({ llm: createFakeIntentAdapter(() => expect.fail("the model was called")) });
    const { intent } = await service.parse("80 km loop from Eiffel Tower with around 500m elevation", []);
    expect(intent).toEqual({
      start: { type: "text", text: "Eiffel Tower" },
      end: null,
      via: [],
      distanceKm: 80,
      elevationGainM: 500,
      bike: "road",
      outAndBack: false,
      avoid: [],
      direction: null,
    });
  });

  it("asks the model when the rules didn't understand everything", async () => {
    const { intent, notes } = await serviceReturning({ notes: ["one big climb"] }).parse("hilly 80 km loop from Versaille, one big climb", []);
    expect(intent.start).toEqual({ type: "text", text: "Versailles" });
    expect(notes).toEqual(["one big climb"]);
  });

  it("falls back to the rules when the model doesn't answer in time", async () => {
    const service = createIntentService({
      llm: createFakeIntentAdapter(() => {
        throw new DomainError("upstream_unavailable", "The local language model took too long to answer.");
      }),
    });
    const { intent, notes } = await service.parse("80 km loop from Versailles, one big climb", []);
    expect(intent).toMatchObject({ start: { type: "text", text: "Versailles" }, distanceKm: 80 });
    expect(notes).toHaveLength(1);
  });

  it("asks for a clearer request when neither the rules nor the model could read it", async () => {
    const service = createIntentService({
      llm: createFakeIntentAdapter(() => {
        throw new DomainError("upstream_unavailable", "The local language model took too long to answer.");
      }),
    });
    await expect(service.parse("hello, how are you?", [])).rejects.toMatchObject({ code: "intent_unclear" });
  });

  it("turns an out-and-back to a destination into a loop through it", async () => {
    const { intent } = await createIntentService({ llm: null }).parse("aller-retour de Paris à Versailles", []);
    expect(intent).toMatchObject({ start: { type: "text", text: "Paris" }, end: null, outAndBack: true });
    expect(intent.via).toEqual([{ place: { type: "text", text: "Versailles" }, kind: "point" }]);
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
    const { intent } = await service.parse("start at my first pin, then B, then the woods near Meudon, ending in Paris", pins);
    expect(intent.start).toEqual({ type: "pin", label: "A" });
    expect(intent.end).toEqual({ type: "text", text: "Paris" });
    expect(intent.via.map((v) => v.kind)).toEqual(["point", "area"]);
  });

  it("rejects a pin that isn't on the map", async () => {
    await expect(serviceReturning({ start: "pin:C" }).parse("a nice ride from my pin, the C one", [])).rejects.toMatchObject({ code: "intent_unclear" });
  });

  it("asks for a start when there is none", async () => {
    await expect(serviceReturning({ start: null }).parse("80 km please", [])).rejects.toThrow(/Where should the ride start/);
    await expect(createIntentService({ llm: null }).parse("80 km please", [])).rejects.toThrow(/Where should the ride start/);
  });
});
