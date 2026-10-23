import type { Point, StrategicMap } from "../rules/types.ts";

/**
 * Camera maths for the Strategic map view. Pure functions only, so they can be unit tested without a
 * browser. A camera is a centre in map squares and a scale in stage pixels per square; the view turns
 * it into an SVG viewBox in world units (map squares times SQ_NEAR).
 */

/** Stage px per square when zoomed in: the same as a square on a full Quick action board, so unit art looks familiar. */
export const SQ_NEAR = 38;

/** Zoomed in as far as it goes: twice SQ_NEAR. Closer than that, a tank fills a quarter of the screen. */
export const SCALE_MAX = 2 * SQ_NEAR;

/** One zoom step, used by double tap. */
export const ZOOM_STEP = 1.6;

/** The base is a Skirmish grid (decision 1). Keep in step with BASE_GRID in the strategic rules. */
export const BASE_SIZE = { w: 12, h: 6 };

export interface Camera {
  /** Centre of the view, in map squares. */
  cx: number;
  cy: number;
  /** Stage px per map square. */
  scale: number;
}

/*
 * Every function that fits or clamps takes an optional `bottom`: stage px along the viewport's bottom
 * edge that something drawn over the map covers (the replay's controls pill). The whole-map fit then
 * fits the map above it, and the clamp lets the map slide up far enough to show its last row above
 * it. Left at 0, nothing changes.
 */

/** The scale at which the whole map just fits the viewport (the part of it above `bottom`). */
export function fitScale(map: Pick<StrategicMap, "w" | "h">, width: number, height: number, bottom = 0): number {
  return Math.min(width / map.w, (height - bottom) / map.h);
}

/** The whole map in view, centred in the part of the viewport above `bottom`. */
export function fitCamera(map: Pick<StrategicMap, "w" | "h">, width: number, height: number, bottom = 0): Camera {
  const scale = fitScale(map, width, height, bottom);
  return { cx: map.w / 2, cy: map.h / 2 + bottom / 2 / scale, scale };
}

/** Zoomed in on the viewer's base: SQ_NEAR px per square, centred on the base above `bottom` (as far as the map edge allows). */
export function baseCamera(map: Pick<StrategicMap, "w" | "h">, base: Point, width: number, height: number, bottom = 0): Camera {
  const c = { cx: base.x + BASE_SIZE.w / 2, cy: base.y + BASE_SIZE.h / 2 + bottom / 2 / SQ_NEAR, scale: SQ_NEAR };
  return clampCamera(c, map, width, height, bottom);
}

/**
 * Keep the camera sensible: the scale between the whole-map fit and SCALE_MAX, and the viewport inside
 * the map. When the map is smaller than the viewport along an axis (the whole-map view letterboxes),
 * the map sits centred on that axis instead. With a `bottom` cover the map may also rise until its
 * last row sits just above the cover, so nothing on the map is out of reach under it.
 */
export function clampCamera(c: Camera, map: Pick<StrategicMap, "w" | "h">, width: number, height: number, bottom = 0): Camera {
  const scale = clampScale(c.scale, map, width, height, bottom);
  return { cx: clampAxis(c.cx, map.w, width / scale), cy: clampAxis(c.cy, map.h, height / scale, bottom / scale), scale };
}

/** The scale between the whole-map fit and SCALE_MAX. The fit wins on a tiny map, so the map always at least fills the view. */
export function clampScale(scale: number, map: Pick<StrategicMap, "w" | "h">, width: number, height: number, bottom = 0): number {
  return Math.max(fitScale(map, width, height, bottom), Math.min(scale, SCALE_MAX));
}

/**
 * Along one axis: a view `span` squares long stays inside a map `size` squares long, or is centred
 * when it cannot. The view's last `cover` squares are hidden under something: the map's far edge may
 * come up to meet the cover, and a map that fits in the rest is centred there.
 */
function clampAxis(centre: number, size: number, span: number, cover = 0): number {
  if (span - cover >= size) return size / 2 + cover / 2;
  return Math.min(Math.max(centre, span / 2), size - span / 2 + cover);
}

/** Whether the camera shows the whole map (within 1% of the fit scale), for the "Whole map" button label. */
export function isWholeCamera(c: Camera, map: Pick<StrategicMap, "w" | "h">, width: number, height: number, bottom = 0): boolean {
  const fit = fitScale(map, width, height, bottom);
  return Math.abs(c.scale - fit) <= fit / 100;
}

/** A viewport point (stage px from the view's top-left corner) as fractional map squares. */
export function toMap(c: Camera, px: Point, width: number, height: number): Point {
  return { x: c.cx + (px.x - width / 2) / c.scale, y: c.cy + (px.y - height / 2) / c.scale };
}

