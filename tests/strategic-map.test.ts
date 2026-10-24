import { describe, expect, it } from "vitest";
import {
  BASE_GRID,
  DEFAULT_MAP_ID,
  MAP_SIZES,
  NEW_GAME_MAP_IDS,
  STRATEGIC_MAPS,
  featureSquares,
  isBlocked,
  mapOf,
  squareAt,
  squareIndex,
  terrainSquares,
  validBaseSpots,
  type Point,
  type StrategicMap,
} from "../src/strategic/rules/index.ts";

const medium = mapOf("medium-1");
const largeMaps = NEW_GAME_MAP_IDS.map((id) => mapOf(id));

/** Where stage 3 put the bases on Medium 1: player 1's spot and the same spot turned half a circle. */
const MEDIUM_BASES: Point[] = [
  { x: 2, y: 7 },
  { x: 26, y: 7 },
];

const baseRect = (spot: Point) => ({ x: spot.x, y: spot.y, w: BASE_GRID.w, h: BASE_GRID.h });

/** Flood fill in 8 directions from one square over everything that is not terrain (how infantry get about). */
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

/*
 * Tank driving, the way board.ts moves a 2 x 2 unit: eight directions, one square a step, and only
 * the footprint it lands on has to be clear. A tank position is its top-left square, numbered
 * y * (w - 1) + x over the (w - 1) x (h - 1) places a 2 x 2 footprint fits on the map.
 */

/** The four squares (as square indexes) a tank at this position covers. */
function tankFootprint(map: StrategicMap, pos: number): number[] {
  const x = pos % (map.w - 1);
  const y = Math.floor(pos / (map.w - 1));
  return [squareIndex(map, x, y), squareIndex(map, x + 1, y), squareIndex(map, x, y + 1), squareIndex(map, x + 1, y + 1)];
}

/** Where a tank may stand: off the terrain and off the `closed` squares. */
function tankGround(map: StrategicMap, closed: ReadonlySet<number> = new Set()): Uint8Array {
  const terrain = terrainSquares(map);
  const ground = new Uint8Array((map.w - 1) * (map.h - 1));
  for (let pos = 0; pos < ground.length; pos++) ground[pos] = tankFootprint(map, pos).some((i) => terrain.has(i) || closed.has(i)) ? 0 : 1;
  return ground;
}

/** Every tank position inside a base spot's rectangle. */
function basePositions(map: StrategicMap, spot: Point): number[] {
  const out: number[] = [];
  for (let y = spot.y; y <= spot.y + BASE_GRID.h - 2; y++) for (let x = spot.x; x <= spot.x + BASE_GRID.w - 2; x++) out.push(y * (map.w - 1) + x);
  return out;
}

/**
 * Breadth first from the starts over the tank ground, skipping positions `avoid` rules out. Returns
 * each reached position's previous one (-2 for a start, -1 for never reached) and the order reached.
 */
function drive(map: StrategicMap, ground: Uint8Array, starts: number[], avoid?: (x: number, y: number) => boolean) {
  const pw = map.w - 1;
  const ph = map.h - 1;
  const from = new Int32Array(ground.length).fill(-1);
  const order: number[] = [];
  const visit = (pos: number, prev: number) => {
    if (!ground[pos] || from[pos] !== -1 || avoid?.(pos % pw, Math.floor(pos / pw))) return;
    from[pos] = prev;
    order.push(pos);
  };
  for (const s of starts) visit(s, -2);
  for (let k = 0; k < order.length; k++) {
    const pos = order[k] as number;
    const x = pos % pw;
    const y = Math.floor(pos / pw);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && x + dx >= 0 && y + dy >= 0 && x + dx < pw && y + dy < ph) visit((y + dy) * pw + x + dx, pos);
      }
    }
  }
  return { from, order };
}

/** The shortest drive from any start to any target, as tank positions, or null when there is none. */
function route(map: StrategicMap, ground: Uint8Array, starts: number[], targets: ReadonlySet<number>): number[] | null {
  const { from, order } = drive(map, ground, starts);
  const end = order.find((pos) => targets.has(pos));
  if (end === undefined) return null;
  const path: number[] = [];
  for (let pos = end; pos !== -2; pos = from[pos] as number) path.push(pos);
  return path.reverse();
}

