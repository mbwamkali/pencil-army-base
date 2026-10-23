import { describe, expect, it } from "vitest";
import {
  BASE_GRID,
  DEFAULT_MAP_ID,
  MAP_SIZES,
  STRATEGIC_MAPS,
  featureSquares,
  isBlocked,
  mapOf,
  squareAt,
  squareIndex,
  terrainSquares,
  type Point,
  type StrategicMap,
} from "../src/strategic/rules/index.ts";
import { oppositeSpot } from "../src/strategic/rules/setup.ts";

const medium = mapOf("medium-1");

/** Both base rectangles for a player 1 spot: the spot itself and its twin turned half a circle. */
const baseRects = (map: StrategicMap, spot: Point) =>
  [spot, oppositeSpot(spot, map)].map((b) => ({ x: b.x, y: b.y, w: BASE_GRID.w, h: BASE_GRID.h }));

/** Flood fill in 8 directions from one square over everything that is not terrain. */
function reachable(map: StrategicMap, from: Point): Set<number> {
  const blocked = terrainSquares(map);
  const seen = new Set([squareIndex(map, from.x, from.y)]);
  const queue = [...seen];
  while (queue.length) {
    const { x, y } = squareAt(map, queue.pop() as number);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        const i = squareIndex(map, nx, ny);
        if (blocked.has(i) || seen.has(i)) continue;
        seen.add(i);
        queue.push(i);
      }
    }
  }
  return seen;
}

describe("map catalogue", () => {
  it("has the Medium map as the default, 40 x 20, and the three sizes defined", () => {
    expect(DEFAULT_MAP_ID).toBe("medium-1");
    expect(STRATEGIC_MAPS.map((m) => m.id)).toContain("medium-1");
    expect(medium).toMatchObject({ id: "medium-1", size: "medium", w: 40, h: 20 });
    expect(MAP_SIZES).toEqual({ small: { w: 30, h: 15 }, medium: { w: 40, h: 20 }, large: { w: 60, h: 30 } });
    expect(medium.baseSpots).toEqual([{ x: 2, y: 7 }]);
  });

  it("falls back to the default map for an unknown or missing id", () => {
    expect(mapOf("no-such-map")).toBe(mapOf(DEFAULT_MAP_ID));
    expect(mapOf(undefined)).toBe(mapOf(DEFAULT_MAP_ID));
  });

  it("numbers squares row by row, and squareAt undoes squareIndex", () => {
    expect(squareIndex(medium, 0, 0)).toBe(0);
    expect(squareIndex(medium, 3, 2)).toBe(83);
    expect(squareAt(medium, 83)).toEqual({ x: 3, y: 2 });
    expect(squareAt(medium, squareIndex(medium, 39, 19))).toEqual({ x: 39, y: 19 });
  });
});

describe("the Medium map", () => {
  it("is point-symmetric: the terrain equals its own 180-degree image", () => {
    const terrain = terrainSquares(medium);
    expect(terrain.size).toBeGreaterThan(0);
    const image = new Set([...terrain].map((i) => {
      const { x, y } = squareAt(medium, i);
      return squareIndex(medium, medium.w - 1 - x, medium.h - 1 - y);
    }));
    expect(image).toEqual(terrain);
    expect(medium.terrain.length % 2).toBe(1); // the pairs plus one feature at the centre
  });

  it("keeps a clear square around both bases, for every base spot", () => {
    const terrain = terrainSquares(medium);
    for (const spot of medium.baseSpots) {
      for (const r of baseRects(medium, spot)) {
        // The base must fit on the map with its ring of clear squares inside the map too.
        expect(r.x).toBeGreaterThanOrEqual(1);
        expect(r.y).toBeGreaterThanOrEqual(1);
        expect(r.x + r.w).toBeLessThanOrEqual(medium.w - 1);
        expect(r.y + r.h).toBeLessThanOrEqual(medium.h - 1);
        for (let y = r.y - 1; y <= r.y + r.h; y++) {
          for (let x = r.x - 1; x <= r.x + r.w; x++) expect(terrain.has(squareIndex(medium, x, y)), `${x},${y}`).toBe(false);
        }
      }
    }
  });

  it("puts player 2's base in the right half, facing player 1's", () => {
    const [a, b] = baseRects(medium, medium.baseSpots[0] as Point);
    expect(a!.x + a!.w).toBeLessThan(medium.w / 2);
    expect(b!.x).toBeGreaterThan(medium.w / 2);
    expect(b!.x).toBe(medium.w - BASE_GRID.w - a!.x);
    expect(b!.y).toBe(medium.h - BASE_GRID.h - a!.y);
  });

  it("stays connected: every open square can be reached from both bases", () => {
    const open = medium.w * medium.h - terrainSquares(medium).size;
    for (const spot of medium.baseSpots) {
      for (const r of baseRects(medium, spot)) expect(reachable(medium, r).size).toBe(open);
    }
  });

  it("makes every feature smaller than a base and bigger than a fort", () => {
    for (const f of medium.terrain) {
      const squares = featureSquares(f, medium);
      const xs = squares.map((p) => p.x);
      const ys = squares.map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs) + 1;
      const h = Math.max(...ys) - Math.min(...ys) + 1;
      expect(w, `${f.kind} at ${f.cx},${f.cy}`).toBeLessThan(BASE_GRID.w);
      expect(h, `${f.kind} at ${f.cx},${f.cy}`).toBeLessThan(BASE_GRID.h);
      expect(w).toBeGreaterThanOrEqual(3);
      expect(h).toBeGreaterThanOrEqual(3);
      expect(squares.length).toBeGreaterThan(3 * 3);
    }
  });

  it("keeps features apart so each reads as its own forest or hill", () => {
    const owner = new Map<number, number>();
    medium.terrain.forEach((f, n) => {
      for (const p of featureSquares(f, medium)) {
        const i = squareIndex(medium, p.x, p.y);
        expect(owner.has(i), `features overlap at ${p.x},${p.y}`).toBe(false);
        owner.set(i, n);
      }
    });
    for (const [i, n] of owner) {
      const { x, y } = squareAt(medium, i);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const m = owner.get(squareIndex(medium, x + dx, y + dy));
          if (x + dx < 0 || x + dx >= medium.w) continue;
          expect(m === undefined || m === n, `features touch at ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it("blocks terrain and everything off the map", () => {
    const [first] = terrainSquares(medium);
    const p = squareAt(medium, first as number);
    expect(isBlocked(medium, p.x, p.y)).toBe(true);
    expect(isBlocked(medium, -1, 0)).toBe(true);
    expect(isBlocked(medium, 0, medium.h)).toBe(true);
    const spot = medium.baseSpots[0] as Point;
    expect(isBlocked(medium, spot.x, spot.y)).toBe(false);
  });
});

describe("featureSquares", () => {
  it("takes the squares whose centre is inside the ellipse, clipped to the map", () => {
    const tiny = { w: 6, h: 6 };
    const dot = featureSquares({ kind: "hill", cx: 3, cy: 3, rx: 1, ry: 1 }, tiny);
    expect(dot.length).toBe(4); // the four squares around the centre point, each centre 0.71 away
    const edge = featureSquares({ kind: "forest", cx: 0, cy: 0, rx: 2, ry: 2 }, tiny);
    expect(edge.every((p) => p.x >= 0 && p.y >= 0)).toBe(true);
    expect(edge.length).toBeGreaterThan(0);
  });
});
