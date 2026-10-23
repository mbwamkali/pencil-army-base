import { rectOf, rectsOverlap, sizeOf, type Rect, type Unit } from "../../rules/units.ts";
import { MOVE, isAlive } from "./constants.ts";
import { isBlocked } from "./maps.ts";
import type { Point, StrategicMap } from "./types.ts";

/**
 * Geometry of units on the map: footprints, distances, free squares and where a unit can move.
 * Shared by orders, the automatic infantry and the screens. Destroyed units never block anything.
 */

/** The eight ways a unit can step, each costing one square. */
export const DIRECTIONS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export const key = (p: Point): string => `${p.x},${p.y}`;

/** A unit's footprint if its top-left square were (x, y). */
export function footprintAt(u: Pick<Unit, "type" | "upright">, x: number, y: number): Rect {
  const { w, h } = sizeOf(u.type, u.upright);
  return { x, y, w, h };
}

export function centreOf(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * Distance in squares between the nearest squares of two footprints, counting a diagonal step as
 * one: 0 when they overlap, 1 when they touch (side or corner), 2 with one empty square between.
 */
export function squareDistance(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w - 1), a.x - (b.x + b.w - 1), 0);
  const dy = Math.max(b.y - (a.y + a.h - 1), a.y - (b.y + b.h - 1), 0);
  return Math.max(dx, dy);
}

/** The squares touching the outside of a footprint, corners included, in reading order. */
export function ringAround(r: Rect): Point[] {
  const ring: Point[] = [];
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      const inside = x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
      if (!inside) ring.push({ x, y });
    }
  }
  return ring;
}

export function insideMap(map: Pick<StrategicMap, "w" | "h">, r: Rect): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= map.w && r.y + r.h <= map.h;
}

/** True when any square of the footprint is terrain. */
export function overlapsTerrain(map: StrategicMap, r: Rect): boolean {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (isBlocked(map, x, y)) return true;
  return false;
}

/**
 * True when a footprint can be stood on: inside the map, off the terrain and clear of every living
 * unit except the ones in `ignore` (the moving unit itself, say). `ignore` holds the unit objects
 * themselves, not ids: both players name their units tank-1, tank-2 and so on, so ignoring by id
 * would let a tank drive onto the enemy's tank of the same number.
 */
export function isFree(map: StrategicMap, units: readonly Unit[], r: Rect, ignore: ReadonlySet<Unit> = new Set()): boolean {
  if (!insideMap(map, r) || overlapsTerrain(map, r)) return false;
  return !units.some((u) => !ignore.has(u) && isAlive(u) && rectsOverlap(r, rectOf(u)));
}

/** The living unit whose footprint holds a square, if any. */
export function unitAtSquare(units: readonly Unit[], x: number, y: number): Unit | undefined {
  return units.find((u) => {
    if (!isAlive(u)) return false;
    const r = rectOf(u);
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  });
}

/**
 * Every top-left square a unit can reach this turn, with the path of top-left squares to get there
 * (the start left out). Breadth first over the eight directions; every step costs one square and
 * every footprint along the way must be free. `units` are both sides' units and must hold the very
 * `unit` object, which is ignored so it never blocks itself.
 */
export function reachable(
  map: StrategicMap,
  units: readonly Unit[],
  unit: Unit,
  range: number = MOVE[unit.type],
  ignore: ReadonlySet<Unit> = new Set([unit]),
): Map<string, Point[]> {
  const out = new Map<string, Point[]>();
  if (range <= 0 || !isAlive(unit)) return out;
  const start = { x: unit.x, y: unit.y };
  const seen = new Set([key(start)]);
  let frontier: { at: Point; path: Point[] }[] = [{ at: start, path: [] }];
  for (let step = 0; step < range && frontier.length > 0; step++) {
    const next: typeof frontier = [];
    for (const { at, path } of frontier) {
      for (const d of DIRECTIONS) {
        const to = { x: at.x + d.x, y: at.y + d.y };
        const k = key(to);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!isFree(map, units, footprintAt(unit, to.x, to.y), ignore)) continue;
        const walked = [...path, to];
        out.set(k, walked);
        next.push({ at: to, path: walked });
      }
    }
    frontier = next;
  }
  return out;
}
