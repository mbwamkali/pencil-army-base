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

/**
 * The first test map. New games no longer use it; it stays so games saved on it (with the fixed,
 * mirrored bases of stage 3) still load and play.
 */
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
};

/*
 * The Large maps. Bases land at random spots in each half (validBaseSpots in setup.ts), and a base
 * needs a clear 14 x 8 patch, so terrain in the home ground keeps to the map edges and to the
 * columns nearest the centre, leaving open fields in the top, middle and bottom thirds of each half.
 * Every feature is bigger than a fort and smaller than a base, and a tank always has two separate
 * ways from one base to the other (the map tests check all of this).
 */
const forest = (cx: number, cy: number, rx: number, ry: number): TerrainFeature => ({ kind: "forest", cx, cy, rx, ry });
const hill = (cx: number, cy: number, rx: number, ry: number): TerrainFeature => ({ kind: "hill", cx, cy, rx, ry });

/** Open fields: wide open ground with small copses dotted about and a chain of cover through the middle. */
const LARGE_1: StrategicMap = {
  id: "large-1",
  name: "Open fields",
  size: "large",
  ...MAP_SIZES.large,
  terrain: mirrored(
    MAP_SIZES.large,
    [
      // Copses round the edges of the home fields: on the top edge, the left edge and the bottom edge.
      forest(6.5, 1.3, 2.8, 1.5),
      forest(1.3, 14.5, 1.6, 2.3),
      forest(14.5, 28.6, 2.4, 1.5),
      // Out in front of the home fields: a copse up high and a low hill down low.
      forest(22, 6.5, 2.2, 1.8),
      hill(23, 21.5, 2.6, 2),
      // Cover near the centre line: a copse near the top, and one that starts the chain through the middle.
      forest(28.5, 4.5, 2, 1.7),
      forest(25, 11.5, 2.1, 1.9),
    ],
    // The middle copse of the chain.
    [forest(30, 15, 2.2, 1.9)],
  ),
};

/** The ridge: a line of hills down the centre line, broken by four narrow passes. */
const LARGE_2: StrategicMap = {
  id: "large-2",
  name: "The ridge",
  size: "large",
  ...MAP_SIZES.large,
  terrain: mirrored(
    MAP_SIZES.large,
    [
      // The ridge, zigzagging a little: a hill on the top edge, then one above the middle. The passes
      // between them are three squares wide (rows 3 to 5 and 10 to 12, and their twins at the bottom).
      hill(31.2, 0.8, 3.8, 2.4),
      hill(28.8, 8, 3.8, 2.2),
      // Woods at the left end of the two outer passes; their twins sit at the right end, so both
      // outer passes are wooded on either side and the two inner ones are bare.
      forest(22.5, 4.5, 2.2, 1.8),
      forest(22, 25.5, 2.2, 1.8),
      // A wood on the left edge, low down behind the home fields.
      forest(1.5, 21.5, 1.7, 2.3),
    ],
    // The middle of the ridge.
    [hill(30, 15, 3.8, 2.2)],
  ),
};

/** Woodland lanes: long forest belts across the middle, with open lanes between them that lead to the enemy. */
const LARGE_3: StrategicMap = {
  id: "large-3",
  name: "Woodland lanes",
  size: "large",
  ...MAP_SIZES.large,
  terrain: mirrored(
    MAP_SIZES.large,
    [
      // A long belt above the middle that reaches across the centre line (its twin lies below the middle).
      forest(27, 8.5, 9.5, 1.6),
      // A shorter belt near the top edge on the right (its twin is near the bottom edge on the left).
      forest(40, 2.5, 5.2, 1.5),
      // A wood at the home end of the middle belt, with a gap either side of it to drive through.
      forest(19.5, 15, 2.3, 1.7),
    ],
    // The middle belt.
    [forest(30, 15, 5.5, 1.7)],
  ),
};

/**
 * Every map a Strategic game can be played on. The first is the default: a saved game that names a
 * map that no longer exists falls back to it.
 */
export const STRATEGIC_MAPS: readonly StrategicMap[] = [LARGE_1, LARGE_2, LARGE_3, MEDIUM_1];

export const DEFAULT_MAP_ID = LARGE_1.id;

/** The maps a new game is drawn from, at random: the Large maps. Medium 1 is only for old saves. */
export const NEW_GAME_MAP_IDS: readonly string[] = [LARGE_1.id, LARGE_2.id, LARGE_3.id];

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