describe("map catalogue", () => {
  it("draws new games from the three Large maps, 60 x 30, with Large 1 the default", () => {
    expect(NEW_GAME_MAP_IDS).toEqual(["large-1", "large-2", "large-3"]);
    expect(DEFAULT_MAP_ID).toBe("large-1");
    for (const [n, map] of largeMaps.entries()) {
      expect(map.id).toBe(NEW_GAME_MAP_IDS[n]);
      expect(map).toMatchObject({ size: "large", ...MAP_SIZES.large });
      expect(map.name.length).toBeGreaterThan(0);
    }
    expect(new Set(largeMaps.map((m) => m.name)).size).toBe(3);
    expect(MAP_SIZES).toEqual({ small: { w: 30, h: 15 }, medium: { w: 40, h: 20 }, large: { w: 60, h: 30 } });
  });

  it("keeps Medium 1 for games saved on it, but never deals it to a new game", () => {
    expect(STRATEGIC_MAPS.map((m) => m.id)).toEqual(["large-1", "large-2", "large-3", "medium-1"]);
    expect(medium).toMatchObject({ id: "medium-1", size: "medium", w: 40, h: 20 });
    expect(NEW_GAME_MAP_IDS).not.toContain("medium-1");
  });

  it("lists no base spots on any map: bases are drawn by the placement rule", () => {
    for (const map of STRATEGIC_MAPS) expect(Object.keys(map).sort()).toEqual(["h", "id", "name", "size", "terrain", "w"]);
  });

  it("falls back to the default map for an unknown or missing id", () => {
    expect(mapOf("no-such-map")).toBe(mapOf(DEFAULT_MAP_ID));
    expect(mapOf(undefined)).toBe(mapOf(DEFAULT_MAP_ID));
    expect(mapOf(undefined).id).toBe("large-1");
  });

  it("numbers squares row by row, and squareAt undoes squareIndex", () => {
    expect(squareIndex(medium, 0, 0)).toBe(0);
    expect(squareIndex(medium, 3, 2)).toBe(83);
    expect(squareAt(medium, 83)).toEqual({ x: 3, y: 2 });
    expect(squareAt(medium, squareIndex(medium, 39, 19))).toEqual({ x: 39, y: 19 });
    const large = mapOf("large-1");
    expect(squareAt(large, squareIndex(large, 59, 29))).toEqual({ x: 59, y: 29 });
  });
});

