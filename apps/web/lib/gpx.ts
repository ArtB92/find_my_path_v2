import type { Route } from "@find-my-path/shared";

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** GPX 1.1 track with elevation, the format Garmin Connect, Strava and Komoot import. */
export function toGpx(route: Route, name: string): string {
  const points = route.track
    .map(([lon, lat, ele]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FindMyPath" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(name)}</name></metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <type>cycling</type>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

export function routeName(route: Route): string {
  const start = route.waypoints.find((w) => w.role === "start")?.name.split(",")[0] ?? "Route";
  const end = route.waypoints.find((w) => w.role === "end")?.name.split(",")[0];
  const km = Math.round(route.distanceM / 1000);
  return end ? `${start} to ${end}, ${km} km` : `${start} loop, ${km} km`;
}
