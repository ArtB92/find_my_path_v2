/**
 * Requests every PR must still answer well, run against the real stack by `pnpm test:acceptance`.
 * Written as a cyclist would type them. Add a case whenever a real request goes wrong.
 */
import type { Bike, Compass, ErrorCode, LatLon, Pin } from "@find-my-path/shared";

export interface Place extends LatLon {
  name: string;
}

export interface AcceptanceCase {
  query: string;
  pins?: Pin[];
  /** What reading the request must give. Places match when the text read contains the name. */
  reads?: {
    start?: string;
    end?: string | null;
    via?: string[];
    avoid?: string[];
    distanceKm?: number | null;
    elevationGainM?: number | null;
    direction?: Compass | null;
    bike?: Bike;
    outAndBack?: boolean;
  };
  /** Places the route must pass within `nearKm` of (default 1.5 km; areas need more). */
  passes?: (Place & { nearKm?: number })[];
  /** Places the route must stay at least 1 km away from. */
  avoids?: Place[];
  /** Loops only: the compass side the farthest point must be on, within 60°. */
  heads?: Compass;
  /** The closest route found may miss the numbers asked (shown with a message) without failing. */
  mayMiss?: boolean;
  /** The request must be refused with this error instead of a route. */
  fails?: ErrorCode;
}

const at = (name: string, lat: number, lon: number): Place => ({ name, lat, lon });
const P = {
  paris: at("Paris", 48.8566, 2.3522),
  versailles: at("Versailles", 48.8049, 2.1204),
  rambouillet: at("Rambouillet", 48.6437, 1.8298),
  saclay: at("Saclay", 48.7302, 2.1692),
  chevreuse: at("Chevreuse", 48.7066, 2.0386),
  poissy: at("Poissy", 48.9291, 2.0413),
  chatou: at("Chatou", 48.8897, 2.1575),
  buc: at("Buc", 48.7717, 2.1244),
  jouy: at("Jouy-en-Josas", 48.7648, 2.1683),
  saintDenis: at("Saint-Denis", 48.9362, 2.3574),
  fontainebleau: at("Fontainebleau", 48.4047, 2.7016),
  saintGermain: at("Saint-Germain-en-Laye", 48.8989, 2.0938),
  vincennes: at("Château de Vincennes", 48.8428, 2.4357),
  bougival: at("Bougival", 48.8627, 2.1411),
  malmaison: at("Rueil-Malmaison", 48.8778, 2.1802),
};

