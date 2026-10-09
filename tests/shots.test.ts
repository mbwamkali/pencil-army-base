import { describe, expect, it } from "vitest";
import { SHOT_DIAMETER, resolveShot, unitsLeft, unitState, type Unit } from "../src/rules/index.ts";
import { LAYOUT_A, centreOf, placeAll } from "./helpers.ts";
import { createGame } from "../src/rules/index.ts";

const u = (id: string, type: Unit["type"], x: number, y: number, upright = false, hits = 0): Unit => ({
  id,
  type,
  x,
  y,
  upright,
  hits,
});
const byId = (units: Unit[], id: string) => units.find((x) => x.id === id)!;

describe("shots", () => {
  it("is a circle about 1.75 squares across", () => {
    expect(SHOT_DIAMETER).toBe(1.75);
  });

  it("misses empty ground and records where it landed", () => {
    const { units, result } = resolveShot([u("infantry-1", "infantry", 3, 3)], 10, 8, 1);
    expect(result).toMatchObject({ outcome: "miss", x: 10, y: 8, turn: 1, hits: [] });
    expect(unitState(byId(units, "infantry-1"))).toBe("normal");
  });

  it("lands exactly where tapped, with no snapping to squares", () => {
    expect(resolveShot([], 7.123, 2.456, 1).result).toMatchObject({ x: 7.123, y: 2.456 });
  });

  it("destroys an infantry unit the circle overlaps", () => {
    const { units, result } = resolveShot([u("infantry-1", "infantry", 3, 3)], 3.5, 3.5, 1);
    expect(result.outcome).toBe("destroyed");
    expect(result.destroyed).toEqual(["infantry-1"]);
    expect(unitState(byId(units, "infantry-1"))).toBe("destroyed");
  });

  it("hits when the circle edge reaches a unit and misses just beyond", () => {
    const inf = [u("infantry-1", "infantry", 3, 4)]; // occupies x 3-4, y 4-5
    expect(resolveShot(inf, 4.8, 4.5, 1).result.outcome).toBe("destroyed"); // 0.8 from the edge
    expect(resolveShot(inf, 4.9, 4.5, 1).result.outcome).toBe("miss"); // 0.9 from the edge
  });

  it("measures to the corner, not the bounding box", () => {
    const inf = [u("infantry-1", "infantry", 3, 3)];
    // 0.6 right and 0.6 below the corner (4,4): distance 0.85 -> hit; 0.65 each -> 0.92 -> miss
    expect(resolveShot(inf, 4.6, 4.6, 1).result.outcome).toBe("destroyed");
    expect(resolveShot(inf, 4.65, 4.65, 1).result.outcome).toBe("miss");
  });

  it("reaches tanks, artillery and the fort", () => {
    const army = [u("tank-1", "tank", 0, 0), u("artillery-1", "artillery", 5, 0), u("fort-1", "fort", 10, 0)];
    expect(resolveShot(army, 1, 1, 1).result.destroyed).toEqual(["tank-1"]);
    expect(resolveShot(army, 6, 1, 1).result.destroyed).toEqual(["artillery-1"]);
    expect(resolveShot(army, 11.5, 1.5, 1).result.damaged).toEqual(["fort-1"]);
  });

  it("can hit several units with one shot", () => {
    const pair = [u("infantry-1", "infantry", 3, 3), u("infantry-2", "infantry", 4, 3), u("infantry-3", "infantry", 9, 9)];
    const { result } = resolveShot(pair, 4, 3.5, 1);
    expect(result.destroyed.sort()).toEqual(["infantry-1", "infantry-2"]);
    expect(result.hits).toHaveLength(2);
  });

  it("takes two hits to destroy the fort, which is damaged after the first", () => {
    const fort = [u("fort-1", "fort", 8, 3)];
    const one = resolveShot(fort, 9.5, 4.5, 1);
    expect(one.result.outcome).toBe("damaged");
    expect(one.result.hits[0]).toMatchObject({ before: "normal", after: "damaged" });
    expect(unitsLeft(one.units).total).toBe(1);
    expect(unitsLeft(one.units).fortDamaged).toBe(true);
    const two = resolveShot(one.units, 9.5, 4.5, 2);
    expect(two.result.outcome).toBe("destroyed");
    expect(two.result.hits[0]).toMatchObject({ before: "damaged", after: "destroyed" });
    expect(unitsLeft(two.units).total).toBe(0);
  });

  it("ignores units that are already destroyed", () => {
    const first = resolveShot([u("tank-1", "tank", 0, 0)], 1, 1, 1);
    const again = resolveShot(first.units, 1, 1, 2);
    expect(again.result.outcome).toBe("miss");
    expect(byId(again.units, "tank-1").hits).toBe(1);
  });

  it("does not change the units it was given", () => {
    const before = [u("tank-1", "tank", 0, 0)];
    resolveShot(before, 1, 1, 1);
    expect(before[0]!.hits).toBe(0);
  });

  it("keeps shots on the grid", () => {
    expect(resolveShot([], -3, 14, 1).result).toMatchObject({ x: 0, y: 10 });
  });
});

