import { describe, expect, it } from "vitest";
import { typeOfId, type Unit } from "../src/rules/index.ts";
import {
  DIRECTIONS,
  centreOf,
  footprintAt,
  insideMap,
  isBlocked,
  isFree,
  key,
  mapOf,
  overlapsTerrain,
  reachable,
  ringAround,
  squareDistance,
  unitAtSquare,
} from "../src/strategic/rules/index.ts";

const medium = mapOf("medium-1");

/** A unit from its id ("tank-2" is a tank) at a top-left square. */
const unit = (id: string, x: number, y: number, hits = 0, upright = false): Unit => ({ id, type: typeOfId(id) as Unit["type"], x, y, upright, hits });

describe("squareDistance", () => {
  it("is 0 overlapping, 1 touching by side or corner, 2 with one square between, and symmetric", () => {
    const a = { x: 4, y: 4, w: 2, h: 2 }; // squares 4-5 both ways
    expect(squareDistance(a, a)).toBe(0);
    expect(squareDistance(a, { x: 5, y: 5, w: 2, h: 2 })).toBe(0);
    expect(squareDistance(a, { x: 6, y: 4, w: 1, h: 1 })).toBe(1); // side
    expect(squareDistance(a, { x: 6, y: 6, w: 1, h: 1 })).toBe(1); // corner
    expect(squareDistance(a, { x: 3, y: 3, w: 1, h: 1 })).toBe(1);
    expect(squareDistance(a, { x: 7, y: 4, w: 1, h: 1 })).toBe(2);
    expect(squareDistance(a, { x: 7, y: 7, w: 1, h: 1 })).toBe(2); // diagonal, one square between
    expect(squareDistance(a, { x: 1, y: 9, w: 2, h: 1 })).toBe(4); // 2 across, 4 down: the larger counts
    expect(squareDistance(a, { x: 0, y: 0, w: 3, h: 3 })).toBe(2);
    expect(squareDistance({ x: 0, y: 0, w: 3, h: 3 }, a)).toBe(2);
  });
});

describe("footprints and rings", () => {
  it("footprintAt and centreOf follow the unit's size", () => {
    expect(footprintAt({ type: "tank", upright: false }, 3, 4)).toEqual({ x: 3, y: 4, w: 2, h: 2 });
    expect(footprintAt({ type: "wall", upright: true }, 3, 4)).toEqual({ x: 3, y: 4, w: 1, h: 2 });
    expect(centreOf({ x: 3, y: 4, w: 2, h: 2 })).toEqual({ x: 4, y: 5 });
    expect(centreOf({ x: 10, y: 8, w: 3, h: 3 })).toEqual({ x: 11.5, y: 9.5 });
  });

  it("ringAround lists the 16 squares round a 3 x 3 in reading order, 12 round a 2 x 2, 8 round a single square", () => {
    const ring = ringAround({ x: 10, y: 8, w: 3, h: 3 });
    expect(ring).toHaveLength(16);
    expect(ring[0]).toEqual({ x: 9, y: 7 });
    expect(ring.at(-1)).toEqual({ x: 13, y: 11 });
    expect(ring.some((p) => p.x >= 10 && p.x <= 12 && p.y >= 8 && p.y <= 10)).toBe(false);
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1]!;
      const b = ring[i]!;
      expect(b.y > a.y || (b.y === a.y && b.x > a.x)).toBe(true);
    }
    expect(ringAround({ x: 0, y: 0, w: 2, h: 2 })).toHaveLength(12); // may reach off the map; callers check
    expect(ringAround({ x: 5, y: 5, w: 1, h: 1 })).toHaveLength(8);
    expect(key({ x: 3, y: 12 })).toBe("3,12");
    expect(DIRECTIONS).toHaveLength(8);
  });
});

