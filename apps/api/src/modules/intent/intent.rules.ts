import type { Pin } from "@find-my-path/shared";
import type { LlmIntent } from "./intent.schema";

/**
 * Instant, deterministic reading of the common request shapes, in English and French:
 * "80 km loop from X with 500 m climbing", "from A to B via C and D", "boucle de 60 km depuis X par la forêt de Y".
 * `complete` is false when some words were not understood, so a language model can take a second look.
 */
export interface RulesResult {
  intent: LlmIntent;
  complete: boolean;
}

type Role = "start" | "end" | "via";

// Word characters, accents included (`\b` doesn't know that "à" is a letter), plus the hyphen and
// apostrophe that hold names together: "en" is not a word in "Saint-Germain-en-Laye".
const W = "\\p{L}\\p{N}'\\-";
const word = (alternatives: string, flags = "iu") => new RegExp(`(?<![${W}])(?:${alternatives})(?![${W}])`, flags);
const strip = (text: string, re: RegExp, by = " ") => text.replace(new RegExp(re.source, "giu"), by);

const MARKERS: [Role, string[]][] = [
  ["start", ["from", "starting from", "starting at", "start at", "start from", "leaving from", "depuis", "au départ de", "au depart de", "départ de", "depart de", "départ", "partant de", "en partant de", "around", "near", "autour de", "près de", "pres de"]],
  ["end", ["to", "ending at", "finishing at", "finish at", "arriving at", "jusqu'à", "jusqu'a", "arrivée à", "arrivee a", "à", "vers"]],
  ["via", ["via", "through", "thru", "passing through", "passing by", "going through", "going via", "by way of", "across", "par", "en passant par", "passant par", "à travers", "a travers", "dans"]],
];
const markerRe = word(
  MARKERS.flatMap(([, phrases]) => phrases)
    .sort((a, b) => b.length - a.length)
    .join("|"),
  "giu",
);
const roleOf = (phrase: string) => MARKERS.find(([, phrases]) => phrases.includes(phrase.toLowerCase()))![0];

/** Where a place name stops and the rest of the sentence begins. */
const CLAUSE_BREAK = word(
  "with|avec|avoiding|avoid|without|sans|en évitant|en evitant|éviter|eviter|please|stp|s'il te plaît|s'il vous plaît|if possible|si possible|for|pour|using",
);
const LIST_SPLIT = new RegExp(`\\s*,\\s*|\\s+(?:and|et|then|puis|&)\\s+`, "iu");
const AREA_WORDS = word(
  "forêt|foret|forest|bois|woods?|vallée|vallee|valley|parc|park|région|region|massif|plateau|coteaux|area|zone|countryside|campagne|pays|plaine",
);

const LOOP = word("loop|boucle|round trip|roundtrip|circuit|circular ride");
const OUT_AND_BACK = word("out and back|out-and-back|there and back|and back|aller-retour|aller retour|et retour");
const BIKES: [LlmIntent["bike"], RegExp][] = [
  ["gravel", word("gravel|gravier")],
  ["trekking", word("vtc|hybrid|hybride|trekking|city bike|vélo de ville|velo de ville")],
  ["road", word("road bike|vélo de route|velo de route|on the road|sur route")],
];
const PREAMBLE = word("(?:i'd|i would|i|we'd|we) (?:like|want|love|need)(?: to)?|want to|going to|have to|je (?:veux|voudrais|cherche|souhaite)|on (?:veut|voudrait)");
const BIKE_WORDS = word("à vélo|a velo|en vélo|en velo|by bike|à bicyclette");

