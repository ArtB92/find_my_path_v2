import type { Bike } from "@find-my-path/shared";

export const formatKm = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
export const formatM = (m: number) => `${Math.round(m)} m`;

/** Flat speed per bike, plus a minute for every 10 m climbed: a rough but honest riding time. */
const FLAT_KMH: Record<Bike, number> = { road: 25, gravel: 18, trekking: 16 };

export function ridingTime(distanceM: number, ascentM: number, bike: Bike): string {
  const minutes = Math.round((distanceM / 1000 / FLAT_KMH[bike]) * 60 + ascentM / 10);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}
