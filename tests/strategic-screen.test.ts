import { describe, expect, it } from "vitest";
import { confirmHandoff, createGame, finishBuild, randomLayout, type Game } from "../src/rules/index.ts";
import type { MapShot } from "../src/strategic/rules/index.ts";
import { mapOf, terrainSquares } from "../src/strategic/rules/index.ts";
import { clearLabelColumn } from "../src/strategic/ui/mapView.ts";
import { describeMove, describeShell, describeTankShot, moveTarget, orderLabel } from "../src/strategic/ui/screen.ts";

/** A game with a few units in known states, for the result lines that read hit points left. */
function gameWith(units: { owner: 0 | 1; id: string; type: "tank" | "fort" | "wall" | "infantry"; hits: number }[]): Game {
  const g = createGame({ seed: 1, mode: "strategic" });
  for (const u of units) g.players[u.owner].units.push({ id: u.id, type: u.type, x: 0, y: 0, upright: false, hits: u.hits });
  return g;
}

function ok(r: { ok: boolean; game?: Game; reason?: string }): Game {
  if (!r.ok) throw new Error(r.reason);
  return r.game as Game;
}

/** A two-player Strategic game with random bases, player 1 looking at their first turn. */
function inTurn(seed: number): Game {
  let g = createGame({ seed, mode: "strategic" });
  g = randomLayout(g, 0);
  g = ok(finishBuild(g, 0));
  g = ok(confirmHandoff(g));
  g = randomLayout(g, 1);
  g = ok(finishBuild(g, 1));
  return ok(confirmHandoff(g));
}

const shot = (over: Partial<MapShot>): MapShot => ({
  id: 1,
  by: 0,
  weapon: "shell",
  unitId: "artillery-1",
  aim: { x: 5, y: 5 },
  x: 5,
  y: 5,
  turn: 1,
  outcome: "miss",
  hits: [],
  revealed: true,
  ...over,
});

describe("moveTarget", () => {
  const tank = { type: "tank" as const, upright: false };
  const reach = [
    { x: 4, y: 4 },
    { x: 5, y: 4 },
    { x: 4, y: 5 },
    { x: 5, y: 5 },
    { x: 7, y: 2 },
  ];

  it("takes the tap's square as a top-left when that is reachable and nearest", () => {
    expect(moveTarget(tank, reach, { x: 7.5, y: 2.5 })).toEqual({ x: 7, y: 2 });
  });

  it("picks the reachable top-left whose footprint holds the tap and whose centre is nearest it", () => {
    // Square (5,5) is covered by footprints at (4,4), (5,4), (4,5) and (5,5); the finger is near (4,4)'s centre.
    expect(moveTarget(tank, reach, { x: 5.2, y: 5.2 })).toEqual({ x: 4, y: 4 });
    expect(moveTarget(tank, reach, { x: 5.9, y: 5.9 })).toEqual({ x: 5, y: 5 });
    // Square (6,4) is covered only by the footprint at (5,4).
    expect(moveTarget(tank, reach, { x: 6.5, y: 4.5 })).toEqual({ x: 5, y: 4 });
  });

  it("is null off the reachable ground", () => {
    expect(moveTarget(tank, reach, { x: 10, y: 10 })).toBeNull();
    expect(moveTarget(tank, [], { x: 4.5, y: 4.5 })).toBeNull();
  });
});

