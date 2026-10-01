export const formatKm = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
export const formatM = (m: number) => `${Math.round(m)} m`;
