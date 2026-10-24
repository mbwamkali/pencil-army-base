import { describe, expect, it } from "vitest";
import {
  Rng,
  SHOT_RADIUS,
  circleHitsRect,
  confirmHandoff,
  hitRectOf,
  rectOf,
  rectsOverlap,
  typeOfId,
  type Game,
  type Unit,
} from "../src/rules/index.ts";
import { gameInBattle } from "./helpers.ts";
import {
  ARTILLERY_MIN_RANGE,
  BASE_GRID,
  SHAKE_MAX,
  SHAKE_RADIUS,
  SHAKE_PER_SQUARE,
  aimProblem,
  distanceToRect,
  decodeExplored,
  dropPoint,
  encodeExplored,
  endStrategicTurn,
  fireArtillery,
  fireTank,
  hpLeft,
  isAlive,
  key,
  shakeFor,
  shakeRadius,
  landShell,
  lookAround,
  moveUnit,
  reachableFor,
  ridersFor,
  squaresOfRect,
  stateOf,
  tankTargets,
  visibleSquares,
  type Point,
} from "../src/strategic/rules/index.ts";
import { builtOnMedium, medium, ok } from "./strategic-fixtures.ts";

const failed = (reason: string) => ({ ok: false, reason });

/** A unit from its id ("tank-2" is a tank) at a top-left square. */
const unit = (id: string, x: number, y: number, hits = 0, upright = false): Unit => ({ id, type: typeOfId(id) as Unit["type"], x, y, upright, hits });

/**
 * A Strategic game on Medium 1 with the stage 3 base spots ((2,7) and (26,7)) and player 1 about to
 * play turn 1, stepped into the turn by hand so these tests do not depend on the automatic infantry
 * phase.
 */
function turnGame(seed = 1): Game {
  const g = builtOnMedium(seed);
  g.phase = "turn";
  g.handoff = null;
  g.current = 0;
  g.strategic!.autoDoneTurn = g.turn;
  return g;
}

/**
 * The turn-1 game with hand-placed armies in map squares. Each side starts knowing just its base
 * rectangle (not what the random army saw), then looks around once.
 */