/** A map point as a viewport point (stage px from the view's top-left corner). */
export function toScreen(c: Camera, p: Point, width: number, height: number): Point {
  return { x: width / 2 + (p.x - c.cx) * c.scale, y: height / 2 + (p.y - c.cy) * c.scale };
}

/**
 * The clamped camera at `scale` that puts map point `at` under viewport point `px`. This is the whole
 * of a pinch: the point that was under the fingers' midpoint follows the midpoint while the scale
 * follows their distance, so panning and zooming happen in one gesture.
 */
export function cameraHolding(
  at: Point,
  px: Point,
  scale: number,
  map: Pick<StrategicMap, "w" | "h">,
  width: number,
  height: number,
  bottom = 0,
): Camera {
  // Clamp the scale first: a centre worked out for a scale the clamp then lowers would let the point drift.
  const s = clampScale(scale, map, width, height, bottom);
  return clampCamera({ cx: at.x - (px.x - width / 2) / s, cy: at.y - (px.y - height / 2) / s, scale: s }, map, width, height, bottom);
}

/** Zoom by a factor about a map point, so what is under the finger stays put (as far as the clamp allows). */
export function zoomAbout(
  c: Camera,
  at: Point,
  factor: number,
  map: Pick<StrategicMap, "w" | "h">,
  width: number,
  height: number,
  bottom = 0,
): Camera {
  return cameraHolding(at, toScreen(c, at, width, height), c.scale * factor, map, width, height, bottom);
}

/**
 * The camera after one finger moved by `delta` stage px: the map follows the finger as far as the clamp
 * allows. The view applies every move as the change since the last one, so once the clamp has stopped
 * the map at an edge it sets off again the moment the finger turns round, rather than once the finger
 * has retraced the whole overshoot.
 */
export function panCamera(c: Camera, delta: Point, map: Pick<StrategicMap, "w" | "h">, width: number, height: number, bottom = 0): Camera {
  return clampCamera({ cx: c.cx - delta.x / c.scale, cy: c.cy - delta.y / c.scale, scale: c.scale }, map, width, height, bottom);
}

/**
 * The camera looking straight at a map point at its current scale, as far as the clamp allows: tapping
 * an order row brings that unit into view without changing how far in the player had zoomed.
 */
export function centreCamera(c: Camera, at: Point, map: Pick<StrategicMap, "w" | "h">, width: number, height: number, bottom = 0): Camera {
  return clampCamera({ cx: at.x, cy: at.y, scale: c.scale }, map, width, height, bottom);
}

/** Two fingers on the view: their midpoint (stage px from the view's top-left) and the distance between them. */
export interface Pinch {
  mid: Point;
  dist: number;
}

/**
 * The camera after two fingers moved from one reading to the next: the map point that was under the old
 * midpoint goes under the new one, and the scale grows with the fingers' distance. Applied step by step
 * it matches one pinch from start to end while nothing is clamped, and when the scale limit or a map edge
 * does stop the map, the overshoot is not held against the fingers (same reason as panCamera).
 */
export function pinchCamera(
  c: Camera,
  from: Pinch,
  to: Pinch,
  map: Pick<StrategicMap, "w" | "h">,
  width: number,
  height: number,
  bottom = 0,
): Camera {
  return cameraHolding(toMap(c, from.mid, width, height), to.mid, (c.scale * to.dist) / from.dist, map, width, height, bottom);
}

/** The part of the map the camera shows, in squares (may reach outside the map when it letterboxes). */
export function viewportRect(c: Camera, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const w = width / c.scale;
  const h = height / c.scale;
  return { x: c.cx - w / 2, y: c.cy - h / 2, w, h };
}

/** The SVG viewBox for a camera, in world units (map squares times SQ_NEAR). */
export function viewBoxOf(c: Camera, width: number, height: number): string {
  const r = viewportRect(c, width, height);
  return [r.x, r.y, r.w, r.h].map((v) => Math.round(v * SQ_NEAR * 1000) / 1000).join(" ");
}

/**
 * Whether a map point lies in the middle of the view: inside the viewport with `margin` of its width
 * and height kept clear on every side (0.15 leaves the middle 70%). The replay pans only when the next
 * thing to show falls outside it, so the map does not twitch for every step.
 */
export function inViewport(c: Camera, p: Point, width: number, height: number, margin = 0.15): boolean {
  const r = viewportRect(c, width, height);
  return (
    p.x >= r.x + margin * r.w && p.x <= r.x + (1 - margin) * r.w && p.y >= r.y + margin * r.h && p.y <= r.y + (1 - margin) * r.h
  );
}

/** Slow in, slow out, for 0 <= t <= 1: a short pan that starts and stops gently instead of jerking. */
export function easeInOut(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
}

/** The camera a fraction t of the way from a to b (centre and scale both), for an animated pan. */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, scale: a.scale + (b.scale - a.scale) * t };
}