describe("isFree", () => {
  it("rejects terrain, the map edge and living units, ignores destroyed units and the units it is told to", () => {
    expect(isBlocked(medium, 8, 3)).toBe(true); // inside the forest above base 1
    expect(overlapsTerrain(medium, { x: 4, y: 2, w: 2, h: 2 })).toBe(true); // (5,2) is forest
    expect(overlapsTerrain(medium, { x: 3, y: 2, w: 2, h: 2 })).toBe(false);
    expect(isFree(medium, [], { x: 8, y: 3, w: 1, h: 1 })).toBe(false);
    expect(isFree(medium, [], { x: 7, y: 6, w: 2, h: 2 })).toBe(true);
    expect(isFree(medium, [], { x: -1, y: 5, w: 2, h: 2 })).toBe(false);
    expect(isFree(medium, [], { x: 39, y: 5, w: 2, h: 2 })).toBe(false);
    expect(isFree(medium, [], { x: 38, y: 18, w: 2, h: 2 })).toBe(true);
    expect(insideMap(medium, { x: 38, y: 19, w: 2, h: 2 })).toBe(false);
    const tank = unit("tank-1", 6, 8);
    expect(isFree(medium, [tank], { x: 7, y: 9, w: 1, h: 1 })).toBe(false);
    expect(isFree(medium, [tank], { x: 8, y: 9, w: 1, h: 1 })).toBe(true);
    expect(isFree(medium, [unit("tank-1", 6, 8, 3)], { x: 7, y: 9, w: 1, h: 1 })).toBe(true); // destroyed
    expect(isFree(medium, [tank], { x: 7, y: 9, w: 1, h: 1 }, new Set([tank]))).toBe(true);
    expect(isFree(medium, [tank, unit("infantry-1", 8, 9)], { x: 7, y: 9, w: 2, h: 1 }, new Set([tank]))).toBe(false);
  });

  it("tells units apart by object, so the enemy's unit of the same name still blocks", () => {
    // Both armies name their units tank-1, tank-2 and so on; `units` holds both sides together.
    const own = unit("tank-1", 10, 10);
    const theirs = unit("tank-1", 12, 10);
    expect(isFree(medium, [own, theirs], { x: 12, y: 10, w: 2, h: 2 }, new Set([own]))).toBe(false);
    expect(isFree(medium, [own, theirs], { x: 10, y: 10, w: 2, h: 2 }, new Set([own]))).toBe(true);
    expect(isFree(medium, [own, theirs], { x: 10, y: 10, w: 2, h: 2 }, new Set([theirs]))).toBe(false);
    const paths = reachable(medium, [own, theirs, unit("tank-2", 10, 12)], own);
    expect(paths.has("12,10")).toBe(false); // onto the enemy tank-1
    expect(paths.has("13,10")).toBe(false); // half onto it
    expect(paths.has("10,12")).toBe(false); // onto the enemy tank-2
    expect(paths.has("11,8")).toBe(true);
  });

  it("unitAtSquare finds the living unit standing on a square", () => {
    const units = [unit("tank-1", 6, 8), unit("wall-1", 9, 8, 1)];
    expect(unitAtSquare(units, 7, 9)?.id).toBe("tank-1");
    expect(unitAtSquare(units, 8, 9)).toBeUndefined();
    expect(unitAtSquare(units, 9, 8)).toBeUndefined(); // destroyed walls do not count
  });
});

describe("reachable", () => {
  const tank = unit("tank-1", 4, 8);

  it("gives a 2 x 2 tank every top-left within 3 steps on open ground, each with its path", () => {
    const paths = reachable(medium, [tank], tank);
    expect(paths.has("4,8")).toBe(false); // standing still is not a move
    expect(paths.get("5,8")).toEqual([{ x: 5, y: 8 }]);
    expect(paths.get("7,8")).toHaveLength(3);
    expect(paths.get("7,11")).toHaveLength(3);
    expect(paths.has("8,8")).toBe(false);
    expect(paths.size).toBe(7 * 7 - 1);
    for (const [k, path] of paths) {
      expect(key(path.at(-1)!)).toBe(k);
      let at = { x: tank.x, y: tank.y };
      for (const step of path) {
        expect(Math.max(Math.abs(step.x - at.x), Math.abs(step.y - at.y))).toBe(1);
        expect(isFree(medium, [tank], footprintAt(tank, step.x, step.y), new Set([tank]))).toBe(true);
        at = step;
      }
    }
  });

  it("a wall in the way blocks every footprint that would cover it and lengthens the way round", () => {
    const wall = unit("wall-1", 6, 9); // squares (6,9) and (7,9)
    const paths = reachable(medium, [tank, wall], tank);
    for (const k of ["5,8", "6,8", "7,8", "5,9", "6,9", "7,9", "5,10", "6,10"]) expect(paths.has(k), k).toBe(k === "5,10" || k === "6,10");
    expect(paths.get("7,7")).toHaveLength(3);
    expect(paths.get("7,7")?.at(-1)).toEqual({ x: 7, y: 7 });
    expect(paths.get("6,10")).toHaveLength(3); // down and round the wall
    expect(paths.has("7,10")).toBe(false); // four steps round the wall
    expect(reachable(medium, [tank, wall], tank, 4).has("7,10")).toBe(true);
  });

  it("never leaves the map or steps onto terrain, and a destroyed mover goes nowhere", () => {
    const edge = unit("tank-1", 0, 8);
    const paths = reachable(medium, [edge], edge);
    expect(paths.size).toBe(4 * 7 - 1);
    for (const p of paths.values()) {
      const to = p.at(-1)!;
      expect(to.x).toBeGreaterThanOrEqual(0);
      expect(insideMap(medium, footprintAt(edge, to.x, to.y))).toBe(true);
    }
    expect(paths.get("3,11")).toHaveLength(3);
    const byForest = unit("tank-1", 3, 6); // the forest above base 1 starts at (5,2)
    const near = reachable(medium, [byForest], byForest);
    expect(near.has("3,3")).toBe(true);
    expect(near.has("4,3")).toBe(false); // (5,3) is forest
    expect(near.has("5,4")).toBe(false); // (6,4) is forest
    expect(reachable(medium, [unit("tank-1", 4, 8, 3)], unit("tank-1", 4, 8, 3)).size).toBe(0);
    expect(reachable(medium, [tank], tank, 0).size).toBe(0);
  });

  it("an infantry walks one square and a truck five", () => {
    const foot = unit("infantry-1", 10, 8);
    expect(reachable(medium, [foot], foot).size).toBe(8);
    const truck = unit("truck-1", 20, 12);
    const paths = reachable(medium, [truck], truck);
    expect(paths.get("25,12")).toHaveLength(5);
    expect(paths.has("26,12")).toBe(false);
  });
});