const KM = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:km|kms|kilom[eè]tres?|kilometers?)(?![${W}])`, "iu");
const METRES = `(?:m|mètres?|metres?|meters?)`;
const CLIMB = `(?:d\\+|dplus|d[ée]nivel[ée]e?(?: positif)?|d[ée]niv|elevation(?: gain)?|climbing|climb|ascent|vertical|of (?:elevation(?: gain)?|climbing|climb|ascent|vertical)|de (?:d[ée]nivel[ée]e?(?: positif)?|mont[ée]e)|de d\\+)`;
const NUMBER = `(\\d{1,3}(?:[ \\u202f.]\\d{3})+|\\d+)`;
const ELEVATION = [
  new RegExp(`${NUMBER}\\s*${METRES}?\\s*${CLIMB}(?![${W}])`, "iu"),
  new RegExp(`${CLIMB}\\s*(?:de|of|:)?\\s*(?:around|about|environ|~|≈)?\\s*${NUMBER}\\s*${METRES}?(?![${W}])`, "iu"),
  new RegExp(`${NUMBER}\\s*${METRES}(?![${W}])`, "iu"),
];

const FILLER = new Set(
  (
    "a an the some my me i we you it is of in at do go get make give find show plan ride riding cycle cycling bike bicycle route routes itinerary way nice good great " +
    "around about approximately approx roughly near nearly almost max maximum min minimum total only just like want need would could can please thanks " +
    "un une le la les l d de du des mon ma mes je on moi faire trouve trouver donne donner propose proposer balade sortie parcours itinéraire itineraire trajet " +
    "vélo velo environ à peu près presque max minimum maximum total seulement bien belle beau jolie joli merci"
  ).split(" "),
);

const tokens = (s: string) => s.toLowerCase().match(new RegExp(`[${W}']+`, "gu")) ?? [];
const meaningful = (s: string) => tokens(s).filter((t) => !FILLER.has(t) && !/^\d+$/.test(t));

function cleanPlace(s: string): string {
  let out = s.replace(/[\s,.;:!?]+$/u, "").replace(/^[\s,.;:!?]+/u, "").trim();
  out = out.replace(/^(?:the|a|an)\s+/iu, "");
  // Drop filler at both ends ("a nice loop from X please"), keep it inside names ("Saint-Rémy-lès-Chevreuse").
  const words = out.split(/\s+/);
  while (words.length && FILLER.has(words[0]!.toLowerCase()) && !/^(?:la|le|les|l')$/i.test(words[0]!)) words.shift();
  while (words.length && FILLER.has(words.at(-1)!.toLowerCase())) words.pop();
  return words.join(" ");
}

/** A place as the model would write it: a clean name, or "pin:A" for a pin on the map. */
function toPlace(s: string, pins: Pin[]): string {
  const raw = s.replace(/[\s,.;:!?]+/gu, " ").trim();
  const letter = /^(?:pin|point|marker|repère|repere)?\s*([a-z])$/iu.exec(raw)?.[1]?.toUpperCase();
  if (letter && pins.some((p) => p.label === letter)) return `pin:${letter}`;
  if (pins.length === 1 && /^(?:here|ici|my pin|mon repère|the pin|le repère)$/iu.test(raw)) return `pin:${pins[0]!.label}`;
  return cleanPlace(s);
}

function takeFirst(text: string, patterns: RegExp[]): [number | null, string] {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return [Number(m[1]!.replace(/[\s\u202f.]/g, "").replace(",", ".")), text.replace(m[0], " ; ")];
  }
  return [null, text];
}

export function parseWithRules(query: string, pins: Pin[]): RulesResult | null {
  // "Paris - Versailles", "Paris → Versailles".
  let text = ` ${query.replace(/[’`]/g, "'").replace(/\s+/g, " ")} `.replace(/\s(?:-+|–|—|->|=>|→|>)\s/gu, " to ");
  const leftovers: string[] = [];

  const [distanceKm, afterDistance] = takeFirst(text, [KM]);
  const [elevationGainM, afterClimb] = takeFirst(afterDistance, ELEVATION);
  text = afterClimb;

  const outAndBack = OUT_AND_BACK.test(text);
  text = strip(text, OUT_AND_BACK, " ; ");
  const bike = BIKES.find(([, re]) => re.test(text))?.[0] ?? null;
  for (const [, re] of BIKES) text = strip(text, re);
  const loopWord = LOOP.test(text);
  for (const re of [LOOP, BIKE_WORDS, PREAMBLE]) text = strip(text, re);

  // French "de Paris à Versailles": a leading "de" is a start marker.
  text = text.replace(new RegExp(`^\\s*(?:(?:un |une |l')?(?:itinéraire|itineraire|trajet|parcours|route|aller)\\s+)?de\\s+`, "iu"), " depuis ");

  const hits = [...text.matchAll(markerRe)];
  const segments: { role: Role; value: string }[] = hits.map((m, i) => ({
    role: roleOf(m[0]),
    value: text.slice(m.index + m[0].length, hits[i + 1]?.index ?? text.length),
  }));
  const prefix = text.slice(0, hits[0]?.index ?? text.length);

  let start: string | null = null;
  let end: string | null = null;
  const via: LlmIntent["via"] = [];

  for (const { role, value } of segments) {
    const [head, ...rest] = value.split(";");
    const cut = CLAUSE_BREAK.exec(head!);
    const placeText = cut ? head!.slice(0, cut.index) : head!;
    leftovers.push(cut ? head!.slice(cut.index + cut[0].length) : "", ...rest);
    if (role === "via") {
      for (const part of placeText.split(LIST_SPLIT)) {
        const place = toPlace(part, pins);
        if (place) via.push({ place, kind: AREA_WORDS.test(place) ? "area" : "point" });
      }
      continue;
    }
    const [first, ...others] = placeText.split(LIST_SPLIT);
    leftovers.push(...others);
    const place = toPlace(first!, pins);
    if (!place) continue;
    if (role === "start" && !start) start = place;
    else if (role === "end" && !end) end = place;
    else return null;
  }

  // "Paris to Versailles", "Tour Eiffel 80 km": the place before any marker is the start.
  const chunks = prefix.split(";");
  const startChunk = start ? -1 : chunks.findIndex((s) => meaningful(s).length > 0);
  const saysRoute = loopWord || outAndBack || bike !== null || distanceKm !== null || elevationGainM !== null || segments.length > 0;
  if (startChunk >= 0 && saysRoute) {
    const chunk = chunks[startChunk]!;
    const cut = CLAUSE_BREAK.exec(chunk);
    start = toPlace(cut ? chunk.slice(0, cut.index) : chunk, pins) || null;
    if (cut) leftovers.push(chunk.slice(cut.index + cut[0].length));
  }
  leftovers.push(...chunks.filter((_, i) => i !== startChunk));

  if (!start) return null;
  const places = [start, end, ...via.map((v) => v.place)].filter((p): p is string => p !== null);
  if (places.some((p) => p.split(/\s+/).length > 8)) return null;

  const loop = loopWord || !end;
  return {
    intent: {
      isRouteRequest: true,
      start,
      end: loop ? null : end,
      loop,
      via,
      distanceKm,
      elevationGainM,
      bike,
      outAndBack,
      notes: [],
    },
    complete: leftovers.every((s) => meaningful(s).length === 0),
  };
}