describe("walls absorb the blow", () => {
  const wallAndTank = () => [u("wall-1", "wall", 4, 4), u("tank-1", "tank", 4, 5)];

  it("destroys the wall and leaves other units under the shot untouched", () => {
    const { units, result } = resolveShot(wallAndTank(), 5, 5, 1);
    expect(result.outcome).toBe("wall");
    expect(result.destroyed).toEqual(["wall-1"]);
    expect(result.hits.map((h) => h.unitId)).toEqual(["wall-1"]);
    expect(unitState(byId(units, "tank-1"))).toBe("normal");
  });

  it("no longer protects once the wall is destroyed", () => {
    const first = resolveShot(wallAndTank(), 5, 5, 1);
    const second = resolveShot(first.units, 5, 5, 2);
    expect(second.result.outcome).toBe("destroyed");
    expect(second.result.destroyed).toEqual(["tank-1"]);
  });

  it("destroys every wall the shot touches", () => {
    const walls = [u("wall-1", "wall", 4, 4), u("wall-2", "wall", 4, 5), u("tank-1", "tank", 6, 4)];
    const { result } = resolveShot(walls, 5, 5, 1);
    expect(result.destroyed.sort()).toEqual(["wall-1", "wall-2"]);
  });

  it("an upright wall is hit as a tall thin rectangle", () => {
    const upright = [u("wall-1", "wall", 5, 2, true)]; // x 5-6, y 2-4
    expect(resolveShot(upright, 5.5, 4.8, 1).result.outcome).toBe("wall"); // 0.8 below its lower end
    const flat = [u("wall-1", "wall", 5, 2, false)]; // x 5-7, y 2-3
    expect(resolveShot(flat, 5.5, 4.8, 1).result.outcome).toBe("miss"); // 1.8 below a flat wall
  });
});

describe("the fort and its walls (LAYOUT_A)", () => {
  const base = () => placeAll(createGame({ seed: 1 }), 0, LAYOUT_A).players[0].units;

  it("a precise sniper shot at the fort's middle bypasses all four walls", () => {
    const c = centreOf(LAYOUT_A, "fort-1");
    const { units, result } = resolveShot(base(), c.x, c.y, 1);
    expect(result.outcome).toBe("damaged");
    expect(result.damaged).toEqual(["fort-1"]);
    for (const id of ["wall-1", "wall-2", "wall-3", "wall-4"]) expect(unitState(byId(units, id))).toBe("normal");
  });

  it("a shot near the fort's edge hits the wall instead, and the fort is safe", () => {
    const { units, result } = resolveShot(base(), 8.2, 4.5, 1);
    expect(result.outcome).toBe("wall");
    expect(result.destroyed).toEqual(["wall-1"]);
    expect(unitState(byId(units, "fort-1"))).toBe("normal");
  });
});