function scenario(own: Unit[], enemy: Unit[], seed = 1): Game {
  const g = turnGame(seed);
  g.players[0].units = own;
  g.players[1].units = enemy;
  const base = (p: 0 | 1) => encodeExplored(new Set(squaresOfRect({ ...g.strategic!.bases[p], ...BASE_GRID }, medium)), medium);
  g.strategic!.explored = [base(0), base(1)];
  return lookAround(lookAround(g, 0), 1);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where a shell from `gun` aimed at `aim` lands for an Rng state, by the rule in the brief: draw u then v, shake grows with the range. */
function drift(state: number, aim: Point, gun: Unit): Point {
  const rng = new Rng(state);
  const u = rng.next();
  const v = rng.next();
  const r = shakeRadius(distanceToRect(aim.x, aim.y, rectOf(gun))) * Math.sqrt(u);
  const a = 2 * Math.PI * v;
  return { x: clamp(aim.x + r * Math.cos(a), 0, medium.w), y: clamp(aim.y + r * Math.sin(a), 0, medium.h) };
}

/** The widest shake on Medium: a shell aimed at the far corner from the near one. */
const WIDEST_SHAKE = shakeRadius(Math.hypot(medium.w, medium.h));

/** The first Rng state from `from` whose shell barely drifts (under a tenth of a square at any range), so a test can aim exactly. */
function steadyState(from = 1): number {
  for (let state = from; ; state++) if (WIDEST_SHAKE * Math.sqrt(new Rng(state).next()) < 0.1) return state;
}

const farFort = unit("fort-1", 30, 8);

describe("moveUnit", () => {
  it("moves a tank up to 3 squares, looks around, logs the move and uses up its move", () => {
    const g = scenario([unit("tank-1", 4, 8)], [farFort]);
    const before = decodeExplored(g.strategic!.explored[0], medium);
    const r = ok(moveUnit(g, "tank-1", { x: 7, y: 9 }));
    const tank = r.players[0].units[0]!;
    expect([tank.x, tank.y]).toEqual([7, 9]);
    expect(r.strategic!.orders).toEqual({ "tank-1": { moved: true, fired: false } });
    expect(r.strategic!.events).toEqual([
      { kind: "move", turn: 1, player: 0, unitId: "tank-1", type: "tank", from: { x: 4, y: 8 }, to: { x: 7, y: 9 }, riders: [], riderMoves: [] },
    ]);
    const after = decodeExplored(r.strategic!.explored[0], medium);
    expect(after.size).toBeGreaterThan(before.size);
    for (const i of visibleSquares(r.players[0].units, medium)) expect(after.has(i)).toBe(true);
    expect(g.players[0].units[0]!.x).toBe(4); // the original is untouched
    expect(g.strategic!.orders).toEqual({});
  });

  it("reachableFor lists the top-lefts a unit can move to and nothing for a unit that cannot move", () => {
    const g = scenario([unit("tank-1", 4, 8), unit("artillery-1", 4, 11), unit("tank-2", 10, 8, 3)], [farFort]);
    const reach = reachableFor(g, "tank-1").map(key);
    expect(reach).toHaveLength(7 * 7 - 1 - 6); // minus the six footprints in range that would cover the artillery
    expect(reach).toContain("7,11");
    expect(reach).not.toContain("4,8");
    expect(reach).not.toContain("3,10"); // on the artillery
    expect(reachableFor(g, "artillery-1")).toEqual([]);
    expect(reachableFor(g, "tank-2")).toEqual([]); // destroyed
    expect(reachableFor(g, "tank-9")).toEqual([]);
  });

  /** True when no two living units of either side share a square. */
  function nobodyOverlaps(g: Game): boolean {
    const living = [...g.players[0].units, ...g.players[1].units].filter(isAlive);
    return living.every((a, i) => living.every((b, j) => i === j || !rectsOverlap(rectOf(a), rectOf(b))));
  }

  it("a truck lifts the infantry beside it (up to 4) and sets them down on the side it was heading; one with no room stays", () => {
    // The truck runs along the top edge to the corner; two walls and the corner leave only three
    // squares round the destination, one of them under infantry-3 already, so infantry-3 keeps its
    // square and the fourth rider has nowhere to go: both stay behind.
    const own = [
      unit("truck-1", 3, 0),
      unit("infantry-1", 5, 0),
      unit("infantry-2", 5, 1),
      unit("infantry-3", 2, 2),
      unit("infantry-4", 3, 2),
      unit("infantry-5", 4, 2), // the fifth is over capacity
      unit("wall-1", 0, 2),
    ];
    const g = scenario(own, [farFort]);
    expect(ridersFor(g, "truck-1")).toEqual(["infantry-1", "infantry-2", "infantry-3", "infantry-4"]);
    const r = ok(moveUnit(g, "truck-1", { x: 0, y: 0 }));
    const at = (id: string) => {
      const u = r.players[0].units.find((v) => v.id === id)!;
      return { x: u.x, y: u.y };
    };
    expect(at("truck-1")).toEqual({ x: 0, y: 0 });
    // The truck drove left into the corner, so the point ahead of it, (-2,1), is off the map: the
    // free squares nearest it are on the right, (2,0) and (2,1) tied first, in reading order.
    expect(at("infantry-1")).toEqual({ x: 2, y: 0 });
    expect(at("infantry-2")).toEqual({ x: 2, y: 1 });
    expect(at("infantry-3")).toEqual({ x: 2, y: 2 }); // its own square is the best one left: stays, not a rider
    expect(at("infantry-4")).toEqual({ x: 3, y: 2 }); // no room: stays
    expect(at("infantry-5")).toEqual({ x: 4, y: 2 }); // never a rider
    expect(r.strategic!.events.at(-1)).toMatchObject({ kind: "move", unitId: "truck-1", type: "truck", from: { x: 3, y: 0 }, to: { x: 0, y: 0 }, riders: ["infantry-1", "infantry-2"] });
    expect(r.strategic!.orders).toEqual({ "truck-1": { moved: true, fired: false } });
    expect(nobodyOverlaps(r)).toBe(true);
  });

  it("riders never end up sharing a square, even when the squares round the destination are nearly all taken", () => {
    // A crowded ring: enemy infantry hold seven ring squares and the forest two more, leaving (2,2),
    // (2,3) and (2,4), where (2,2) is infantry-4's own square. Handing it to an earlier rider would
    // have left infantry-4, with no square of its own left, standing on top of that rider.
    const own = [unit("truck-1", 0, 3), unit("infantry-1", 0, 2), unit("infantry-2", 1, 2), unit("infantry-3", 0, 5), unit("infantry-4", 2, 2)];
    const blockers = [
      [3, 2],
      [4, 2],
      [5, 4],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ].map(([x, y], i) => unit(`infantry-${i + 1}`, x as number, y as number));
    const g = scenario(own, [farFort, ...blockers]);
    expect(ridersFor(g, "truck-1")).toEqual(["infantry-1", "infantry-2", "infantry-3", "infantry-4"]);
    const r = ok(moveUnit(g, "truck-1", { x: 3, y: 3 }));
    const at = (id: string) => {
      const u = r.players[0].units.find((v) => v.id === id)!;
      return { x: u.x, y: u.y };
    };
    expect(at("infantry-1")).toEqual({ x: 2, y: 3 });
    expect(at("infantry-2")).toEqual({ x: 2, y: 4 });
    expect(at("infantry-3")).toEqual({ x: 0, y: 5 }); // no room: stays
    expect(at("infantry-4")).toEqual({ x: 2, y: 2 }); // keeps its square
    expect(r.strategic!.events.at(-1)).toMatchObject({ kind: "move", unitId: "truck-1", riders: ["infantry-1", "infantry-2"] });
    expect(nobodyOverlaps(r)).toBe(true);
  });

  it("the enemy's unit of the same name is no empty ground: not for a tank, not for a rider", () => {
    // Both armies name their units tank-1, infantry-1 and so on.
    const own = [unit("tank-1", 10, 10), unit("truck-1", 14, 12), unit("infantry-1", 13, 12)];
    const enemy = [farFort, unit("tank-1", 12, 10), unit("tank-2", 10, 12), unit("infantry-1", 17, 12)];
    const g = scenario(own, enemy);
    const reach = reachableFor(g, "tank-1").map(key);
    expect(reach).not.toContain("12,10");
    expect(reach).not.toContain("13,10");
    expect(reach).not.toContain("10,12");
    expect(moveUnit(g, "tank-1", { x: 12, y: 10 })).toEqual(failed("blocked"));
    expect(moveUnit(g, "tank-1", { x: 10, y: 12 })).toEqual(failed("blocked"));
    // The truck moves one square right; of the squares nearest the point ahead of it, (17,13),
    // the first is (17,12), where the enemy infantry-1 stands, so its rider takes (17,13).
    const r = ok(moveUnit(g, "truck-1", { x: 15, y: 12 }));
    expect(nobodyOverlaps(r)).toBe(true);
    const rider = r.players[0].units.find((u) => u.id === "infantry-1")!;
    expect({ x: rider.x, y: rider.y }).toEqual({ x: 17, y: 13 });
    expect(r.strategic!.events.at(-1)).toMatchObject({ kind: "move", unitId: "truck-1", riders: ["infantry-1"] });
  });

  it("riders hop off on the side the truck was heading, wherever the enemy base is", () => {
    // Driving 4 squares right, the point ahead is (17,8): the riders get off on the truck's right.
    expect(dropPoint({ type: "truck", upright: false }, { x: 8, y: 7 }, { x: 12, y: 7 })).toEqual({ x: 17, y: 8 });
    expect(dropPoint({ type: "truck", upright: false }, { x: 3, y: 0 }, { x: 0, y: 0 })).toEqual({ x: -2, y: 1 });
    const g = scenario([unit("truck-1", 8, 7), unit("infantry-1", 7, 7), unit("infantry-2", 7, 8)], [farFort]);
    const r = ok(moveUnit(g, "truck-1", { x: 12, y: 7 }));
    const at = (game: Game, id: string) => {
      const u = game.players[0].units.find((v) => v.id === id)!;
      return { x: u.x, y: u.y };
    };
    expect(at(r, "infantry-1")).toEqual({ x: 14, y: 7 });
    expect(at(r, "infantry-2")).toEqual({ x: 14, y: 8 });
    // Moving the hidden enemy base changes nothing the player can see.
    for (const base of [{ x: 24, y: 8 }, { x: 27, y: 1 }, { x: 26, y: 13 }, { x: 2, y: 1 }]) {
      const moved = structuredClone(g);
      moved.strategic!.bases[1] = base;
      expect(ok(moveUnit(moved, "truck-1", { x: 12, y: 7 })).players[0].units).toEqual(r.players[0].units);
    }
  });

  it("ridersFor counts only the current player's living infantry touching the truck", () => {
    const own = [unit("truck-1", 6, 9), unit("infantry-1", 5, 9), unit("infantry-2", 8, 11), unit("infantry-3", 9, 9), unit("infantry-4", 6, 11, 1), unit("tank-1", 6, 7)];
    const g = scenario(own, [farFort, unit("infantry-1", 5, 10)]);
    expect(ridersFor(g, "truck-1")).toEqual(["infantry-1", "infantry-2"]); // infantry-3 is 2 away, infantry-4 destroyed
    expect(ridersFor(g, "tank-1")).toEqual([]);
    expect(ridersFor({ ...g, current: 1 }, "truck-1")).toEqual([]);
  });

  it("fails with the right reason", () => {
    const own = [unit("tank-1", 4, 8), unit("tank-2", 10, 8, 3), unit("artillery-1", 4, 11), unit("infantry-1", 8, 8)];
    const g = scenario(own, [farFort, unit("truck-1", 12, 12)]);
    const step = { x: 5, y: 8 };
    expect(moveUnit({ ...g, phase: "handoff" }, "tank-1", step)).toEqual(failed("wrong_phase"));
    expect(moveUnit({ ...g, phase: "over" }, "tank-1", step)).toEqual(failed("wrong_phase"));
    expect(moveUnit(gameInBattle(), "tank-1", step)).toEqual(failed("wrong_phase")); // a Quick action game
    expect(moveUnit(g, "tank-9", step)).toEqual(failed("unknown_unit"));
    expect(moveUnit(g, "tank-2", step)).toEqual(failed("unknown_unit")); // destroyed
    expect(moveUnit(g, "artillery-1", step)).toEqual(failed("unknown_unit")); // never moves
    expect(moveUnit(g, "infantry-1", step)).toEqual(failed("unknown_unit")); // acts on its own
    expect(moveUnit(g, "truck-1", step)).toEqual(failed("unknown_unit")); // the enemy's
    expect(moveUnit(g, "tank-1", { x: 8, y: 8 })).toEqual(failed("blocked")); // 4 away
    expect(moveUnit(g, "tank-1", { x: 7, y: 8 })).toEqual(failed("blocked")); // onto the infantry
    expect(moveUnit(g, "tank-1", { x: 4, y: 8 })).toEqual(failed("blocked")); // staying put is no move
    const moved = ok(moveUnit(g, "tank-1", step));
    expect(moveUnit(moved, "tank-1", { x: 6, y: 8 })).toEqual(failed("already_moved"));
  });

  it("a tank that has fired cannot move, but one that moved can still fire", () => {
    const g = scenario([unit("tank-1", 4, 8)], [farFort, unit("wall-1", 9, 8)]);
    const fired = ok(fireTank(ok(moveUnit(g, "tank-1", { x: 6, y: 8 })), "tank-1", "wall-1"));
    expect(fired.strategic!.orders["tank-1"]).toEqual({ moved: true, fired: true });
    expect(moveUnit(fired, "tank-1", { x: 5, y: 8 })).toEqual(failed("already_fired"));
    const g2 = scenario([unit("tank-1", 6, 8)], [farFort, unit("wall-1", 9, 8)]);
    const shot = ok(fireTank(g2, "tank-1", "wall-1"));
    expect(moveUnit(shot, "tank-1", { x: 5, y: 8 })).toEqual(failed("already_fired"));
  });

  it("a 2 x 2 tank cannot squeeze onto terrain or another unit", () => {
    const g = scenario([unit("tank-1", 3, 6), unit("infantry-1", 6, 7)], [farFort]);
    const reach = reachableFor(g, "tank-1").map(key);
    expect(reach).toContain("3,3");
    expect(reach).not.toContain("4,3"); // (5,3) is forest
    expect(reach).not.toContain("5,4"); // (6,4) is forest
    expect(reach).not.toContain("5,6"); // the infantry stands on (6,7)
    expect(reach).toContain("5,8");
    expect(moveUnit(g, "tank-1", { x: 4, y: 3 })).toEqual(failed("blocked"));
    expect(moveUnit(g, "tank-1", { x: 5, y: 6 })).toEqual(failed("blocked"));
  });

  it("the reach goes round only what the player can see: an enemy in the fog leaves no gap in it", () => {
    // The truck (squares 8-9 x 7-8) sees 2 squares; the enemy wall at (13,7) is 3 squares off its edge.
    const hiddenWall = unit("wall-1", 13, 7);
    const g = scenario([unit("truck-1", 8, 7)], [farFort, hiddenWall]);
    expect(visibleSquares(g.players[0].units, medium).has(7 * medium.w + 13)).toBe(false);
    const reach = reachableFor(g, "truck-1").map(key);
    expect(reach).toContain("12,7"); // a footprint over the hidden wall
    expect(reach).toEqual(reachableFor(scenario([unit("truck-1", 8, 7)], [farFort]), "truck-1").map(key));
    // Once one of the player's units sees the wall, it is in the way like any unit.
    const seen = scenario([unit("truck-1", 8, 7), unit("tank-1", 12, 10)], [farFort, hiddenWall]);
    expect(reachableFor(seen, "truck-1").map(key)).not.toContain("12,7");
  });

  it("a move that runs into an enemy hidden in the fog stops beside it, spends the move and sees it", () => {
    const own = [unit("truck-1", 8, 7), unit("infantry-1", 7, 7)];
    const g = scenario(own, [farFort, unit("wall-1", 13, 7)]);
    // Driving straight right to (13,7), the truck would cover the wall from (12,7) on.
    const r = ok(moveUnit(g, "truck-1", { x: 13, y: 7 }));
    const truck = r.players[0].units.find((u) => u.id === "truck-1")!;
    expect({ x: truck.x, y: truck.y }).toEqual({ x: 11, y: 7 });
    expect(r.strategic!.orders["truck-1"]).toEqual({ moved: true, fired: false });
    expect(r.strategic!.events.at(-1)).toMatchObject({ kind: "move", unitId: "truck-1", from: { x: 8, y: 7 }, to: { x: 11, y: 7 }, riders: ["infantry-1"] });
    // The rider gets off ahead of where the truck really stopped, round the wall.
    const rider = r.players[0].units.find((u) => u.id === "infantry-1")!;
    expect({ x: rider.x, y: rider.y }).toEqual({ x: 13, y: 8 });
    expect(nobodyOverlaps(r)).toBe(true);
    // Bumping into the wall shows it, and nothing more.
    expect(r.strategic!.lastSeen[0].map((u) => u.id)).toEqual(["wall-1"]);
    expect(moveUnit(r, "truck-1", { x: 12, y: 9 })).toEqual(failed("already_moved"));
    // A tank stopped that way may still fire at what it ran into. Its only 3-step way to (11,4) is
    // straight up the diagonal, and the last footprint covers the wall at (12,4).
    const tankGame = scenario([unit("tank-1", 8, 7)], [farFort, unit("wall-1", 12, 4)]);
    expect(tankTargets(tankGame, "tank-1")).toEqual([]);
    expect(reachableFor(tankGame, "tank-1").map(key)).toContain("11,4");
    const tank = ok(moveUnit(tankGame, "tank-1", { x: 11, y: 4 }));
    expect(tank.players[0].units[0]).toMatchObject({ x: 10, y: 5 });
    expect(tankTargets(tank, "tank-1")).toEqual(["wall-1"]);
    expect(ok(fireTank(tank, "tank-1", "wall-1")).strategic!.orders["tank-1"]).toEqual({ moved: true, fired: true });
  });
});

describe("tankTargets and fireTank", () => {
  it("lists living enemies within 2 squares in sight, walls included; 3 away is out of range", () => {
    const enemy = [unit("infantry-1", 9, 8), unit("wall-1", 6, 11), unit("tank-1", 10, 10), unit("artillery-1", 5, 5, 2), farFort];
    const g = scenario([unit("tank-1", 6, 8), unit("artillery-1", 2, 8)], enemy);
    expect(tankTargets(g, "tank-1")).toEqual(["infantry-1", "wall-1"]);
    expect(tankTargets(g, "artillery-1")).toEqual([]);
    expect(tankTargets(g, "tank-9")).toEqual([]);
    expect(tankTargets({ ...g, players: [{ ...g.players[0], units: [unit("tank-1", 6, 8, 3)] }, g.players[1]] }, "tank-1")).toEqual([]);
    // A living tank sees 3 squares, so everything within its range of 2 is in sight; the sight
    // check still guards the rule should sight ever shrink.
  });

  it("damages 2, destroys a wall in one, ends the tank's movement and records a revealed shot", () => {
    const g = scenario([unit("tank-1", 6, 8), unit("tank-2", 6, 12)], [unit("tank-1", 9, 8), unit("wall-1", 7, 14), farFort]);
    const r1 = fireTank(g, "tank-1", "tank-1");
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const victim = r1.game.players[1].units.find((u) => u.id === "tank-1")!;
    expect(victim.hits).toBe(2);
    expect(stateOf(victim)).toBe("damaged");
    expect(hpLeft(victim)).toBe(1);
    expect(r1.shot).toEqual({
      id: 1,
      by: 0,
      weapon: "tank",
      unitId: "tank-1",
      aim: { x: 10, y: 9 },
      x: 10,
      y: 9,
      turn: 1,
      outcome: "hit",
      hits: [{ unitId: "tank-1", owner: 1, type: "tank", damage: 2, destroyed: false, seen: true }],
      revealed: true,
    });
    expect(r1.game.strategic!.shots).toEqual([r1.shot]);
    expect(r1.game.strategic!.events).toEqual([{ kind: "shot", turn: 1, player: 0, shotId: 1 }]);
    expect(r1.game.strategic!.orders["tank-1"]).toEqual({ moved: true, fired: true });
    expect(r1.game.strategic!.nextShot).toBe(2);
    expect(r1.game.phase).toBe("turn");
    expect(fireTank(r1.game, "tank-1", "tank-1")).toEqual(failed("already_fired"));
    expect(g.players[1].units[0]!.hits).toBe(0); // the original is untouched

    const r2 = fireTank(r1.game, "tank-2", "wall-1");
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const wall = r2.game.players[1].units.find((u) => u.id === "wall-1")!;
    expect(stateOf(wall)).toBe("destroyed");
    expect(r2.shot).toMatchObject({ id: 2, outcome: "wall", aim: { x: 8, y: 14.5 }, hits: [{ unitId: "wall-1", owner: 1, type: "wall", damage: 1, destroyed: true, seen: true }], revealed: true });
    expect(r2.game.strategic!.shots.map((s) => s.id)).toEqual([1, 2]);
    expect(tankTargets(r2.game, "tank-2")).toEqual([]); // a broken wall is no target
  });

  it("fails without a target in range, for a unit that is not a tank and outside a turn", () => {
    const g = scenario([unit("tank-1", 6, 8), unit("artillery-1", 2, 8), unit("infantry-1", 8, 8)], [unit("tank-1", 10, 10), unit("wall-1", 6, 11), farFort]);
    expect(fireTank(g, "tank-1", "tank-1")).toEqual(failed("no_target")); // 3 away
    expect(fireTank(g, "tank-1", "fort-1")).toEqual(failed("no_target"));
    expect(fireTank(g, "tank-1", "infantry-1")).toEqual(failed("no_target")); // one of its own
    expect(fireTank(g, "artillery-1", "wall-1")).toEqual(failed("unknown_unit"));
    expect(fireTank(g, "tank-9", "wall-1")).toEqual(failed("unknown_unit"));
    expect(fireTank({ ...g, phase: "over" }, "tank-1", "wall-1")).toEqual(failed("wrong_phase"));
    expect(fireTank({ ...g, phase: "handoff" }, "tank-1", "wall-1")).toEqual(failed("wrong_phase"));
    expect(fireTank(gameInBattle(), "tank-1", "wall-1")).toEqual(failed("wrong_phase"));
  });

  it("a tank shot on the enemy fort's last hit points wins the game", () => {
    const g = scenario([unit("tank-1", 27, 8)], [unit("fort-1", 30, 8, 4)]);
    const r = ok(fireTank(g, "tank-1", "fort-1"));
    expect(r.phase).toBe("over");
    expect(r.winner).toBe(0);
    expect(r.strategic!.events.map((e) => e.kind)).toEqual(["shot", "fort-destroyed"]);
    expect(endStrategicTurn(r)).toEqual(failed("wrong_phase"));
    expect(moveUnit(r, "tank-1", { x: 26, y: 8 })).toEqual(failed("wrong_phase"));
  });
});

describe("aimProblem", () => {
  const g = scenario([unit("artillery-1", 4, 8)], [farFort]); // footprint x 4-6, y 8-10 as a rectangle

  it("is too_close under 3 squares from the footprint edge and fine at exactly 3", () => {
    expect(ARTILLERY_MIN_RANGE).toBe(3);
    expect(aimProblem(g, "artillery-1", { x: 8.9, y: 9 })).toBe("too_close");
    expect(aimProblem(g, "artillery-1", { x: 9, y: 9 })).toBeNull();
    expect(aimProblem(g, "artillery-1", { x: 1.1, y: 9 })).toBe("too_close");
    expect(aimProblem(g, "artillery-1", { x: 1, y: 9 })).toBeNull();
    expect(aimProblem(g, "artillery-1", { x: 5, y: 9 })).toBe("too_close"); // on top of itself
    expect(aimProblem(g, "artillery-1", { x: 8.1, y: 12.1 })).toBe("too_close"); // diagonal 2.97
    expect(aimProblem(g, "artillery-1", { x: 8.2, y: 12.2 })).toBeNull(); // diagonal 3.11
    expect(aimProblem(g, "artillery-1", { x: 20, y: 10 })).toBeNull();
  });

  it("is off_map outside the paper, edges included", () => {
    expect(aimProblem(g, "artillery-1", { x: -0.1, y: 9 })).toBe("off_map");
    expect(aimProblem(g, "artillery-1", { x: 40.01, y: 9 })).toBe("off_map");
    expect(aimProblem(g, "artillery-1", { x: 9, y: -1 })).toBe("off_map");
    expect(aimProblem(g, "artillery-1", { x: 9, y: 20.5 })).toBe("off_map");
    expect(aimProblem(g, "artillery-1", { x: 40, y: 20 })).toBeNull();
    expect(aimProblem(g, "artillery-1", { x: 0, y: 0 })).toBeNull();
  });
});

describe("fireArtillery", () => {
  it("shakes 0.75 squares at the minimum range, a twentieth of a square more per square of range, and never more than 2", () => {
    expect([SHAKE_RADIUS, SHAKE_PER_SQUARE, SHAKE_MAX]).toEqual([0.75, 0.05, 2]);
    expect(shakeRadius(0)).toBe(0.75);
    expect(shakeRadius(ARTILLERY_MIN_RANGE)).toBe(0.75);
    expect(shakeRadius(13)).toBeCloseTo(1.25);
    expect(shakeRadius(23)).toBeCloseTo(1.75);
    expect(shakeRadius(28)).toBeCloseTo(2);
    expect(shakeRadius(60)).toBe(2);
    // Across the whole of a Large map, corner to corner, it is still 2.
    expect(shakeRadius(Math.hypot(60, 30))).toBe(SHAKE_MAX);
  });

  it("lands within the shake radius for its range, never off the map, drawing exactly u then v from the Rng (200 seeds)", () => {
    const gun = unit("artillery-1", 4, 8);
    const base = scenario([gun], [farFort]);
    let clamped = 0;
    let beyondMinimumShake = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const g = { ...base, rngState: seed };
      const aim = seed % 2 ? { x: 12, y: 9 } : { x: 39.9, y: 19.8 };
      const r = fireArtillery(g, "artillery-1", aim);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const drifted = Math.hypot(r.shot.x - aim.x, r.shot.y - aim.y);
      expect(drifted).toBeLessThanOrEqual(shakeRadius(distanceToRect(aim.x, aim.y, rectOf(gun))) + 1e-9);
      expect(drifted).toBeLessThanOrEqual(shakeFor(g, "artillery-1", aim) + 1e-9); // the dashed circle the screen draws
      if (drifted > SHAKE_RADIUS) beyondMinimumShake++;
      expect(r.shot.x).toBeGreaterThanOrEqual(0);
      expect(r.shot.x).toBeLessThanOrEqual(medium.w);
      expect(r.shot.y).toBeGreaterThanOrEqual(0);
      expect(r.shot.y).toBeLessThanOrEqual(medium.h);
      expect({ x: r.shot.x, y: r.shot.y }).toEqual(drift(seed, aim, gun));
      if (r.shot.x === medium.w || r.shot.y === medium.h) clamped++;
      const rng = new Rng(seed);
      rng.next();
      rng.next();
      expect(r.game.rngState).toBe(rng.state);
      expect(r.shot).toMatchObject({ id: 1, by: 0, weapon: "shell", unitId: "artillery-1", aim, turn: 1 });
      expect(r.game.strategic!.orders).toEqual({ "artillery-1": { moved: false, fired: true } });
    }
    expect(clamped).toBeGreaterThan(0);
    expect(beyondMinimumShake).toBeGreaterThan(0); // the far aim shakes up to 2 squares, well past 0.75
    expect(base.rngState).toBe(scenario([unit("artillery-1", 4, 8)], [farFort]).rngState); // nothing random happens on its own
  });

  it("hurts every unit under the circle on both sides by 3 and leaves the rest alone", () => {
    const own = [unit("artillery-1", 4, 8), unit("tank-1", 12, 8), unit("infantry-1", 14, 9), unit("tank-2", 4, 12)];
    const enemy = [unit("infantry-1", 13, 10), unit("tank-1", 15, 10), farFort];
    const g = scenario(own, enemy);
    g.rngState = steadyState();
    const aim = { x: 14, y: 9.5 };
    const r = fireArtillery(g, "artillery-1", aim);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const find = (p: 0 | 1, id: string) => r.game.players[p].units.find((u) => u.id === id)!;
    expect(stateOf(find(0, "tank-1"))).toBe("destroyed"); // 3 hit points, 3 damage: friendly fire
    expect(stateOf(find(0, "infantry-1"))).toBe("destroyed");
    expect(stateOf(find(1, "infantry-1"))).toBe("destroyed");
    expect(find(1, "tank-1").hits).toBe(0);
    expect(find(0, "tank-2").hits).toBe(0);
    expect(find(0, "artillery-1").hits).toBe(0);
    expect(r.shot.outcome).toBe("hit");
    expect(r.shot.hits).toEqual([
      { unitId: "tank-1", owner: 0, type: "tank", damage: 3, destroyed: true, seen: true },
      { unitId: "infantry-1", owner: 0, type: "infantry", damage: 1, destroyed: true, seen: true },
      { unitId: "infantry-1", owner: 1, type: "infantry", damage: 1, destroyed: true, seen: true }, // in the tank's sight as the shell fell
    ]);
    expect(r.shot.revealed).toBe(true); // the tank was watching (before it blew up)
    // Every hit unit really was under the circle, and the spared ones were not.
    for (const p of [0, 1] as const) {
      for (const u of g.players[p].units) {
        const hit = r.shot.hits.some((h) => h.owner === p && h.unitId === u.id);
        expect(circleHitsRect(r.shot.x, r.shot.y, SHOT_RADIUS, hitRectOf(u)), `${p} ${u.id}`).toBe(hit);
      }
    }
    expect(r.game.phase).toBe("turn");
  });

  it("a standing wall under the circle takes the whole blow", () => {
    const g = scenario([unit("artillery-1", 4, 8), unit("tank-1", 12, 8)], [unit("wall-1", 14, 9), unit("infantry-1", 13, 10), farFort]);
    g.rngState = steadyState();
    const r = fireArtillery(g, "artillery-1", { x: 14, y: 9.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shot.outcome).toBe("wall");
    expect(r.shot.hits).toEqual([{ unitId: "wall-1", owner: 1, type: "wall", damage: 1, destroyed: true, seen: true }]);
    expect(r.game.players[0].units[1]!.hits).toBe(0);
    expect(r.game.players[1].units[1]!.hits).toBe(0);
    expect(stateOf(r.game.players[1].units[0]!)).toBe("destroyed");
  });

  it("a shell into the fog hurts what it finds but reveals nothing", () => {
    const g = scenario([unit("artillery-1", 4, 8)], [farFort, unit("tank-1", 19, 12)]);
    g.rngState = steadyState();
    const r = fireArtillery(g, "artillery-1", { x: 20, y: 13.2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shot.revealed).toBe(false);
    expect(r.shot.outcome).toBe("hit");
    expect(r.shot.hits).toEqual([{ unitId: "tank-1", owner: 1, type: "tank", damage: 3, destroyed: true, seen: false }]);
    expect(r.game.strategic!.explored).toEqual(g.strategic!.explored);
    expect(r.game.strategic!.lastSeen).toEqual(g.strategic!.lastSeen);
    expect(r.game.strategic!.lastSeen[0]).toEqual([]);
  });

  it("is revealed when one of the shooter's units can see the landing square", () => {
    const g = scenario([unit("artillery-1", 4, 8), unit("tank-2", 16, 12)], [farFort, unit("tank-1", 19, 12)]);
    g.rngState = steadyState();
    const r = fireArtillery(g, "artillery-1", { x: 20, y: 13.2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shot.revealed).toBe(true);
    expect(r.shot.hits.map((h) => h.seen)).toEqual([true]); // tank 2 had the enemy tank in sight
    expect(r.game.strategic!.explored).toEqual(g.strategic!.explored); // still no reveal of ground
    expect(r.game.strategic!.lastSeen).toEqual(g.strategic!.lastSeen);
  });

  it("a miss hurts nobody and shots get increasing ids across both weapons", () => {
    const g = scenario([unit("artillery-1", 4, 8), unit("tank-1", 6, 12)], [farFort, unit("wall-1", 9, 12)]);
    g.rngState = steadyState();
    const r1 = fireArtillery(g, "artillery-1", { x: 20, y: 6 });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.shot).toMatchObject({ id: 1, outcome: "miss", hits: [] });
    const r2 = fireTank(r1.game, "tank-1", "wall-1");
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.shot.id).toBe(2);
    expect(r2.game.strategic!.nextShot).toBe(3);
    expect(r2.game.strategic!.shots.map((s) => s.id)).toEqual([1, 2]);
    expect(r2.game.strategic!.events).toEqual([
      { kind: "shot", turn: 1, player: 0, shotId: 1 },
      { kind: "shot", turn: 1, player: 0, shotId: 2 },
    ]);
    // The numbering carries on next turn.
    const next = ok(confirmHandoff(ok(endStrategicTurn(r2.game))));
    const g3 = { ...next, phase: "turn" as const, players: [next.players[0], { ...next.players[1], units: [farFort, unit("artillery-1", 30, 12)] }] as Game["players"] };
    const r3 = fireArtillery(g3, "artillery-1", { x: 20, y: 6 });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.shot).toMatchObject({ id: 3, by: 1, turn: 2 });
  });

  it("fails when already fired, too close, off the map, not an artillery or outside a turn", () => {
    const g = scenario([unit("artillery-1", 4, 8), unit("tank-1", 6, 12)], [farFort]);
    expect(fireArtillery(g, "artillery-1", { x: 8.9, y: 9 })).toEqual(failed("too_close"));
    expect(fireArtillery(g, "artillery-1", { x: 40.5, y: 9 })).toEqual(failed("blocked"));
    expect(fireArtillery(g, "artillery-1", { x: 9, y: -0.5 })).toEqual(failed("blocked"));
    expect(fireArtillery(g, "tank-1", { x: 20, y: 9 })).toEqual(failed("unknown_unit"));
    expect(fireArtillery(g, "artillery-2", { x: 20, y: 9 })).toEqual(failed("unknown_unit"));
    expect(fireArtillery({ ...g, phase: "over" }, "artillery-1", { x: 20, y: 9 })).toEqual(failed("wrong_phase"));
    expect(fireArtillery(gameInBattle(), "artillery-1", { x: 20, y: 9 })).toEqual(failed("wrong_phase"));
    const once = ok(fireArtillery(g, "artillery-1", { x: 20, y: 9 }));
    expect(fireArtillery(once, "artillery-1", { x: 20, y: 9 })).toEqual(failed("already_fired"));
    expect(once.strategic!.shots).toHaveLength(1);
  });

  it("a shell that fells a fort ends the game with the right winner, even the shooter's own fort", () => {
    const g = scenario([unit("artillery-1", 4, 8), unit("fort-1", 12, 8, 3)], [farFort, unit("infantry-1", 15, 9)]);
    g.rngState = steadyState();
    const r = fireArtillery(g, "artillery-1", { x: 14.8, y: 9.5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.game.phase).toBe("over");
    expect(r.game.winner).toBe(1);
    expect(stateOf(r.game.players[0].units[1]!)).toBe("destroyed");
    expect(stateOf(r.game.players[1].units[1]!)).toBe("destroyed"); // still hurt after the fort fell
    expect(r.shot.hits.map((h) => `${h.owner}:${h.unitId}`)).toEqual(["0:fort-1", "1:infantry-1"]);
    expect(r.game.strategic!.events).toEqual([
      { kind: "shot", turn: 1, player: 0, shotId: 1 },
      { kind: "fort-destroyed", turn: 1, player: 0, by: 0 },
    ]);
    expect(endStrategicTurn(r.game)).toEqual(failed("wrong_phase"));
    expect(fireArtillery(r.game, "artillery-1", { x: 20, y: 9 })).toEqual(failed("wrong_phase"));

    const g2 = scenario([unit("artillery-1", 4, 8)], [unit("fort-1", 12, 8, 3)]);
    g2.rngState = steadyState();
    const r2 = ok(fireArtillery(g2, "artillery-1", { x: 13.5, y: 9.5 }));
    expect(r2.phase).toBe("over");
    expect(r2.winner).toBe(0);
    expect(r2.strategic!.events.at(-1)).toEqual({ kind: "fort-destroyed", turn: 1, player: 1, by: 0 });
  });

  it("landShell is the same for either player and keeps the aim it was given", () => {
    const gun = unit("artillery-1", 30, 12);
    const g = scenario([farFort], [gun]);
    const aim = { x: 20, y: 6 };
    const { game, shot } = landShell({ ...g, current: 1 }, 1, "artillery-1", aim);
    expect(shot).toMatchObject({ by: 1, weapon: "shell", unitId: "artillery-1", aim, outcome: "miss", hits: [], revealed: false });
    expect({ x: shot.x, y: shot.y }).toEqual(drift(g.rngState, aim, gun));
    expect(game.strategic!.shots).toEqual([shot]);
    expect(game.strategic!.orders).toEqual({}); // landShell does not spend the order; fireArtillery does
    aim.x = 0;
    expect(shot.aim.x).toBe(20);
  });
});
