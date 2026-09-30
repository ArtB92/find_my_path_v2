"use client";

import type { TrackPoint } from "@find-my-path/shared";
import { useId, useMemo, useRef, useState, useEffect, type KeyboardEvent, type PointerEvent } from "react";
import { formatKm, formatM } from "@/lib/format";
import { bisect, cumulativeKm } from "@/lib/track";

interface Props {
  track: TrackPoint[];
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
}

const HEIGHT = 150;
const PAD = { top: 16, right: 16, bottom: 22, left: 40 };
/** Offset of the profile's back face, which gives it depth. */
const DEPTH = { x: 6, y: -7 };

function niceStep(range: number, targetTicks: number) {
  const raw = range / targetTicks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
}

export function ElevationProfile({ track, hoverIndex, onHover }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const faceId = useId();
  const [width, setWidth] = useState(360);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const chart = useMemo(() => {
    const km = cumulativeKm(track);
    const eles = track.map((p) => p[2]);
    const totalKm = km.at(-1) ?? 0;
    const yStep = niceStep(Math.max(...eles) - Math.min(...eles) || 10, 3);
    const yMin = Math.floor(Math.min(...eles) / yStep) * yStep;
    const yMax = Math.ceil(Math.max(...eles) / yStep) * yStep || yMin + yStep;
    const innerW = Math.max(width - PAD.left - PAD.right, 10);
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const x = (d: number) => PAD.left + (totalKm ? (d / totalKm) * innerW : 0);
    const y = (e: number) => PAD.top + innerH - ((e - yMin) / (yMax - yMin)) * innerH;
    const line = track.map((p, i) => `${i ? "L" : "M"}${x(km[i]!).toFixed(1)},${y(p[2]).toFixed(1)}`).join("");
    const area = `${line}L${x(totalKm).toFixed(1)},${y(yMin)}L${x(0)},${y(yMin)}Z`;
    const yTicks: number[] = [];
    for (let v = yMin; v <= yMax; v += yStep) yTicks.push(v);
    const xStep = niceStep(totalKm || 1, Math.max(2, Math.floor(innerW / 70)));
    const xTicks: number[] = [];
    for (let v = 0; v <= totalKm; v += xStep) xTicks.push(v);
    const pts = track.map((p, i) => [x(km[i]!), y(p[2])] as const);
    const shift = ([px, py]: readonly [number, number]) => `${(px + DEPTH.x).toFixed(1)},${(py + DEPTH.y).toFixed(1)}`;
    const at = ([px, py]: readonly [number, number]) => `${px.toFixed(1)},${py.toFixed(1)}`;
    const top = pts
      .slice(1)
      .map((b, i) => `M${at(pts[i]!)}L${at(b)}L${shift(b)}L${shift(pts[i]!)}Z`)
      .join("");
    const end = pts.at(-1) ?? ([x(0), y(yMin)] as const);
    const base = [end[0], y(yMin)] as const;
    const side = `M${at(end)}L${shift(end)}L${shift(base)}L${at(base)}Z`;
    const ribs = xTicks.slice(1).map((v) => ({ x: x(v), top: y(track[bisect(km, v)]![2]), bottom: y(yMin) }));
    return { km, x, y, line, area, top, side, ribs, yTicks, xTicks, totalKm, lowest: Math.min(...eles), highest: Math.max(...eles) };
  }, [track, width]);

  const pickAt = (clientX: number, rect: DOMRect) => {
    const innerW = rect.width - PAD.left - PAD.right;
    const d = ((clientX - rect.left - PAD.left) / innerW) * chart.totalKm;
    onHover(bisect(chart.km, Math.min(Math.max(d, 0), chart.totalKm)));
  };

  const onKey = (e: KeyboardEvent) => {
    const step = Math.max(1, Math.round(track.length / 100));
    if (e.key === "ArrowRight") onHover(Math.min((hoverIndex ?? -step) + step, track.length - 1));
    else if (e.key === "ArrowLeft") onHover(Math.max((hoverIndex ?? step) - step, 0));
    else if (e.key === "Escape") onHover(null);
    else return;
    e.preventDefault();
  };

  const hover = hoverIndex !== null ? { km: chart.km[hoverIndex]!, ele: track[hoverIndex]![2] } : null;
  const tipLeft = hover ? Math.min(Math.max(chart.x(hover.km), 60), width - 60) : 0;

  return (
    <div ref={box} className="relative select-none">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        tabIndex={0}
        aria-label={`Elevation profile over ${formatKm(chart.totalKm * 1000)}, from ${formatM(chart.lowest)} to ${formatM(chart.highest)}. Use the arrow keys to move along the route.`}
        className="block touch-none rounded-sm"
        onPointerMove={(e: PointerEvent<SVGSVGElement>) => pickAt(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => onHover(null)}
        onKeyDown={onKey}
        onBlur={() => onHover(null)}
      >
        {chart.yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={PAD.left} x2={width - PAD.right} y1={chart.y(v)} y2={chart.y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={chart.y(v)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono text-[11px]">
              {v}
            </text>
          </g>
        ))}
        {chart.xTicks.map((v) => (
          <text key={`x${v}`} x={chart.x(v)} y={HEIGHT - 6} textAnchor="middle" className="fill-ink-3 font-mono text-[11px]">
            {v}
          </text>
        ))}
        <text x={width - PAD.right} y={HEIGHT - 6} textAnchor="end" className="fill-ink-3 text-[11px]">
          km
        </text>
        <defs>
          <linearGradient id={faceId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--brand-to)" />
            <stop offset="1" stopColor="var(--brand-from)" />
          </linearGradient>
        </defs>
        <path d={chart.top} fill="var(--route-top)" stroke="var(--route-top)" strokeWidth={0.5} />
        <path d={chart.side} fill="var(--brand-from)" />
        <path d={chart.area} fill={`url(#${faceId})`} />
        {chart.ribs.map((r) => (
          <line key={r.x} x1={r.x} x2={r.x} y1={r.top} y2={r.bottom} stroke="var(--brand-ink)" strokeOpacity={0.35} strokeWidth={1} />
        ))}
        <path d={chart.line} fill="none" stroke="var(--route-edge)" strokeWidth={1.5} strokeLinejoin="round" />
        {hover && (
          <g>
            <line
              x1={chart.x(hover.km)}
              x2={chart.x(hover.km)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="var(--ink-3)"
              strokeWidth={1}
            />
            <circle cx={chart.x(hover.km)} cy={chart.y(hover.ele)} r={4.5} fill="var(--route)" stroke="var(--paper)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-sm bg-ink px-2 py-1 font-mono text-xs text-paper shadow-md"
          style={{ left: tipLeft }}
        >
          {hover.km.toFixed(1)} km · {Math.round(hover.ele)} m
        </div>
      )}
    </div>
  );
}
