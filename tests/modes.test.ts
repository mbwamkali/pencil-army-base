import { describe, expect, it } from "vitest";
import {
  MODES,
  MODE_IDS,
  clearUnits,
  coreCount,
  coreLeft,
  pointsByType,
  POINTS,
  Rng,
  confirmHandoff,
  createGame,
  endTurn,
  finishBuild,
  fire,
  isArmyComplete,
  modeOf,
  placeUnit,
  randomLayout,
  randomUnits,
  scoreOf,
  unitsLeft,
  type Game,
  type ModeId,
} from "../src/rules/index.ts";
import { LAYOUT_A, centreOf, placeAll } from "./helpers.ts";
import type { Placement } from "../src/rules/index.ts";

/** A hand-made Skirmish army on the 12 x 6 board. */
const SKIRMISH: Placement[] = [
  { id: "fort-1", x: 0, y: 0 },
  { id: "tank-1", x: 4, y: 0 },
  { id: "artillery-1", x: 6, y: 0 },
  { id: "infantry-1", x: 8, y: 0 },
  { id: "infantry-2", x: 10, y: 0 },
  { id: "wall-1", x: 0, y: 4 },
  { id: "wall-2", x: 3, y: 4 },
];
/** An empty spot on both hand-made layouts. */
const MISS = { x: 11.2, y: 5.4 };
const MISS_FULL = { x: 5.5, y: 5.5 };

/** The full army with the walls moved into corners, so every shot lands on what it aims at. */
const FREE: Placement[] = LAYOUT_A.map((p) => {
  const wall: Record<string, [number, number]> = { "wall-1": [0, 3], "wall-2": [0, 5], "wall-3": [18, 8], "wall-4": [18, 6] };
  const w = wall[p.id];
  return w ? { id: p.id, x: w[0], y: w[1] } : p;
});

function ok(r: { ok: boolean; game?: Game; reason?: string }): Game {
  if (!r.ok) throw new Error(r.reason);
  return r.game!;
}

function battle(mode: ModeId, layout: Placement[]): Game {
  let g = createGame({ seed: 5, mode });
  g = placeAll(g, 0, layout);
  g = ok(finishBuild(g, 0));
  g = ok(confirmHandoff(g));
  g = placeAll(g, 1, layout);
  g = ok(finishBuild(g, 1));
  return ok(confirmHandoff(g));
}

/** Fire, then pass the phone on unless the game just ended. */
function shoot(g: Game, x: number, y: number): Game {
  const f = ok(fire(g, x, y));
  if (f.phase === "over") return f;
  return ok(confirmHandoff(ok(endTurn(f))));
}

describe("mode presets", () => {
  it("has the four modes, with Skirmish smaller and the others the full army", () => {
    expect(MODE_IDS).toEqual(["skirmish", "battle", "score"]);
    expect(MODES.skirmish.army).toEqual({ fort: 1, tank: 1, artillery: 1, infantry: 2, wall: 2 });
    expect(MODES.skirmish.grid).toEqual({ w: 12, h: 6 });
    for (const id of ["battle", "score"] as const) {
      expect(MODES[id].grid).toEqual({ w: 20, h: 10 });
      expect(MODES[id].army.tank).toBe(3);
    }
    expect(MODES.score.shotsEach).toBe(20);
  });

  it("keeps the same board shape so the drawing scales cleanly", () => {
    expect(MODES.skirmish.grid.w / MODES.skirmish.grid.h).toBe(MODES.battle.grid.w / MODES.battle.grid.h);
  });

  it("treats a game saved before modes existed as Battle", () => {
    expect(modeOf(undefined).id).toBe("battle");
    expect(createGame({ seed: 1 }).mode).toBe("battle");
  });

  it("scores infantry 1, tank and artillery 3, fort 5 and walls 0", () => {
    expect(POINTS).toEqual({ infantry: 1, tank: 3, artillery: 3, fort: 5, wall: 0 });
  });
});

