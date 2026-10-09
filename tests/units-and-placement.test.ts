import { describe, expect, it } from "vitest";
import {
  ARMY,
  ARMY_SLOTS,
  FOOTPRINT,
  createGame,
  finishBuild,
  isArmyComplete,
  placeUnit,
  placementProblem,
  rectOf,
  removeUnit,
  snapWall,
  unitsLeft,
  type Unit,
} from "../src/rules/index.ts";
import { LAYOUT_A, placeAll } from "./helpers.ts";

const unit = (id: string, type: Unit["type"], x: number, y: number, upright = false): Unit => ({
  id,
  type,
  x,
  y,
  upright,
  hits: 0,
});

describe("the army", () => {
  it("is 17 units: 1 fort, 3 tanks, 3 artillery, 6 infantry, 4 walls", () => {
    expect(ARMY_SLOTS).toHaveLength(17);
    expect(ARMY).toEqual({ fort: 1, tank: 3, artillery: 3, infantry: 6, wall: 4 });
  });

  it("covers 47 of the 200 squares", () => {
    const area = ARMY_SLOTS.reduce((n, s) => n + FOOTPRINT[s.type].w * FOOTPRINT[s.type].h, 0);
    expect(area).toBe(47);
  });

  it("has sizes of fort 3x3, tank and artillery 2x2, wall 2x1, infantry 1x1", () => {
    expect(FOOTPRINT.fort).toEqual({ w: 3, h: 3 });
    expect(FOOTPRINT.tank).toEqual({ w: 2, h: 2 });
    expect(FOOTPRINT.artillery).toEqual({ w: 2, h: 2 });
    expect(FOOTPRINT.wall).toEqual({ w: 2, h: 1 });
    expect(FOOTPRINT.infantry).toEqual({ w: 1, h: 1 });
  });

  it("starts with 13 fighting units (walls do not count)", () => {
    const left = unitsLeft(placeAll(createGame({ seed: 1 }), 0, LAYOUT_A).players[0].units);
    expect(left.total).toBe(13);
    expect(left.wallsLeft).toBe(4);
  });
});

