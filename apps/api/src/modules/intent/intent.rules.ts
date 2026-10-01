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
  ["start", ["from", "starting from", "je pars de", "pars de", "partir de", "partant d'", "starting at", "start at", "start from", "leaving from", "depuis", "au départ de", "au depart de", "départ de", "depart de", "départ", "partant de", "en partant de", "around", "near", "autour de", "près de", "pres de"]],
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

const KM = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:km|kms|k|bornes?|kilom[eè]tres?|kilometers?)(?![${W}])`, "iu");
const MILES = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:miles?|mi)(?![${W}])`, "iu");
const KM_PER_MILE = 1.609;

/** "2h", "1h30", "2 hours", "une heure et demie": riding time, turned into a distance at the bike's usual pace. */
const WORD_HOURS: Record<string, number> = { an: 1, a: 1, one: 1, une: 1, un: 1, two: 2, deux: 2, three: 3, trois: 3, four: 4, quatre: 4, five: 5, cinq: 5 };
const HALF = `(?<half>\\s*(?:and a half|et demie?))`;
const DURATION = [
  new RegExp(`(?<amount>\\d+(?:[.,]\\d+)?)\\s*(?:h|hrs?|hours?|heures?)(?:\\s*(?<minutes>\\d{2})(?:\\s*(?:min|mn))?)?${HALF}?(?![${W}])`, "iu"),
  word(`(?:d')?(?<amount>${Object.keys(WORD_HOURS).join("|")})\\s+(?:hours?|heures?)${HALF}?`),
  word(`(?:an?|une)\\s+(?<amount>half)[- ]hour|(?:d')?une\\s+demi-heure`),
];
const PACE_KMH: Record<NonNullable<LlmIntent["bike"]>, number> = { road: 25, gravel: 18, trekking: 18 };

/** "Hilly" or "flat" without a number: climbing per km typical of Île-de-France's hilly and flat rides. */
const HILLY = word(
  "hilly|very hilly|lots of climbing|plenty of climbing|lots of climbs|with climbs|hills|vallonn[ée]e?s?|tr[eè]s vallonn[ée]e?|costaud(?:e|s)?|(?:pas mal|beaucoup|plein) de (?:d[ée]nivel[ée]e?|d\\+|bosses|c[ôo]tes|mont[ée]es)|du d[ée]nivel[ée]e?|avec des (?:bosses|c[ôo]tes|mont[ée]es)|bosselée?",
);
const FLAT = word(
  "flat|as flat as possible|mostly flat|no hills|no climbing|easy|not too hard|plate?s?|le plus plat possible|sans d[ée]nivel[ée]e?|sans (?:bosses|c[ôo]tes)|facile|pas trop dure?|pas trop difficile",
);
const CLIMB_PER_KM = { hilly: 7, flat: 3 };
/** Distance the planner aims for when a loop has none; hilliness still needs one to become metres. */
const TYPICAL_LOOP_KM = 40;
const METRES = `(?:m|mètres?|metres?|meters?)`;
const CLIMB = `(?:d\\+|dplus|d[ée]nivel[ée]e?(?: positif)?|d[ée]niv|elevation(?: gain)?|climbing|climb|ascent|vertical|of (?:elevation(?: gain)?|climbing|climb|ascent|vertical)|de (?:d[ée]nivel[ée]e?(?: positif)?|mont[ée]e)|de d\\+)`;
const NUMBER = `(\\d{1,3}(?:[ \\u202f.]\\d{3})+|\\d+)`;
const ELEVATION = [
  new RegExp(`${NUMBER}\\s*${METRES}?\\s*${CLIMB}(?![${W}])`, "iu"),
  new RegExp(`${CLIMB}\\s*(?:de|of|:)?\\s*(?:around|about|environ|~|≈)?\\s*${NUMBER}\\s*${METRES}?(?![${W}])`, "iu"),
  new RegExp(`${NUMBER}\\s*${METRES}(?![${W}])`, "iu"),
];