describe.each(STRATEGIC_MAPS.map((map) => ({ name: map.name, map })))("$name: terrain", ({ map }) => {
  it("is point-symmetric: the terrain equals its own 180-degree image", () => {
    const terrain = terrainSquares(map);
    expect(terrain.size).toBeGreaterThan(0);
    const image = new Set([...terrain].map((i) => {
      const { x, y } = squareAt(map, i);
      return squareIndex(map, map.w - 1 - x, map.h - 1 - y);
    }));
    expect(image).toEqual(terrain);
  });

  it("makes every feature bigger than a fort and smaller than a base", () => {
    for (const f of map.terrain) {
      const squares = featureSquares(f, map);
      const xs = squares.map((p) => p.x);
      const ys = squares.map((p) => p.y);
      const where = `${f.kind} at ${f.cx},${f.cy}`;
      // At least 10 squares and fewer than a base's 72, and never a sliver.
      expect(squares.length, where).toBeGreaterThanOrEqual(10);
      expect(squares.length, where).toBeLessThan(BASE_GRID.w * BASE_GRID.h);
      expect(Math.max(...xs) - Math.min(...xs) + 1, where).toBeGreaterThanOrEqual(3);
      expect(Math.max(...ys) - Math.min(...ys) + 1, where).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps features apart so each reads as its own forest or hill", () => {
    const owner = new Map<number, number>();
    map.terrain.forEach((f, n) => {
      for (const p of featureSquares(f, map)) {
        const i = squareIndex(map, p.x, p.y);
        expect(owner.has(i), `features overlap at ${p.x},${p.y}`).toBe(false);
        owner.set(i, n);
      }
    });
    for (const [i, n] of owner) {
      const { x, y } = squareAt(map, i);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= map.w) continue;
          const m = owner.get(squareIndex(map, x + dx, y + dy));
          expect(m === undefined || m === n, `features touch at ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it("leaves no open square cut off: infantry can walk to every one", () => {
    const open = map.w * map.h - terrainSquares(map).size;
    const start = map.size === "large" ? (validBaseSpots(map, 0)[0] as Point) : (MEDIUM_BASES[0] as Point);
    expect(reachable(map, start).size).toBe(open);
  });
});

describe.each(largeMaps.map((map) => ({ name: map.name, map })))("$name: room for bases", ({ map }) => {
  const spots = [validBaseSpots(map, 0), validBaseSpots(map, 1)] as const;

  it("covers 5 to 12 percent of the map with terrain", () => {
    const share = terrainSquares(map).size / (map.w * map.h);
    expect(share).toBeGreaterThanOrEqual(0.05);
    expect(share).toBeLessThanOrEqual(0.12);
  });

  it("has at least 60 base spots in each half, in the top, middle and bottom thirds", () => {
    for (const half of spots) {
      expect(half.length).toBeGreaterThanOrEqual(60);
      // Which third of the map the base's middle row falls in.
      const thirds = [0, 0, 0];
      for (const s of half) thirds[Math.floor(((s.y + BASE_GRID.h / 2) * 3) / map.h)]! += 1;
      for (const count of thirds) expect(count).toBeGreaterThanOrEqual(5);
    }
  });

  it("offers both players the same spots, turned half a circle", () => {
    const turned = spots[0].map((s) => `${map.w - BASE_GRID.w - s.x},${map.h - BASE_GRID.h - s.y}`);
    expect(new Set(spots[1].map((s) => `${s.x},${s.y}`))).toEqual(new Set(turned));
  });

  it("lets a tank drive from any base spot to every other, in both halves", () => {
    const all = [...spots[0], ...spots[1]];
    const { from } = drive(map, tankGround(map), basePositions(map, all[0] as Point));
    const cutOff = all.filter((s) => !basePositions(map, s).some((pos) => from[pos] !== -1));
    expect(cutOff).toEqual([]);
  });

  it("gives every base two routes across the centre line that share no square", () => {
    const ground = tankGround(map);
    const targets = new Set(spots[1].flatMap((s) => basePositions(map, s)));
    for (const spot of spots[0]) {
      const where = `from ${spot.x},${spot.y}`;
      const first = route(map, ground, basePositions(map, spot), targets);
      expect(first, where).not.toBeNull();
      // The second route may leave from anywhere in the same base, but may not touch a square the first drove over.
      const inBase = (i: number) => {
        const { x, y } = squareAt(map, i);
        return x >= spot.x && x < spot.x + BASE_GRID.w && y >= spot.y && y < spot.y + BASE_GRID.h;
      };
      const used = new Set((first ?? []).flatMap((pos) => tankFootprint(map, pos)).filter((i) => !inBase(i)));
      expect(route(map, tankGround(map, used), basePositions(map, spot), targets), where).not.toBeNull();
    }
    // Player 2's spots are player 1's turned round on a point-symmetric map, so the same holds from their side.
  });

  it("cannot be cut in two by one unit (2 x 2) standing anywhere", () => {
    const ground = tankGround(map);
    const bases = [...spots[0], ...spots[1]].map((s) => basePositions(map, s));
    const cuts: string[] = [];
    for (let pos = 0; pos < ground.length; pos++) {
      if (!ground[pos]) continue;
      const bx = pos % (map.w - 1);
      const by = Math.floor(pos / (map.w - 1));
      // A tank can never stand where its footprint would overlap the blocker's.
      const { from } = drive(map, ground, bases[0] as number[], (x, y) => Math.abs(x - bx) <= 1 && Math.abs(y - by) <= 1);
      const lost = bases.filter((b) => !b.some((p) => from[p] !== -1)).length;
      if (lost > 0) cuts.push(`blocker at ${bx},${by} cuts off ${lost} spots`);
    }
    expect(cuts).toEqual([]);
  });
});

describe("Medium 1, kept for old saves", () => {
  it("keeps a clear square around both of stage 3's bases", () => {
    const terrain = terrainSquares(medium);
    for (const r of MEDIUM_BASES.map(baseRect)) {
      // The base must fit on the map with its ring of clear squares inside the map too.
      expect(r.x).toBeGreaterThanOrEqual(1);
      expect(r.y).toBeGreaterThanOrEqual(1);
      expect(r.x + r.w).toBeLessThanOrEqual(medium.w - 1);
      expect(r.y + r.h).toBeLessThanOrEqual(medium.h - 1);
      for (let y = r.y - 1; y <= r.y + r.h; y++) {
        for (let x = r.x - 1; x <= r.x + r.w; x++) expect(terrain.has(squareIndex(medium, x, y)), `${x},${y}`).toBe(false);
      }
    }
  });

  it("lets a tank drive from one old base to the other", () => {
    const { from } = drive(medium, tankGround(medium), basePositions(medium, MEDIUM_BASES[0] as Point));
    expect(basePositions(medium, MEDIUM_BASES[1] as Point).some((pos) => from[pos] !== -1)).toBe(true);
  });

  it("blocks terrain and everything off the map", () => {
    const [first] = terrainSquares(medium);
    const p = squareAt(medium, first as number);
    expect(isBlocked(medium, p.x, p.y)).toBe(true);
    expect(isBlocked(medium, -1, 0)).toBe(true);
    expect(isBlocked(medium, 0, medium.h)).toBe(true);
    expect(isBlocked(medium, 2, 7)).toBe(false);
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
