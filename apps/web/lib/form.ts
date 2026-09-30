import type { Bike, Compass, PlaceRef, RouteIntent, Via } from "@find-my-path/shared";

/** The editable version of a RouteIntent: every field as the rider types it. */
export interface RouteForm {
  start: string;
  loop: boolean;
  end: string;
  via: { text: string; kind: Via["kind"] }[];
  distanceKm: string;
  elevationGainM: string;
  bike: Bike;
  outAndBack: boolean;
  /** Places to stay out of, comma separated. */
  avoid: string;
  direction: Compass | "";
}

export const emptyForm: RouteForm = {
  start: "",
  loop: true,
  end: "",
  via: [],
  distanceKm: "",
  elevationGainM: "",
  bike: "road",
  outAndBack: false,
  avoid: "",
  direction: "",
};

const placeToText = (p: PlaceRef) => (p.type === "pin" ? `Pin ${p.label}` : p.text);

function textToPlace(text: string): PlaceRef {
  const pin = /^pin\s+([a-z])$/i.exec(text.trim());
  return pin ? { type: "pin", label: pin[1]!.toUpperCase() } : { type: "text", text: text.trim() };
}

const toNumber = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

export function intentToForm(intent: RouteIntent): RouteForm {
  return {
    start: placeToText(intent.start),
    loop: intent.end === null,
    end: intent.end ? placeToText(intent.end) : "",
    via: intent.via.map((v) => ({ text: placeToText(v.place), kind: v.kind })),
    distanceKm: intent.distanceKm?.toString() ?? "",
    elevationGainM: intent.elevationGainM?.toString() ?? "",
    bike: intent.bike,
    outAndBack: intent.outAndBack,
    avoid: intent.avoid.map(placeToText).join(", "),
    direction: intent.direction ?? "",
  };
}

/** Returns an error message instead of an intent when the form can't be planned yet. */
export function formToIntent(form: RouteForm): RouteIntent | string {
  if (!form.start.trim()) return "Add a start: a town, an address, or a pin like “Pin A”.";
  if (!form.loop && !form.end.trim()) return "Add a finish, or switch on Loop.";
  const distanceKm = toNumber(form.distanceKm);
  const elevationGainM = toNumber(form.elevationGainM);
  if (distanceKm !== null && !(distanceKm >= 2 && distanceKm <= 400)) return "Distance must be between 2 and 400 km.";
  if (elevationGainM !== null && !(elevationGainM >= 0 && elevationGainM <= 8000)) return "Climbing must be between 0 and 8000 m.";
  return {
    start: textToPlace(form.start),
    end: form.loop ? null : textToPlace(form.end),
    via: form.via.filter((v) => v.text.trim()).map((v) => ({ place: textToPlace(v.text), kind: v.kind })),
    distanceKm,
    elevationGainM,
    bike: form.bike,
    outAndBack: form.outAndBack,
    avoid: form.avoid
      .split(",")
      .filter((t) => t.trim())
      .map(textToPlace),
    direction: form.loop && form.direction ? form.direction : null,
  };
}