const AVOID = word(
  "avoiding|avoid|en évitant|en evitant|évitant|evitant|éviter|eviter|sans passer par|without going through|not through|not via|stay(?:ing)? (?:away from|out of)|away from|hors de",
);
/** "multiple loops over Meudon climbs", "laps of the Chevreuse hills": the place to ride the climbs again in. */
const LAPS = word(
  "(?:(?:with|avec|doing|faire|en faisant) )?(?:(?:multiple|several|many|a few|some|\\d+|two|three|four|five|plusieurs|quelques|deux|trois|quatre|cinq) )?" +
    "(?:loops?|laps?|repeats?|reps|boucles?|tours?|répétitions?|repetitions?) (?:over|of|on|around|in|at|sur|de|des|du|dans|autour de|à|a)(?: the| les| la| le| l')?",
);
const CLIMB_WORDS = "climbs?|hills?|côtes?|cotes?|bosses?|montées?|montees?|ascents?";
const AROUND_PLACE = new RegExp(`^\\s*(?:(?:${CLIMB_WORDS})\\s+(?:of|in|at|around|de|du|des|d'|à|a)\\s+(?:the\\s+)?)?|\\s+(?:${CLIMB_WORDS})\\s*$`, "giu");
/** The planner rides climbs again whenever that's what the climbing asked needs, so saying it needs nothing more. */
const REPEAT_CLIMBS = word(
  `(?:by )?(?:repeating|repeat|redoing|riding again|doing again)(?: the| some| a few)? (?:${CLIMB_WORDS})|en (?:répétant|repetant|refaisant) (?:les|des) (?:${CLIMB_WORDS})`,
);
/** Busy roads are always avoided, so "avoid main roads" needs nothing more. */
const BUSY_ROADS = word("main roads?|busy roads?|big roads?|highways?|motorways?|traffic|trafic|grands? axes?|grandes? routes?|routes? nationales?|nationales?|autoroutes?|voies? rapides?");
const COMPASS = "north|south|east|west|nord|sud|est|ouest";
const DIRECTION = word(
  `(?:towards?|heading|head|going|go|direction|to|vers|au|à l'|a l'|en direction d(?:u|e l'|e)|cap au|cap sur)(?: the| le| la| l')?\\s*` +
    `((?:${COMPASS})(?:[\\s-]?(?:${COMPASS}))?|ne|nw|se|sw)(?: side| côté)?`,
);

/** "south west", "sud-ouest", "SW" -> "SW". */
function toCompass(words: string): LlmIntent["direction"] {
  const letters = words
    .toLowerCase()
    .replace(/ouest|west/g, "w")
    .replace(/east|est/g, "e")
    .replace(/north|nord/g, "n")
    .replace(/south|sud/g, "s")
    .replace(/[^nsew]/g, "");
  const ns = letters.includes("n") ? "N" : letters.includes("s") ? "S" : "";
  const ew = letters.includes("w") ? "W" : letters.includes("e") ? "E" : "";
  return ((ns + ew) || null) as LlmIntent["direction"];
}

