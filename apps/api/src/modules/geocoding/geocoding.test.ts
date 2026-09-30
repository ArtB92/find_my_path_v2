import { describe, expect, it } from "vitest";
import { createFakeGeocoder } from "./geocoding.adapter";
import type { GeocodedPlace } from "./geocoding.schema";
import { createGeocodingService } from "./geocoding.service";

const idf = { bbox: [1.44, 48.12, 3.56, 49.24] as [number, number, number, number], name: "Île-de-France" };
const at = (name: string, lat: number, lon: number, over: Partial<GeocodedPlace> = {}): GeocodedPlace => ({
  name,
  lat,
  lon,
  kind: "town",
  score: 0.9,
  ...over,
});

describe("geocoding service", () => {
  it("takes a confident address-base hit for towns and addresses without waiting for OpenStreetMap", async () => {
    const service = createGeocodingService({
      ban: createFakeGeocoder({ versaille: at("Versailles", 48.8049, 2.1204) }),
      photon: { search: () => new Promise(() => {}) },
      serviceArea: idf,
    });
    expect((await service.resolve("Versaille")).name).toBe("Versailles");
  });

  it("prefers OpenStreetMap for named areas", async () => {
    const service = createGeocodingService({
      ban: createFakeGeocoder({ chevreuse: at("Chevreuse", 48.706, 2.04) }),
      photon: createFakeGeocoder({ chevreuse: at("Vallée de Chevreuse", 48.72, 2.0, { kind: "area" }) }),
      serviceArea: idf,
    });
    expect((await service.resolve("vallée de Chevreuse", { preferArea: true })).kind).toBe("area");
  });

  it("falls back to the other provider when one is down", async () => {
    const service = createGeocodingService({
      ban: { search: () => Promise.reject(new Error("down")) },
      photon: createFakeGeocoder({ meudon: at("Meudon", 48.81, 2.23) }),
      serviceArea: idf,
    });
    expect((await service.resolve("Meudon")).name).toBe("Meudon");
  });

  it("tells places outside the area apart from unknown ones", async () => {
    const service = createGeocodingService({
      ban: createFakeGeocoder({ lyon: at("Lyon", 45.76, 4.83) }),
      photon: createFakeGeocoder({}),
      serviceArea: idf,
    });
    await expect(service.resolve("Lyon")).rejects.toMatchObject({ code: "outside_service_area" });
    await expect(service.resolve("Nowhereville")).rejects.toMatchObject({ code: "place_not_found" });
  });

  it("reads a town elsewhere as that town, not a street named after it here", async () => {
    const service = createGeocodingService({
      ban: {
        search: async () => [at("Lyon", 45.76, 4.83, { score: 0.88 }), at("Rue de Lyon, Paris", 48.848, 2.372, { kind: "street", score: 0.72 })],
      },
      photon: createFakeGeocoder({}),
      serviceArea: idf,
    });
    await expect(service.resolve("Lyon")).rejects.toMatchObject({ code: "outside_service_area" });
  });
});