describe("Skirmish setup", () => {
  it("accepts the hand-made army and finishes a build only when all 7 units are down", () => {
    let g = createGame({ seed: 2, mode: "skirmish" });
    g = placeAll(g, 0, SKIRMISH.slice(0, 6));
    expect(finishBuild(g, 0)).toEqual({ ok: false, reason: "army_incomplete" });
    g = placeAll(g, 0, SKIRMISH.slice(6));
    expect(isArmyComplete(g.players[0].units, MODES.skirmish)).toBe(true);
    expect(finishBuild(g, 0).ok).toBe(true);
  });

  it("uses the small board for bounds and the small army for unit ids", () => {
    const g = createGame({ seed: 2, mode: "skirmish" });
    expect(placeUnit(g, 0, "infantry-1", 12, 0)).toEqual({ ok: false, reason: "out_of_bounds" });
    expect(placeUnit(g, 0, "infantry-1", 0, 6)).toEqual({ ok: false, reason: "out_of_bounds" });
    expect(placeUnit(g, 0, "infantry-1", 11, 5).ok).toBe(true);
    expect(placeUnit(g, 0, "tank-2", 4, 4)).toEqual({ ok: false, reason: "unknown_unit" });
    expect(placeUnit(g, 0, "infantry-3", 4, 4)).toEqual({ ok: false, reason: "unknown_unit" });
  });

  it("builds a valid random Skirmish army every time", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const units = randomUnits(new Rng(seed), MODES.skirmish);
      expect(units).toHaveLength(7);
      expect(isArmyComplete(units, MODES.skirmish)).toBe(true);
      for (const u of units) expect(u.x + (u.type === "fort" ? 3 : u.type === "infantry" ? 1 : 2)).toBeLessThanOrEqual(12 + 1);
    }
    let g = createGame({ seed: 4, mode: "skirmish" });
    g = randomLayout(g, 0);
    expect(g.players[0].units).toHaveLength(7);
  });

  it("clamps shots to the small board", () => {
    const g = battle("skirmish", SKIRMISH);
    const f = ok(fire(g, 50, 50));
    expect(f.players[g.current].shots[0]).toMatchObject({ x: 12, y: 6 });
  });
});

describe("win rules", () => {
  it("Skirmish ends when the fort, tank and artillery are destroyed, even with infantry standing", () => {
    let g = battle("skirmish", SKIRMISH);
    const shooter = g.current;
    g = shoot(g, 5, 1); // tank
    g = shoot(g, MISS.x, MISS.y);
    g = shoot(g, 7, 1); // artillery
    g = shoot(g, MISS.x, MISS.y);
    g = shoot(g, 1.5, 1.5); // fort, first hit
    g = shoot(g, MISS.x, MISS.y);
    expect(g.phase).toBe("turn");
    g = ok(fire(g, 1.5, 1.5)); // fort, second hit
    expect(g.phase).toBe("over");
    expect(g.winner).toBe(shooter);
    expect(unitsLeft(g.players[shooter === 0 ? 1 : 0].units).byType.infantry).toBe(2);
  });

  const coreIds = ["tank-1", "tank-2", "tank-3", "artillery-1", "artillery-2", "artillery-3"];
  const infantryIds = ["infantry-1", "infantry-2", "infantry-3", "infantry-4", "infantry-5", "infantry-6"];
  const at = (id: string) => centreOf(FREE, id);

  function destroyCore(mode: ModeId): Game {
    let g = battle(mode, FREE);
    for (const id of coreIds) {
      g = shoot(g, at(id).x, at(id).y);
      g = shoot(g, MISS_FULL.x, MISS_FULL.y);
    }
    g = shoot(g, at("fort-1").x, at("fort-1").y);
    g = shoot(g, MISS_FULL.x, MISS_FULL.y);
    return g;
  }

  it("Battle ends the same way: infantry are optional", () => {
    const shooter = battle("battle", FREE).current;
    let g = destroyCore("battle");
    expect(g.phase).toBe("turn");
    g = ok(fire(g, at("fort-1").x, at("fort-1").y));
    expect(g.phase).toBe("over");
    expect(g.winner).toBe(shooter);
    expect(unitsLeft(g.players[shooter === 0 ? 1 : 0].units).byType.infantry).toBe(6);
  });
});

describe("points", () => {
  it("adds up points for each hit and nothing for walls", () => {
    let g = battle("skirmish", SKIRMISH);
    const a = g.current;
    g = shoot(g, 9, 0.5); // infantry-1 at x 8, +1
    g = shoot(g, MISS.x, MISS.y);
    g = shoot(g, 5, 1); // tank, +3
    g = shoot(g, MISS.x, MISS.y);
    g = shoot(g, 1.5, 1.5); // fort first hit, +5
    expect(scoreOf(g.players[a])).toBe(9);
    g = shoot(g, MISS.x, MISS.y);
    g = shoot(g, 1.5, 1.5); // fort second hit, +5 more
    expect(scoreOf(g.players[a])).toBe(14);
    g = shoot(g, MISS.x, MISS.y);
    g = shoot(g, 0.5, 4.5); // wall-1 absorbs the blow, +0
    expect(scoreOf(g.players[a])).toBe(14);
  });
});

