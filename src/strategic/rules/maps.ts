import { MAP_SIZES } from "./constants.ts";
import type { Point, StrategicMap, TerrainFeature } from "./types.ts";

/**
 * Point symmetry: every feature on the left half gets a twin turned half a circle about the map's
 * centre, so both players face the same ground. A feature centred on the map is its own twin.
 */
function mirrored(size: { w: number; h: number }, left: TerrainFeature[], centre: TerrainFeature[] = []): TerrainFeature[] {
  const twin = (f: TerrainFeature): TerrainFeature => ({ ...f, cx: size.w - f.cx, cy: size.h - f.cy });
  return [...left, ...left.map(twin), ...centre];
}

const MEDIUM_1: StrategicMap = {
  id: "medium-1",
  name: "Medium 1",
  size: "medium",
  ...MAP_SIZES.medium,
  terrain: mirrored(
    MAP_SIZES.medium,
    [
      // A forest above the base and another below and to its right, so the way out is never straight.
      { kind: "forest", cx: 8, cy: 3, rx: 3.4, ry: 2.1 },
      { kind: "forest", cx: 12, cy: 16.5, rx: 2.8, ry: 2.2 },
      // A hill at the top of the centre line (its twin sits at the bottom).
      { kind: "hill", cx: 20, cy: 4, rx: 3.3, ry: 2.2 },
    ],
    // A small forest right in the middle, leaving two-square gaps on the centre line.
    [{ kind: "forest", cx: 20, cy: 10, rx: 2.3, ry: 1.9 }],
  ),
  baseSpots: [{ x: 2, y: 7 }],
};

/** Every map a Strategic game can be played on. Small and Large come once Medium plays well. */
export const STRATEGIC_MAPS: readonly StrategicMap[] = [MEDIUM_1];

export const DEFAULT_MAP_ID = MEDIUM_1.id;

/** The map with this id, or the default map when a saved game names one that no longer exists. */
export function mapOf(id: string | undefined): StrategicMap {
  return STRATEGIC_MAPS.find((m) => m.id === id) ?? (STRATEGIC_MAPS[0] as StrategicMap);
}

/** Square index as stored in explored sets and visible sets: row by row. */
export function squareIndex(map: Pick<StrategicMap, "w">, x: number, y: number): number {
  return y * map.w + x;
}

/** The square an index points at. */
export function squareAt(map: Pick<StrategicMap, "w">, index: number): Point {
  return { x: index % map.w, y: Math.floor(index / map.w) };
}

/** The squares a feature covers: those whose centre lies inside (or on) its ellipse, inside the map. */
export function featureSquares(feature: TerrainFeature, map: Pick<StrategicMap, "w" | "h">): Point[] {
  const out: Point[] = [];
  const x0 = Math.max(0, Math.floor(feature.cx - feature.rx));
  const x1 = Math.min(map.w - 1, Math.ceil(feature.cx + feature.rx));
  const y0 = Math.max(0, Math.floor(feature.cy - feature.ry));
  const y1 = Math.min(map.h - 1, Math.ceil(feature.cy + feature.ry));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - feature.cx) / feature.rx;
      const dy = (y + 0.5 - feature.cy) / feature.ry;
      if (dx * dx + dy * dy <= 1) out.push({ x, y });
    }
  }
  return out;
}

// Maps never change, so the terrain squares of each are worked out once.
const terrainCache = new WeakMap<StrategicMap, Set<number>>();

/** Every square index covered by terrain on this map. */
export function terrainSquares(map: StrategicMap): Set<number> {
  const cached = terrainCache.get(map);
  if (cached) return cached;
  const set = new Set<number>();
  for (const f of map.terrain) for (const p of featureSquares(f, map)) set.add(squareIndex(map, p.x, p.y));
  terrainCache.set(map, set);
  return set;
}

/** True when a unit can never stand here: off the map or on terrain. */
export function isBlocked(map: StrategicMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return true;
  return terrainSquares(map).has(squareIndex(map, x, y));
}