describe("placement", () => {
  it("accepts the hand-made layout", () => {
    const g = placeAll(createGame({ seed: 1 }), 0, LAYOUT_A);
    expect(isArmyComplete(g.players[0].units)).toBe(true);
  });

  it("rejects units outside the 20 x 10 grid", () => {
    expect(placementProblem([], { type: "infantry", x: 20, y: 0, upright: false })).toBe("out_of_bounds");
    expect(placementProblem([], { type: "infantry", x: -1, y: 0, upright: false })).toBe("out_of_bounds");
    expect(placementProblem([], { type: "tank", x: 0, y: 9, upright: false })).toBe("out_of_bounds");
    expect(placementProblem([], { type: "fort", x: 18, y: 0, upright: false })).toBe("out_of_bounds");
    expect(placementProblem([], { type: "tank", x: 18, y: 8, upright: false })).toBeNull();
  });

  it("rejects overlapping units but allows touching ones", () => {
    const others = [unit("tank-1", "tank", 4, 4)];
    expect(placementProblem(others, { type: "infantry", x: 5, y: 5, upright: false })).toBe("overlap");
    expect(placementProblem(others, { type: "infantry", x: 6, y: 4, upright: false })).toBeNull();
    expect(placementProblem(others, { type: "infantry", x: 4, y: 6, upright: false })).toBeNull();
  });

  it("lets only walls stand upright, and only flush against the fort's left or right side", () => {
    const fort = [unit("fort-1", "fort", 8, 3)];
    expect(placementProblem(fort, { type: "wall", x: 7, y: 3, upright: true })).toBeNull();
    expect(placementProblem(fort, { type: "wall", x: 11, y: 5, upright: true })).toBeNull();
    expect(placementProblem(fort, { type: "wall", x: 6, y: 3, upright: true })).toBe("upright_not_beside_fort");
    expect(placementProblem(fort, { type: "wall", x: 7, y: 6, upright: true })).toBe("upright_not_beside_fort");
    expect(placementProblem([], { type: "wall", x: 2, y: 2, upright: true })).toBe("upright_not_beside_fort");
    expect(placementProblem(fort, { type: "tank", x: 0, y: 0, upright: true })).toBe("upright_only_for_walls");
  });

  it("lets a flat wall go anywhere free", () => {
    expect(placementProblem([], { type: "wall", x: 2, y: 2, upright: false })).toBeNull();
  });

  it("upright walls are 1 wide and 2 deep", () => {
    expect(rectOf({ type: "wall", x: 7, y: 3, upright: true })).toEqual({ x: 7, y: 3, w: 1, h: 2 });
    expect(rectOf({ type: "wall", x: 7, y: 3, upright: false })).toEqual({ x: 7, y: 3, w: 2, h: 1 });
  });

  it("moves a unit that is placed again instead of duplicating it", () => {
    let g = createGame({ seed: 1 });
    const a = placeUnit(g, 0, "tank-1", 0, 0);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = placeUnit(a.game, 0, "tank-1", 5, 5);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    g = b.game;
    expect(g.players[0].units).toHaveLength(1);
    expect(g.players[0].units[0]).toMatchObject({ x: 5, y: 5 });
  });

  it("does not collide a unit with its own old spot when nudged", () => {
    const g0 = placeAll(createGame({ seed: 1 }), 0, [{ id: "tank-1", x: 4, y: 4 }]);
    expect(placeUnit(g0, 0, "tank-1", 5, 4).ok).toBe(true);
  });

  it("removes a unit", () => {
    const g0 = placeAll(createGame({ seed: 1 }), 0, [{ id: "tank-1", x: 4, y: 4 }]);
    const r = removeUnit(g0, 0, "tank-1");
    expect(r.ok && r.game.players[0].units).toEqual([]);
  });

  it("rejects unknown units and the wrong player", () => {
    const g = createGame({ seed: 1 });
    expect(placeUnit(g, 0, "dragon-1", 0, 0)).toEqual({ ok: false, reason: "unknown_unit" });
    expect(placeUnit(g, 1, "tank-1", 0, 0)).toEqual({ ok: false, reason: "wrong_phase" });
  });

  it("only lets Done work once all 17 units are placed", () => {
    const partial = placeAll(createGame({ seed: 1 }), 0, LAYOUT_A.slice(0, 16));
    expect(finishBuild(partial, 0)).toEqual({ ok: false, reason: "army_incomplete" });
    const full = placeAll(createGame({ seed: 1 }), 0, LAYOUT_A);
    expect(finishBuild(full, 0).ok).toBe(true);
  });
});

describe("wall snapping", () => {
  const fort = { x: 8, y: 3 };

  it("snaps left and right drops to an upright wall flush against the fort", () => {
    expect(snapWall(fort, 6.5, 4.5)).toMatchObject({ x: 7, upright: true });
    expect(snapWall(fort, 12.5, 4.5)).toMatchObject({ x: 11, upright: true });
  });

  it("snaps top and bottom drops to a flat wall", () => {
    expect(snapWall(fort, 9.5, 1.5)).toMatchObject({ y: 2, upright: false });
    expect(snapWall(fort, 9.5, 7.5)).toMatchObject({ y: 6, upright: false });
  });

  it("lines up with the end of the side nearer to the drop", () => {
    expect(snapWall(fort, 8.2, 1.5)).toMatchObject({ x: 8, y: 2 }); // left end
    expect(snapWall(fort, 10.8, 1.5)).toMatchObject({ x: 9, y: 2 }); // right end
    expect(snapWall(fort, 6.5, 3.2)).toMatchObject({ x: 7, y: 3 }); // upper end
    expect(snapWall(fort, 6.5, 5.8)).toMatchObject({ x: 7, y: 4 }); // lower end
  });

  it("does not snap when the drop is far from the fort", () => {
    expect(snapWall(fort, 2, 4)).toBeNull();
    expect(snapWall(fort, 9.5, 9.5)).toBeNull();
  });

  it("produces placements the rules accept, so four walls can surround the fort", () => {
    const base = [unit("fort-1", "fort", 8, 3)];
    const drops: [number, number][] = [
      [6.5, 3.2],
      [12.5, 5.8],
      [8.2, 1.5],
      [10.8, 7.5],
    ];
    const walls: Unit[] = [];
    drops.forEach(([px, py], i) => {
      const c = snapWall(fort, px, py)!;
      expect(placementProblem([...base, ...walls], c)).toBeNull();
      walls.push({ id: `wall-${i + 1}`, ...c, hits: 0 });
    });
    expect(walls).toHaveLength(4);
  });
});