export const CASES: AcceptanceCase[] = [
  // From A to B.
  { query: "From Paris to Versailles", reads: { start: "Paris", end: "Versailles", distanceKm: null }, passes: [P.versailles] },
  { query: "de Paris à Rambouillet", reads: { start: "Paris", end: "Rambouillet" }, passes: [P.rambouillet] },
  {
    query: "From Versailles to Rambouillet via Saclay and Chevreuse",
    reads: { start: "Versailles", end: "Rambouillet", via: ["Saclay", "Chevreuse"] },
    passes: [P.saclay, P.chevreuse, P.rambouillet],
  },
  {
    query: "build a route from Versailles to Paris, going through Poissy, avoiding Chatou",
    reads: { start: "Versailles", end: "Paris", via: ["Poissy"], avoid: ["Chatou"] },
    passes: [P.poissy],
    avoids: [P.chatou],
  },
  { query: "From Place de la Bastille to the Château de Vincennes", passes: [P.vincennes] },
  { query: "Saint-Germain-en-Laye to Fontainebleau, about 90 km", reads: { distanceKm: 90 }, passes: [P.fontainebleau] },

  // Loops of a given length.
  { query: "80 km loop from Versailles", reads: { start: "Versailles", distanceKm: 80 } },
  { query: "loop from Rambouillet", reads: { start: "Rambouillet", distanceKm: null } },
  { query: "boucle de 40 km autour de Fontainebleau en gravel", reads: { start: "Fontainebleau", distanceKm: 40, bike: "gravel" } },
  {
    query: "Build a nice loop start and from Asnières, about 100km long, going through Versailles",
    reads: { start: "Asnières", via: ["Versailles"], distanceKm: 100 },
    passes: [P.versailles],
  },
  { query: "40 miles loop from Versailles", reads: { distanceKm: 64 } },

  // Riding time instead of distance.
  { query: "sortie de 2h depuis Versailles", reads: { start: "Versailles", distanceKm: 50 } },
  { query: "je pars de Sèvres et je veux rouler 1h30", reads: { start: "Sèvres", distanceKm: 38 } },
  { query: "an hour and a half on the gravel bike from Rambouillet", reads: { distanceKm: 27, bike: "gravel" } },

  // Climbing.
  { query: "80 km loop from Versailles with 500 m of climbing", reads: { distanceKm: 80, elevationGainM: 500 } },
  { query: "100 km loop from Asnières with 900 m of climbing", reads: { distanceKm: 100, elevationGainM: 900 } },
  { query: "boucle de 50 km depuis Saint-Rémy-lès-Chevreuse avec 700 m de D+", reads: { distanceKm: 50, elevationGainM: 700 } },
  {
    query: "150 km loop from Asnières with around 1000m of elevation, going through Vallée de Chevreuse",
    reads: { distanceKm: 150, elevationGainM: 1000, via: ["Chevreuse"] },
    passes: [{ ...P.chevreuse, nearKm: 6 }],
  },
  { query: "hilly 60k loop from Chevreuse", reads: { distanceKm: 60, elevationGainM: 420 } },
  { query: "je veux faire une boucle de 70 bornes depuis Rambouillet avec pas mal de dénivelé", reads: { distanceKm: 70, elevationGainM: 490 } },
  { query: "I want a hilly ride of about 2h30 from Meudon", reads: { start: "Meudon", distanceKm: 63 } },
  { query: "flat 40 km ride from Saint-Germain-en-Laye", reads: { distanceKm: 40, elevationGainM: 120 } },
  // Asks for more than the area has: the closest route comes back with a message.
  { query: "60 km loop from Paris with 2000 m of climbing", reads: { elevationGainM: 2000 }, mayMiss: true },

  // Areas to ride through.
  {
    query: "60 km loop from Versailles through the vallée de Chevreuse",
    reads: { via: ["vallée de Chevreuse"] },
    passes: [{ ...P.chevreuse, nearKm: 6 }],
  },
  { query: "boucle de 50 km depuis Saint-Germain-en-Laye par Bougival et Rueil-Malmaison", passes: [P.bougival, P.malmaison] },

  // Direction and places to avoid.
  { query: "build a loop from Asnières, going towards south west", reads: { direction: "SW" }, heads: "SW" },
  {
    query: "boucle de 60 km depuis Versailles vers le sud-est en évitant Buc et Jouy-en-Josas",
    reads: { direction: "SE", avoid: ["Buc", "Jouy-en-Josas"] },
    heads: "SE",
    avoids: [P.buc, P.jouy],
  },
  {
    query: "loop from Paris heading north, avoiding Saint-Denis, 50 km",
    reads: { direction: "N", avoid: ["Saint-Denis"], distanceKm: 50 },
    heads: "N",
    avoids: [P.saintDenis],
  },

  // Out and back, and map pins.
  { query: "aller-retour de Paris à Versailles", reads: { outAndBack: true }, passes: [P.versailles] },
  {
    query: "50 km loop from pin A through pin B",
    pins: [
      { label: "A", lat: 48.8049, lon: 2.1204 },
      { label: "B", lat: 48.7302, lon: 2.1692 },
    ],
    reads: { start: "pin:A", via: ["pin:B"], distanceKm: 50 },
    passes: [P.saclay],
  },

  // Requests that must be refused clearly.
  { query: "80 km loop from Lyon", fails: "outside_service_area" },
  { query: "hello, how are you?", fails: "intent_unclear" },
];
