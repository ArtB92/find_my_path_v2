import { describe, expect, it } from "vitest";
import { parseWithRules } from "./intent.rules";

const pins = [
  { label: "A", lat: 48.8, lon: 2.1 },
  { label: "B", lat: 48.7, lon: 2.2 },
];

describe("rules parser", () => {
  it.each([
    ["80 km loop From Eiffel Tower with around 500m elevation", { start: "Eiffel Tower", loop: true, distanceKm: 80, elevationGainM: 500 }],
    ["boucle de 80km depuis Versaille avec 500m D+", { start: "Versaille", loop: true, distanceKm: 80, elevationGainM: 500 }],
    ["A loop from Versailles of about 80 km", { start: "Versailles", loop: true, distanceKm: 80, elevationGainM: null }],
    ["From Paris to Versailles", { start: "Paris", end: "Versailles", loop: false, distanceKm: null }],
    ["de Paris à Rambouillet", { start: "Paris", end: "Rambouillet", loop: false }],
    ["Asnières-sur-Seine to Saint-Germain-en-Laye", { start: "Asnières-sur-Seine", end: "Saint-Germain-en-Laye", loop: false }],
    ["from 12 rue de Bretagne Asnières to Versailles", { start: "12 rue de Bretagne Asnières", end: "Versailles" }],
    ["gravel loop of 60 km from A", { start: "pin:A", bike: "gravel", distanceKm: 60 }],
    ["dénivelé de 1 200 m, 100 km au départ de Fontainebleau", { start: "Fontainebleau", distanceKm: 100, elevationGainM: 1200 }],
    ["Paris - Versailles", { start: "Paris", end: "Versailles" }],
    ["boucle de 100 km autour de Fontainebleau", { start: "Fontainebleau", loop: true, distanceKm: 100 }],
    ["aller-retour de Paris à Versailles", { start: "Paris", end: "Versailles", outAndBack: true }],
  ])("reads %s", (query, expected) => {
    const result = parseWithRules(query, pins);
    expect(result?.complete).toBe(true);
    expect(result?.intent).toMatchObject(expected);
  });

  it.each([
    [
      "Build a  nice loop start and from Asnières, about 100km long,  going through Versailles",
      { start: "Asnières", loop: true, distanceKm: 100, via: [{ place: "Versailles", kind: "point" }] },
    ],
    [
      "build a route from Versailles to Paris, going through Poissy, avoiding Chatou",
      { start: "Versailles", end: "Paris", via: [{ place: "Poissy", kind: "point" }], avoid: ["Chatou"] },
    ],
    ["build a loop from Asnières, going towards south west", { start: "Asnières", loop: true, direction: "SW" }],
    ["boucle de 60 km depuis Versailles vers le sud-est en évitant Buc et Jouy-en-Josas", { start: "Versailles", direction: "SE", avoid: ["Buc", "Jouy-en-Josas"] }],
    ["loop from Paris heading north, avoiding Saint-Denis, 50 km", { start: "Paris", direction: "N", avoid: ["Saint-Denis"], distanceKm: 50 }],
  ])("reads the harder request %s", (query, expected) => {
    const result = parseWithRules(query, pins);
    expect(result?.complete).toBe(true);
    expect(result?.intent).toMatchObject(expected);
  });

  it("keeps stops in order and tells areas from points", () => {
    const result = parseWithRules("From Paris to Rambouillet via Saclay and the forêt de Meudon", pins);
    expect(result?.complete).toBe(true);
    expect(result?.intent.via).toEqual([
      { place: "Saclay", kind: "point" },
      { place: "forêt de Meudon", kind: "area" },
    ]);
  });

  it("reads a loop through an area, in French", () => {
    const result = parseWithRules("boucle de 70 km depuis Versailles en passant par la vallée de Chevreuse", pins);
    expect(result?.intent).toMatchObject({ start: "Versailles", loop: true, via: [{ place: "la vallée de Chevreuse", kind: "area" }] });
  });

  it("maps pins used as stops", () => {
    expect(parseWithRules("from A to Paris via B", pins)?.intent).toMatchObject({ start: "pin:A", via: [{ place: "pin:B" }] });
  });

  it("flags words it didn't understand", () => {
    const result = parseWithRules("60 km loop from Annecy, avoid main roads, one big climb", pins);
    expect(result?.intent.start).toBe("Annecy");
    expect(result?.complete).toBe(false);
  });

  it("gives up without a start, or without anything route-like", () => {
    expect(parseWithRules("80 km with 500 m of climbing", pins)).toBeNull();
    expect(parseWithRules("hello there", pins)).toBeNull();
  });
});