const FILLER = new Set(
  (
    "a an the some my me i we you it is of in at do go get make give find show plan ride riding cycle cycling bike bicycle route routes itinerary way nice good great " +
    "around about approximately approx roughly near nearly almost max maximum min minimum total only just like want need would could can please thanks " +
    "un une le la les l d de du des mon ma mes je on moi faire trouve trouver donne donner propose proposer balade sortie parcours itinéraire itineraire trajet " +
    "vélo velo environ à peu près presque max minimum maximum total seulement bien belle beau jolie joli merci " +
    "build create generate draw long start starting and then going et puis crée créer construis construire génère générer fais dessine longue " +
    // When and how it feels: quiet roads are always preferred, so these need nothing more.
    "something quelque chose maybe perhaps peut-être plutôt rather quite assez pretty quiet calm calme tranquille chill cool relaxed " +
    "morning afternoon evening today tomorrow weekend sunday saturday matin après-midi soir aujourd'hui demain week-end dimanche samedi " +
    "rouler pars en for pour"
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

function takeDuration(text: string): [number | null, string] {
  for (const re of DURATION) {
    const m = re.exec(text);
    if (!m) continue;
    const { amount, minutes, half } = m.groups ?? {};
    const hours = !amount || amount === "half"
      ? 0.5
      : (WORD_HOURS[amount.toLowerCase()] ?? Number(amount.replace(",", "."))) + (minutes ? Number(minutes) / 60 : 0) + (half ? 0.5 : 0);
    return [hours, text.replace(m[0], " ; ")];
  }
  return [null, text];
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

  let [distanceKm, afterDistance] = takeFirst(text, [KM]);
  if (distanceKm === null) {
    const [miles, afterMiles] = takeFirst(afterDistance, [MILES]);
    if (miles !== null) [distanceKm, afterDistance] = [Math.round(miles * KM_PER_MILE), afterMiles];
  }
  const [hours, afterDuration] = takeDuration(afterDistance);
  let elevationGainM: number | null;
  [elevationGainM, text] = takeFirst(afterDuration, ELEVATION);
  const hilliness = HILLY.test(text) ? "hilly" : FLAT.test(text) ? "flat" : null;
  for (const re of [HILLY, FLAT]) text = strip(text, re, " ; ");

  const outAndBack = OUT_AND_BACK.test(text);
  text = strip(text, OUT_AND_BACK, " ; ");
  const bike = BIKES.find(([, re]) => re.test(text))?.[0] ?? null;
  for (const [, re] of BIKES) text = strip(text, re);

  // "avoiding Chatou and Croissy": the places run until the next marker, clause or full stop.
  const placesAfter = (re: RegExp): string[] | null => {
    const m = re.exec(text);
    if (!m) return null;
    const after = text.slice(m.index + m[0].length);
    const stop = [/[;.,]/u.exec(after), new RegExp(markerRe.source, "iu").exec(after), CLAUSE_BREAK.exec(after)]
      .filter((x): x is RegExpExecArray => x !== null)
      .reduce((min, x) => Math.min(min, x.index), after.length);
    text = `${text.slice(0, m.index)} ; ${after.slice(stop)}`;
    return after.slice(0, stop).split(LIST_SPLIT);
  };
  // The climbs to ride again are around a place the route must reach.
  const climbAreas: LlmIntent["via"] = [];
  text = strip(text, REPEAT_CLIMBS, " ; ");
  for (let parts = placesAfter(LAPS); parts; parts = placesAfter(LAPS)) {
    for (const part of parts) {
      const place = toPlace(part.replace(AROUND_PLACE, " "), pins);
      if (place) climbAreas.push({ place, kind: AREA_WORDS.test(place) ? "area" : "point" });
    }
  }

  const loopWord = LOOP.test(text);
  for (const re of [LOOP, BIKE_WORDS, PREAMBLE]) text = strip(text, re);

  const directionMatch = DIRECTION.exec(text);
  const direction = directionMatch ? toCompass(directionMatch[1]!) : null;
  if (directionMatch) text = text.replace(directionMatch[0], " ; ");

  const avoid: string[] = [];
  for (let parts = placesAfter(AVOID); parts; parts = placesAfter(AVOID)) {
    for (const part of parts) {
      const place = toPlace(part, pins);
      if (BUSY_ROADS.test(place)) continue;
      if (place) avoid.push(place);
    }
  }

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
  const saysRoute =
    loopWord || outAndBack || bike !== null || distanceKm !== null || elevationGainM !== null || segments.length > 0 || direction !== null || avoid.length > 0 || climbAreas.length > 0;
  if (startChunk >= 0 && saysRoute) {
    const chunk = chunks[startChunk]!;
    const cut = CLAUSE_BREAK.exec(chunk);
    start = toPlace(cut ? chunk.slice(0, cut.index) : chunk, pins) || null;
    if (cut) leftovers.push(chunk.slice(cut.index + cut[0].length));
  }
  leftovers.push(...chunks.filter((_, i) => i !== startChunk));

  if (!start) return null;
  via.push(...climbAreas);
  const places = [start, end, ...via.map((v) => v.place), ...avoid].filter((p): p is string => p !== null);
  if (places.some((p) => p.split(/\s+/).length > 8)) return null;

  const loop = loopWord || !end;
  if (distanceKm === null && hours !== null) distanceKm = Math.round(hours * PACE_KMH[bike ?? "road"]);
  if (hilliness && elevationGainM === null) {
    // Between two places the distance isn't known yet: that part is left to the language model.
    if (loop) elevationGainM = Math.round((CLIMB_PER_KM[hilliness] * (distanceKm ?? TYPICAL_LOOP_KM)) / 10) * 10;
    else leftovers.push(hilliness);
  }
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
      avoid,
      direction,
      notes: [],
    },
    complete: leftovers.every((s) => meaningful(s).length === 0),
  };
}