describe("Score attack", () => {
  it("lasts 20 shots each, then the higher score wins", () => {
    let g = battle("score", LAYOUT_A);
    const a = g.current;
    const b = a === 0 ? 1 : 0;
    // First shooter takes an infantry (+1), everything else misses.
    g = shoot(g, centreOf(LAYOUT_A, "infantry-1").x, centreOf(LAYOUT_A, "infantry-1").y);
    g = shoot(g, MISS_FULL.x, MISS_FULL.y);
    for (let i = 2; i <= 19; i++) {
      g = shoot(g, MISS_FULL.x, MISS_FULL.y);
      g = shoot(g, MISS_FULL.x, MISS_FULL.y);
    }
    expect(g.phase).toBe("turn");
    expect(g.players[a].shots).toHaveLength(19);
    g = shoot(g, MISS_FULL.x, MISS_FULL.y); // a's 20th: the game waits for b's 20th
    expect(g.phase).toBe("turn");
    g = ok(fire(g, MISS_FULL.x, MISS_FULL.y)); // b's 20th
    expect(g.phase).toBe("over");
    expect(scoreOf(g.players[a])).toBe(1);
    expect(scoreOf(g.players[b])).toBe(0);
    expect(g.winner).toBe(a);
  });

  it("is a tie (no winner) when the scores match", () => {
    let g = battle("score", LAYOUT_A);
    for (let i = 0; i < 19; i++) {
      g = shoot(g, MISS_FULL.x, MISS_FULL.y);
      g = shoot(g, MISS_FULL.x, MISS_FULL.y);
    }
    g = shoot(g, MISS_FULL.x, MISS_FULL.y);
    g = ok(fire(g, MISS_FULL.x, MISS_FULL.y));
    expect(g.phase).toBe("over");
    expect(g.winner).toBeNull();
  });

  it("ends early, after a full round, when an army is wiped out", () => {
    let g = battle("score", FREE);
    const a = g.current;
    const b = a === 0 ? 1 : 0;
    const ids = ["tank-1", "tank-2", "tank-3", "artillery-1", "artillery-2", "artillery-3", "infantry-1", "infantry-2", "infantry-3", "infantry-4", "infantry-5", "infantry-6", "fort-1"];
    for (const id of ids) {
      g = shoot(g, centreOf(FREE, id).x, centreOf(FREE, id).y);
      g = shoot(g, MISS_FULL.x, MISS_FULL.y);
    }
    expect(g.phase).toBe("turn"); // the fort still has one hit left
    g = shoot(g, centreOf(FREE, "fort-1").x, centreOf(FREE, "fort-1").y);
    expect(g.phase).toBe("turn"); // a's army-wiping shot is in, but b has not had the same number of shots
    g = ok(fire(g, MISS_FULL.x, MISS_FULL.y));
    expect(g.phase).toBe("over");
    expect(g.winner).toBe(a);
    expect(scoreOf(g.players[a])).toBe(3 * 3 + 3 * 3 + 6 + 10);
    expect(scoreOf(g.players[b])).toBe(0);
  });
});

describe("counters, clearing and summary helpers", () => {
  it("counts the core left to destroy, apart from infantry", () => {
    const g = battle("battle", FREE);
    const units = g.players[0].units;
    expect(coreLeft(units)).toBe(7);
    expect(coreCount(MODES.battle)).toBe(7);
    expect(coreCount(MODES.skirmish)).toBe(3);
    expect(unitsLeft(units).byType.infantry).toBe(6);
  });

  it("clears every unit during the build phase only", () => {
    const g = createGame({ seed: 1, mode: "skirmish" });
    const placed = ok(placeUnit(g, g.building, "fort-1", 4, 2, false));
    expect(placed.players[g.building].units).toHaveLength(1);
    const cleared = ok(clearUnits(placed, g.building));
    expect(cleared.players[g.building].units).toHaveLength(0);
    expect(clearUnits(placed, g.building === 0 ? 1 : 0)).toEqual({ ok: false, reason: "wrong_phase" });
  });
});

describe("points by unit type", () => {
  it("adds up each type's hits and points, and they sum to the score", () => {
    const g = battle("skirmish", SKIRMISH);
    const a = g.current;
    const f = shoot(g, 5, 1); // the tank
    const by = pointsByType(f.players[a]);
    expect(by.tank).toEqual({ hits: 1, points: 3 });
    expect(by.fort.hits + by.tank.hits + by.artillery.hits + by.infantry.hits + by.wall.hits).toBeGreaterThan(0);
    const total = Object.values(by).reduce((n, v) => n + v.points, 0);
    expect(total).toBe(scoreOf(f.players[a]));
  });
});
