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

/** The scale at which the whole map just fits the viewport. */
export function fitScale(map: Pick<StrategicMap, "w" | "h">, width: number, height: number): number {
  return Math.min(width / map.w, height / map.h);
}

/** The whole map in view, centred. */
export function fitCamera(map: Pick<StrategicMap, "w" | "h">, width: number, height: number): Camera {
  return { cx: map.w / 2, cy: map.h / 2, scale: fitScale(map, width, height) };
}

/** Zoomed in on the viewer's base: SQ_NEAR px per square, centred on the base (as far as the map edge allows). */
export function baseCamera(map: Pick<StrategicMap, "w" | "h">, base: Point, width: number, height: number): Camera {
  return clampCamera({ cx: base.x + BASE_SIZE.w / 2, cy: base.y + BASE_SIZE.h / 2, scale: SQ_NEAR }, map, width, height);
}

/**
 * Keep the camera sensible: the scale between the whole-map fit and SCALE_MAX, and the viewport inside
 * the map. When the map is smaller than the viewport along an axis (the whole-map view letterboxes),
 * the map sits centred on that axis instead.
 */
export function clampCamera(c: Camera, map: Pick<StrategicMap, "w" | "h">, width: number, height: number): Camera {
  const scale = clampScale(c.scale, map, width, height);
  return { cx: clampAxis(c.cx, map.w, width / scale), cy: clampAxis(c.cy, map.h, height / scale), scale };
}

/** The scale between the whole-map fit and SCALE_MAX. The fit wins on a tiny map, so the map always at least fills the view. */
export function clampScale(scale: number, map: Pick<StrategicMap, "w" | "h">, width: number, height: number): number {
  return Math.max(fitScale(map, width, height), Math.min(scale, SCALE_MAX));
}

/** Along one axis: a view `span` squares long stays inside a map `size` squares long, or is centred when it cannot. */
function clampAxis(centre: number, size: number, span: number): number {
  if (span >= size) return size / 2;
  return Math.min(Math.max(centre, span / 2), size - span / 2);
}

/** Whether the camera shows the whole map (within 1% of the fit scale), for the "Whole map" button label. */
export function isWholeCamera(c: Camera, map: Pick<StrategicMap, "w" | "h">, width: number, height: number): boolean {
  const fit = fitScale(map, width, height);
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
): Camera {
  // Clamp the scale first: a centre worked out for a scale the clamp then lowers would let the point drift.
  const s = clampScale(scale, map, width, height);
  return clampCamera({ cx: at.x - (px.x - width / 2) / s, cy: at.y - (px.y - height / 2) / s, scale: s }, map, width, height);
}

/** Zoom by a factor about a map point, so what is under the finger stays put (as far as the clamp allows). */
export function zoomAbout(
  c: Camera,
  at: Point,
  factor: number,
  map: Pick<StrategicMap, "w" | "h">,
  width: number,
  height: number,
): Camera {
  return cameraHolding(at, toScreen(c, at, width, height), c.scale * factor, map, width, height);
}

/**
 * The camera after one finger moved by `delta` stage px: the map follows the finger as far as the clamp
 * allows. The view applies every move as the change since the last one, so once the clamp has stopped
 * the map at an edge it sets off again the moment the finger turns round, rather than once the finger
 * has retraced the whole overshoot.
 */
export function panCamera(c: Camera, delta: Point, map: Pick<StrategicMap, "w" | "h">, width: number, height: number): Camera {
  return clampCamera({ cx: c.cx - delta.x / c.scale, cy: c.cy - delta.y / c.scale, scale: c.scale }, map, width, height);
}

/**
 * The camera looking straight at a map point at its current scale, as far as the clamp allows: tapping
 * an order row brings that unit into view without changing how far in the player had zoomed.
 */
export function centreCamera(c: Camera, at: Point, map: Pick<StrategicMap, "w" | "h">, width: number, height: number): Camera {
  return clampCamera({ cx: at.x, cy: at.y, scale: c.scale }, map, width, height);
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
): Camera {
  return cameraHolding(toMap(c, from.mid, width, height), to.mid, (c.scale * to.dist) / from.dist, map, width, height);
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