describe("result lines", () => {
  it("names the tank's target and its hit points left", () => {
    const g = gameWith([{ owner: 1, id: "tank-1", type: "tank", hits: 2 }]);
    const s = shot({ weapon: "tank", outcome: "hit", hits: [{ unitId: "tank-1", owner: 1, type: "tank", damage: 2, destroyed: false, seen: true }] });
    expect(describeTankShot(s, g)).toBe("Hit enemy tank: 1 of 3 left");
    const w = shot({ weapon: "tank", outcome: "wall", hits: [{ unitId: "wall-1", owner: 1, type: "wall", damage: 1, destroyed: true, seen: true }] });
    expect(describeTankShot(w, g)).toBe("Destroyed enemy wall");
  });

  it("says nothing about a shell whose landing the shooter could not see, unless it clipped a unit in sight", () => {
    const g = inTurn(3);
    const blind = shot({ revealed: false, outcome: "hit", hits: [{ unitId: "infantry-2", owner: 1, type: "infantry", damage: 1, destroyed: true, seen: false }] });
    expect(describeShell(blind, g, 0)).toBe("Shell landed. Nothing in sight there.");
    const seen = shot({ revealed: false, outcome: "hit", hits: [{ unitId: "infantry-1", owner: 1, type: "infantry", damage: 1, destroyed: true, seen: true }] });
    expect(describeShell(seen, g, 0)).toBe("Shell destroyed enemy infantry");
    // A watched landing whose smudge reached a unit in the fog reads like a miss: the fog keeps its secret.
    const clipped = shot({ revealed: true, outcome: "hit", hits: [{ unitId: "fort-1", owner: 1, type: "fort", damage: 3, destroyed: false, seen: false }] });
    expect(describeShell(clipped, g, 0)).toBe("Shell missed");
  });

  it("describes a seen shell: a miss, a wall, one unit or several, and owns up to friendly fire", () => {
    const g = gameWith([
      { owner: 1, id: "fort-1", type: "fort", hits: 3 },
      { owner: 0, id: "tank-1", type: "tank", hits: 3 },
      { owner: 1, id: "infantry-1", type: "infantry", hits: 1 },
    ]);
    expect(describeShell(shot({ outcome: "miss" }), g, 0)).toBe("Shell missed");
    expect(
      describeShell(shot({ outcome: "wall", hits: [{ unitId: "wall-1", owner: 1, type: "wall", damage: 1, destroyed: true, seen: true }] }), g, 0),
    ).toBe("Shell blocked by a wall");
    const fort = shot({ outcome: "hit", hits: [{ unitId: "fort-1", owner: 1, type: "fort", damage: 3, destroyed: false, seen: true }] });
    expect(describeShell(fort, g, 0)).toBe("Shell hit enemy fort: 3 of 6 left");
    const own = shot({ outcome: "hit", hits: [{ unitId: "tank-1", owner: 0, type: "tank", damage: 3, destroyed: true, seen: true }] });
    expect(describeShell(own, g, 0)).toBe("Shell destroyed your tank");
    const many = shot({
      outcome: "hit",
      hits: [
        { unitId: "fort-1", owner: 1, type: "fort", damage: 3, destroyed: false, seen: true },
        { unitId: "infantry-1", owner: 1, type: "infantry", damage: 1, destroyed: true, seen: true },
        { unitId: "tank-1", owner: 0, type: "tank", damage: 3, destroyed: true, seen: true },
      ],
    });
    expect(describeShell(many, g, 0)).toBe("Shell hit: 3 units (2 destroyed, 1 yours)");
  });

  it("reads a move and an order row's label plainly", () => {
    expect(describeMove("Tank 1", 0)).toBe("Tank 1 moved");
    expect(describeMove("Truck 1", 1)).toBe("Truck 1 moved with 1 rider");
    expect(describeMove("Truck 1", 3)).toBe("Truck 1 moved with 3 riders");
    // Stopped beside an enemy that was hidden in the fog (now in sight).
    expect(describeMove("Tank 1", 0, true)).toBe("Tank 1 stopped: enemy in the way");
    expect(describeMove("Truck 1", 2, true)).toBe("Truck 1 stopped with 2 riders: enemy in the way");
    expect(orderLabel("tank-2", "tank")).toBe("Tank 2");
    expect(orderLabel("artillery-1", "artillery")).toBe("Artillery 1");
  });
});

describe("half labels", () => {
  const map = { w: 20 };
  const right = { from: 10, to: 20 };

  it("sit at the middle of their half when the top rows there are clear", () => {
    expect(clearLabelColumn(map, new Set(), 15, 4, right)).toBe(15);
  });

  it("step aside from terrain in the top two rows, to the nearest clear column inside the half", () => {
    // A wood on squares 14 and 15 of row 1: a label 4 wide must start at 16 or end by 14.
    const wood = new Set([1 * 20 + 14, 1 * 20 + 15]);
    expect(clearLabelColumn(map, wood, 15, 4, right)).toBe(18);
    // Terrain lower down does not matter.
    expect(clearLabelColumn(map, new Set([2 * 20 + 15]), 15, 4, right)).toBe(15);
  });

  it("stay put when nothing in the half is clear", () => {
    const row0 = new Set(Array.from({ length: 10 }, (_, k) => 10 + k));
    expect(clearLabelColumn(map, row0, 15, 4, right)).toBe(15);
  });

  it("keep clear of every Large map's terrain in both halves", () => {
    for (const id of ["large-1", "large-2", "large-3"]) {
      const m = mapOf(id);
      const terrain = terrainSquares(m);
      for (const half of [{ from: 0, to: m.w / 2 }, { from: m.w / 2, to: m.w }]) {
        const span = 5;
        const x = clearLabelColumn(m, terrain, (half.from + half.to) / 2, span, half);
        for (let y = 0; y < 2; y++)
          for (let c = Math.floor(x - span / 2); c < Math.ceil(x + span / 2); c++) expect(terrain.has(y * m.w + c), `${id} ${c},${y}`).toBe(false);
      }
    }
  });
});
