"use client";

import type { Pin, Route } from "@find-my-path/shared";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, LngLatBoundsLike, MapMouseEvent } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { darkMapStyle } from "@/lib/map-style";
import { cumulativeKm, lngLatAt } from "@/lib/track";

interface Props {
  route: Route | null;
  pins: Pin[];
  addingPin: boolean;
  onAddPin: (lat: number, lon: number) => void;
  onMovePin: (label: string, lat: number, lon: number) => void;
  hoverIndex: number | null;
}

const MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? darkMapStyle;
/** One lap of the direction dot, start to finish. */
const LAP_MS = 3000;
const ILE_DE_FRANCE: LngLatBoundsLike = [
  [1.44, 48.12],
  [3.56, 49.24],
];
const EMPTY = { type: "FeatureCollection" as const, features: [] };

maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Map button that flies back to the route, or to the whole service area when there's none. */
function recenterControl(home: () => LngLatBoundsLike): maplibregl.IControl {
  const group = document.createElement("div");
  group.className = "maplibregl-ctrl maplibregl-ctrl-group";
  const button = document.createElement("button");
  button.type = "button";
  button.title = "Recenter map";
  button.setAttribute("aria-label", "Recenter map");
  button.className = "grid place-items-center";
  button.innerHTML =
    '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="10" cy="10" r="5.5"/><circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3"/></svg>';
  group.append(button);
  let map: maplibregl.Map | undefined;
  button.addEventListener("click", () => map?.fitBounds(home(), { padding: 48, duration: 600 }));
  return {
    onAdd(m) {
      map = m;
      return group;
    },
    onRemove() {
      group.remove();
      map = undefined;
    },
  };
}

function markerEl(className: string, text = "") {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}

export default function RouteMap({ route, pins, addingPin, onAddPin, onMovePin, hoverIndex }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const pinMarkers = useRef<maplibregl.Marker[]>([]);
  const waypointMarkers = useRef<maplibregl.Marker[]>([]);
  const hoverMarker = useRef<maplibregl.Marker | null>(null);
  const home = useRef<LngLatBoundsLike>(ILE_DE_FRANCE);
  const handlers = useRef({ addingPin, onAddPin, onMovePin });
  useEffect(() => {
    handlers.current = { addingPin, onAddPin, onMovePin };
  });

  useEffect(() => {
    if (!container.current) return;
    const m = new maplibregl.Map({ container: container.current, style: MAP_STYLE, bounds: ILE_DE_FRANCE, attributionControl: { compact: true } });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(recenterControl(() => home.current), "top-right");
    m.on("style.load", () => {
      const [from, to, ink] = [token("--brand-from"), token("--brand-to"), token("--brand-ink")];
      m.addSource("route", { type: "geojson", data: EMPTY, lineMetrics: true });
      m.addSource("route-dot", { type: "geojson", data: EMPTY });
      m.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ink, "line-width": 8, "line-opacity": 0.9 },
      });
      m.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-width": 4.5, "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, from, 1, to] },
      });
      m.addLayer({
        id: "route-dot-halo",
        type: "circle",
        source: "route-dot",
        paint: { "circle-radius": 16, "circle-color": to, "circle-opacity": 0.45, "circle-blur": 0.5 },
      });
      m.addLayer({
        id: "route-dot",
        type: "circle",
        source: "route-dot",
        paint: { "circle-radius": 7, "circle-color": ink, "circle-stroke-color": to, "circle-stroke-width": 3 },
      });
    });
    m.on("click", (e: MapMouseEvent) => {
      if (handlers.current.addingPin) handlers.current.onAddPin(e.lngLat.lat, e.lngLat.lng);
    });
    map.current = m;
    return () => m.remove();
  }, []);

  useEffect(() => {
    map.current?.getCanvas().style.setProperty("cursor", addingPin ? "crosshair" : "");
  }, [addingPin]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    pinMarkers.current.forEach((mk) => mk.remove());
    pinMarkers.current = pins.map((pin) => {
      const marker = new maplibregl.Marker({
        element: markerEl("grid size-7 place-items-center rounded-full border-2 border-white bg-ink font-mono text-xs font-medium text-paper shadow-md", pin.label),
        draggable: true,
      })
        .setLngLat([pin.lon, pin.lat])
        .addTo(m);
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        handlers.current.onMovePin(pin.label, lat, lng);
      });
      return marker;
    });
  }, [pins]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      const source = m.getSource<GeoJSONSource>("route");
      if (!source) return;
      waypointMarkers.current.forEach((mk) => mk.remove());
      waypointMarkers.current = [];
      if (!route) {
        home.current = ILE_DE_FRANCE;
        source.setData(EMPTY);
        return;
      }
      source.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: route.track.map(([lon, lat]) => [lon, lat]) },
      });
      waypointMarkers.current = route.waypoints.map((w) =>
        new maplibregl.Marker({
          element: markerEl(
            w.role === "via"
              ? "size-3 rounded-full border-2 border-white bg-ink shadow"
              : "size-4 rounded-full border-[3px] border-white bg-brand shadow-md",
          ),
        })
          .setLngLat([w.lon, w.lat])
          .setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setText(w.name))
          .addTo(m),
      );
      const bounds = new maplibregl.LngLatBounds();
      route.track.forEach(([lon, lat]) => bounds.extend([lon, lat]));
      home.current = bounds;
      m.fitBounds(bounds, { padding: 48, duration: 600 });
    };
    if (m.getSource("route")) draw();
    else m.once("style.load", draw);
  }, [route]);

  useEffect(() => {
    const m = map.current;
    if (!m || !route || route.track.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const km = cumulativeKm(route.track);
    let frame = 0;
    const tick = (now: number) => {
      const lngLat = lngLatAt(route.track, km, (now % LAP_MS) / LAP_MS);
      m.getSource<GeoJSONSource>("route-dot")?.setData({ type: "Point", coordinates: lngLat });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      m.getSource<GeoJSONSource>("route-dot")?.setData(EMPTY);
    };
  }, [route]);

  useEffect(() => {
    const m = map.current;
    const point = hoverIndex !== null ? route?.track[hoverIndex] : undefined;
    if (!m || !point) {
      hoverMarker.current?.remove();
      hoverMarker.current = null;
      return;
    }
    hoverMarker.current ??= new maplibregl.Marker({
      element: markerEl("size-3.5 rounded-full border-2 border-white bg-route shadow-md"),
    });
    hoverMarker.current.setLngLat([point[0], point[1]]).addTo(m);
  }, [hoverIndex, route]);

  return <div ref={container} className="h-full w-full" aria-label="Map" role="region" />;
}
