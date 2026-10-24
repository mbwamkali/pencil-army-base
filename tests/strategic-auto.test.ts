import { describe, expect, it } from "vitest";
import {
  confirmHandoff,
  createGame,
  rectOf,
  rectsOverlap,
  typeOfId,
  type Game,
  type PlayerIndex,
  type Unit,
  type UnitType,
} from "../src/rules/index.ts";
import {
  BASE_GRID,
  decodeExplored,
  encodeExplored,
  endStrategicTurn,
  insideMap,
  isAlive,
  ridersFor,
  isBlocked,
  squareIndex,
  squaresOfRect,
  terrainSquares,
  visibleSquares,
  type Point,
  type StrategicEvent,
  type StrategicMap,
} from "../src/strategic/rules/index.ts";
import { beginStrategicTurn, chooseMeleeTarget, infantryStep, nextStepToward, spawnInfantry } from "../src/strategic/rules/auto.ts";
import { builtGame, builtOnMedium, mapOfGame, medium, ok } from "./strategic-fixtures.ts";

/** A two-player Strategic game on a new-game map with random bases, player 1 looking at their first turn. */
const inTurn = (seed: number): Game => ok(confirmHandoff(builtGame(seed)));

/** A unit at a map square; the type comes from the id ("tank-2" is a tank). */
const unit = (id: string, x: number, y: number, hits = 0, upright = false): Unit => ({ id, type: typeOfId(id) as UnitType, x, y, upright, hits });

const at = (u: Unit | undefined): Point => ({ x: u?.x ?? -1, y: u?.y ?? -1 });
const find = (g: Game, p: PlayerIndex, id: string) => g.players[p].units.find((u) => u.id === id);
const events = (g: Game): StrategicEvent[] => g.strategic!.events;

/** Player 1's first turn on Medium 1 with the stage 3 spots, the ground the hand-placed tests below are drawn on. */
const fresh = ok(confirmHandoff(builtOnMedium(1)));

/**
 * A Strategic game on the Medium map with hand-placed units. Player 1's base is at (2,7) and
 * player 2's at (26,7); each knows only their own base, has seen nothing and done nothing yet.
 * Odd Game.turns belong to player 1.
 */
function scenario(mine: Unit[], theirs: Unit[], turn = 1): Game {
  const g = structuredClone(fresh);
  const s = g.strategic!;
  g.players[0].units = mine;
  g.players[1].units = theirs;
  g.turn = turn;
  g.current = turn % 2 === 1 ? 0 : 1;
  const baseOnly = (p: PlayerIndex) => encodeExplored(new Set(squaresOfRect({ ...s.bases[p], ...BASE_GRID }, medium)), medium);
  s.explored = [baseOnly(0), baseOnly(1)];
  s.lastSeen = [[], []];
  s.orders = {};
  s.autoDoneTurn = 0;
  s.events = [];
  s.nextInfantry = [3, 3];
  return g;
}

/** Every living unit stands inside the map, off the terrain and on top of nobody else. */
function expectSound(g: Game, map: StrategicMap = medium): void {
  const alive = [...g.players[0].units, ...g.players[1].units].filter((u) => isAlive(u));
  for (const u of alive) {
    const r = rectOf(u);
    expect(insideMap(map, r), `${u.id} inside the map`).toBe(true);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) expect(isBlocked(map, x, y), `${u.id} on terrain at ${x},${y}`).toBe(false);
  }
  for (const a of alive) for (const b of alive) if (a !== b) expect(rectsOverlap(rectOf(a), rectOf(b)), `${a.id} overlaps ${b.id}`).toBe(false);
}

/** Begin the current turn (whether or not confirmHandoff did already), end it and let the other player tap Start. */
const nextTurn = (g: Game): Game => ok(confirmHandoff(ok(endStrategicTurn(beginStrategicTurn(g)))));

describe("chooseMeleeTarget", () => {
  it("prefers a fighting unit over a wall, then the fewest hit points left, then unit order", () => {
    const wall = unit("wall-1", 0, 0);
    const tank = unit("tank-1", 0, 0);
    const hurtTank = unit("tank-2", 0, 0, 2);
    const artillery = unit("artillery-1", 0, 0);
    const tank3 = unit("tank-3", 0, 0);
    expect(chooseMeleeTarget([wall, tank])?.id).toBe("tank-1");
    expect(chooseMeleeTarget([tank, hurtTank, artillery])?.id).toBe("tank-2");
    expect(chooseMeleeTarget([tank, artillery])?.id).toBe("artillery-1");
    expect(chooseMeleeTarget([tank, tank3])?.id).toBe("tank-1");
    expect(chooseMeleeTarget([tank3, tank])?.id).toBe("tank-3");
    expect(chooseMeleeTarget([wall, unit("wall-2", 0, 0)])?.id).toBe("wall-1");
    expect(chooseMeleeTarget([])).toBeUndefined();
  });
});

describe("nextStepToward", () => {
  // A 10 x 6 map with a wall of hill down column 5, open only at the bottom row.
  const corridor: StrategicMap = {
    id: "test-corridor",
    name: "Corridor",
    size: "small",
    w: 10,
    h: 6,
    terrain: [{ kind: "hill", cx: 5.5, cy: 2.5, rx: 0.9, ry: 2.6 }],
  };
  // A 10 x 6 map with a 3 x 3 hill at x 6-8, y 1-3.
  const blob: StrategicMap = { ...corridor, id: "test-blob", terrain: [{ kind: "hill", cx: 7.5, cy: 2.5, rx: 1.6, ry: 1.6 }] };
  const sq = (x: number, y: number) => ({ x, y, w: 1, h: 1 });

  /** Walk step by step until the unit touches the goal, returning every square it stood on after the start. */
  function walk(map: StrategicMap, units: Unit[], unit: Unit, goal: { x: number; y: number; w: number; h: number }, limit = 20): Point[] {
    const steps: Point[] = [];
    let u = unit;
    let all = units;
    for (let i = 0; i < limit; i++) {
      const step = nextStepToward(map, all, u, goal);
      if (!step) break;
      steps.push(step);
      // The walker stands at its new square in the list too: the board tells units apart by object, not id.
      const moved = { ...u, ...step };
      all = all.map((v) => (v === u ? moved : v));
      u = moved;
    }
    return steps;
  }

  it("the test maps are what the tests assume", () => {
    expect([...terrainSquares(corridor)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4].map((y) => squareIndex(corridor, 5, y)));
    const block = [];
    for (let y = 1; y <= 3; y++) for (let x = 6; x <= 8; x++) block.push(squareIndex(blob, x, y));
    expect([...terrainSquares(blob)].sort((a, b) => a - b)).toEqual(block);
  });

  it("takes the first step of the shortest walk around terrain", () => {
    const infantry = unit("infantry-1", 2, 0);
    const first = nextStepToward(corridor, [infantry], infantry, sq(8, 0));
    // Every shortest route goes down toward the gap at the bottom, never straight at the hill.
    expect(first?.y).toBe(1);
    const steps = walk(corridor, [infantry], infantry, sq(8, 0));
    expect(steps).toHaveLength(9);
    let prev: Point = infantry;
    for (const p of steps) {
      expect(Math.max(Math.abs(p.x - prev.x), Math.abs(p.y - prev.y))).toBe(1);
      expect(isBlocked(corridor, p.x, p.y)).toBe(false);
      prev = p;
    }
    expect(steps.some((p) => p.x === 5 && p.y === 5)).toBe(true);
    const last = steps.at(-1)!;
    expect(Math.max(Math.abs(last.x - 8), Math.abs(last.y - 0))).toBe(1);
  });

  it("never steps onto another unit and does not count itself as being in the way", () => {
    const infantry = unit("infantry-1", 2, 2);
    const tank = unit("tank-1", 3, 1); // covers 3-4 x 1-2, the goal square under it
    expect(nextStepToward(blob, [infantry, tank], infantry, sq(4, 2))).toEqual({ x: 3, y: 3 });
    const destroyedTank = { ...tank, hits: 3 };
    expect(nextStepToward(blob, [infantry, destroyedTank], infantry, sq(4, 2))).toEqual({ x: 3, y: 2 });
    const enemyInfantry = unit("infantry-9", 3, 2);
    expect(nextStepToward(blob, [infantry, enemyInfantry], infantry, sq(5, 2))).not.toEqual({ x: 3, y: 2 });
  });

  it("stays put when already touching the goal", () => {
    const infantry = unit("infantry-1", 2, 2);
    expect(nextStepToward(blob, [infantry], infantry, sq(3, 3))).toBeNull();
    expect(nextStepToward(blob, [infantry], infantry, { x: 3, y: 0, w: 3, h: 3 })).toBeNull();
  });

  it("edges toward an unreachable goal as the crow flies, and stays when no step helps", () => {
    const far = unit("infantry-1", 2, 2);
    expect(nextStepToward(blob, [far], far, sq(7, 2))).toEqual({ x: 3, y: 2 });
    const stuck = unit("infantry-1", 5, 2);
    expect(nextStepToward(blob, [stuck], stuck, sq(7, 2))).toBeNull();
  });

  it("plans only so far ahead, then heads the right way", () => {
    const infantry = unit("infantry-1", 2, 0);
    expect(nextStepToward(corridor, [infantry], infantry, sq(8, 0), 2)).toEqual({ x: 3, y: 0 });
    expect(nextStepToward(corridor, [infantry], infantry, sq(8, 0), 9)?.y).toBe(1);
  });
});

describe("automatic infantry", () => {
  it("attacks an enemy it is touching for 1 damage, a fighting unit before a wall", () => {
    const g = scenario([unit("fort-1", 5, 8), unit("infantry-1", 15, 9)], [unit("wall-1", 16, 9), unit("tank-1", 15, 10)]);
    const a = beginStrategicTurn(g);
    expect(find(a, 1, "tank-1")?.hits).toBe(1);
    expect(find(a, 1, "wall-1")?.hits).toBe(0);
    expect(at(find(a, 0, "infantry-1"))).toEqual({ x: 15, y: 9 });
    expect(events(a)).toEqual([
      { kind: "melee", turn: 1, player: 0, unitId: "infantry-1", targetId: "tank-1", targetType: "tank", damage: 1, destroyed: false },
    ]);
    expect(a.phase).toBe("turn");
  });

  it("picks the touching enemy with the fewest hit points left, then the first in unit order", () => {
    const g = scenario([unit("infantry-1", 15, 9)], [unit("tank-1", 15, 10), unit("tank-2", 13, 10, 2)]);
    const a = infantryStep(g, 0, "infantry-1");
    expect(find(a, 1, "tank-2")?.hits).toBe(3);
    expect(find(a, 1, "tank-1")?.hits).toBe(0);
    expect(events(a).at(-1)).toMatchObject({ kind: "melee", targetId: "tank-2", destroyed: true });
    const tie = infantryStep(scenario([unit("infantry-1", 15, 9)], [unit("tank-2", 13, 10), unit("tank-1", 15, 10)]), 0, "infantry-1");
    expect(find(tie, 1, "tank-2")?.hits).toBe(1);
  });

  it("closes in on an enemy its side can see two squares away and attacks once touching", () => {
    // The fort sees 4 squares beyond its edge, so it spots the enemy the infantry (sight 1) cannot.
    const g = scenario([unit("fort-1", 5, 8), unit("infantry-1", 9, 9)], [unit("infantry-1", 11, 9)]);
    const a = beginStrategicTurn(g);
    expect(at(find(a, 0, "infantry-1"))).toEqual({ x: 10, y: 9 });
    expect(find(a, 1, "infantry-1")?.hits).toBe(1);
    expect(events(a)).toEqual([
      { kind: "move", turn: 1, player: 0, unitId: "infantry-1", type: "infantry", from: { x: 9, y: 9 }, to: { x: 10, y: 9 }, riders: [] },
      { kind: "melee", turn: 1, player: 0, unitId: "infantry-1", targetId: "infantry-1", targetType: "infantry", damage: 1, destroyed: true },
    ]);
  });

  it("ignores an enemy two squares away that nobody on its side can see", () => {
    const g = scenario([unit("infantry-1", 9, 9)], [unit("infantry-1", 11, 9)]);
    const a = beginStrategicTurn(g);
    expect(find(a, 1, "infantry-1")?.hits).toBe(0);
    expect(find(a, 0, "infantry-1")?.x).toBe(10); // off toward the enemy half instead
    expect(events(a).every((e) => e.kind === "move")).toBe(true);
  });

  it("stays where it is when no free square brings a seen enemy nearer", () => {
    const mine = [unit("fort-1", 5, 8), unit("infantry-1", 9, 9), unit("wall-1", 10, 8, 0, true), unit("wall-2", 10, 10)];
    const g = scenario(mine, [unit("infantry-1", 11, 9)]);
    const a = beginStrategicTurn(g);
    expect(at(find(a, 0, "infantry-1"))).toEqual({ x: 9, y: 9 });
    expect(find(a, 1, "infantry-1")?.hits).toBe(0);
    expect(events(a)).toEqual([]);
  });

  it("walks toward the enemy fort once its owner has seen it", () => {
    const theirs = [unit("fort-1", 34, 11)];
    const known = scenario([unit("infantry-1", 24, 13)], theirs);
    known.strategic!.lastSeen[0] = [{ id: "fort-1", type: "fort", x: 34, y: 11, upright: false, state: "normal", hp: 6, turn: 0 }];
    expect(find(beginStrategicTurn(known), 0, "infantry-1")?.x).toBe(25);
    // Unseen, the nearest unexplored square of the enemy half is straight up instead.
    const unknown = scenario([unit("infantry-1", 24, 13)], theirs);
    expect(at(find(beginStrategicTurn(unknown), 0, "infantry-1"))).toEqual({ x: 24, y: 12 });
    // In sight counts as seen too.
    const inSight = scenario([unit("tank-1", 30, 12), unit("infantry-1", 24, 13)], theirs);
    expect(find(beginStrategicTurn(inSight), 0, "infantry-1")?.x).toBe(25);
  });

  it("otherwise heads for the nearest unexplored open square of the enemy half, around terrain", () => {
    // From (15,9) the central forest (x 18-21, y 8-11) is in the way of the nearest such square, (20,7).
    let g = scenario([unit("infantry-1", 15, 9)], []);
    const first = find(beginStrategicTurn(g), 0, "infantry-1");
    expect(first?.x).toBe(16);
    expect(first?.y).toBeLessThanOrEqual(9);
    const trail: Point[] = [];
    for (let own = 0; own < 8; own++) {
      g = beginStrategicTurn(g);
      expectSound(g);
      trail.push(at(find(g, 0, "infantry-1")));
      g = nextTurn(nextTurn(g));
    }
    expect(trail.at(-1)!.x).toBeGreaterThanOrEqual(20);
    expect(trail.every((p) => !isBlocked(medium, p.x, p.y))).toBe(true);
    expect(new Set(trail.map((p) => `${p.x},${p.y}`)).size).toBe(trail.length); // never doubles back
  });

  it("heads for the middle of the enemy half, not the hidden enemy base, once the whole enemy half is explored", () => {
    // The enemy half's middle is (30,10), a 2 x 2 block over squares 29-30 x 9-10; from (25,5) the
    // only shortest way to touch it is three steps down and to the right.
    const g = scenario([unit("infantry-1", 25, 5)], []);
    g.strategic!.explored[0] = encodeExplored(new Set(Array.from({ length: medium.w * medium.h }, (_, i) => i)), medium);
    expect(at(find(beginStrategicTurn(g), 0, "infantry-1"))).toEqual({ x: 26, y: 6 });
    // Wherever the enemy base really is, the walk is the same.
    for (const base of [{ x: 24, y: 8 }, { x: 27, y: 1 }, { x: 26, y: 13 }]) {
      const moved = structuredClone(g);
      moved.strategic!.bases[1] = base;
      expect(at(find(beginStrategicTurn(moved), 0, "infantry-1"))).toEqual({ x: 26, y: 6 });
    }
    // Player 2's infantry head for the middle of the left half, (10,10), the same way turned round.
    const theirs = scenario([], [unit("infantry-1", 14, 14)], 2);
    theirs.strategic!.explored[1] = encodeExplored(new Set(Array.from({ length: medium.w * medium.h }, (_, i) => i)), medium);
    expect(at(find(beginStrategicTurn(theirs), 1, "infantry-1"))).toEqual({ x: 13, y: 13 });
  });

  it("plans its walk round only the units its side knows of, so its route never bends round an enemy in the fog", () => {
    const fort = unit("fort-1", 34, 11);
    const known = (theirs: Unit[]): Game => {
      const g = scenario([unit("infantry-1", 14, 14)], theirs);
      g.strategic!.lastSeen[0] = [{ id: "fort-1", type: "fort", x: 34, y: 11, upright: false, state: "normal", hp: 6, turn: 0 }];
      return g;
    };
    // An upright enemy wall five squares off (squares 19 x 12-13), out of the infantry's sight.
    const hiddenWall = unit("wall-1", 19, 12, 0, true);
    const g = known([fort, hiddenWall]);
    expect(visibleSquares(g.players[0].units, medium).has(12 * medium.w + 19)).toBe(false);
    const open = at(find(beginStrategicTurn(known([fort])), 0, "infantry-1"));
    expect(open).toEqual({ x: 15, y: 14 });
    expect(at(find(beginStrategicTurn(g), 0, "infantry-1"))).toEqual(open);
    // Planned round every unit on the map, the hidden wall would have turned that first step.
    const all = [...g.players[0].units, ...g.players[1].units];
    expect(nextStepToward(medium, all, g.players[0].units[0]!, rectOf(fort))).toEqual({ x: 15, y: 15 });
  });

  it("waits beside its own truck for a lift, but still fights and still marches when the truck is further off", () => {
    // infantry-1 touches the truck (corner), infantry-2 is two squares from it; nobody is in sight.
    const g = scenario([unit("truck-1", 8, 8), unit("infantry-1", 7, 7), unit("infantry-2", 11, 9)], []);
    const a = beginStrategicTurn(g);
    expect(at(find(a, 0, "infantry-1"))).toEqual({ x: 7, y: 7 });
    expect(at(find(a, 0, "infantry-2"))).not.toEqual({ x: 11, y: 9 });
    // An enemy next to the waiting infantry is attacked all the same.
    const fight = scenario([unit("truck-1", 8, 8), unit("infantry-1", 7, 7)], [unit("infantry-1", 6, 6)]);
    const b = beginStrategicTurn(fight);
    expect(b.players[1].units[0]!.hits).toBe(1);
    // A destroyed truck is no reason to wait.
    const wreck = scenario([unit("truck-1", 8, 8, 2), unit("infantry-1", 7, 7)], []);
    expect(at(find(beginStrategicTurn(wreck), 0, "infantry-1"))).not.toEqual({ x: 7, y: 7 });
    // The waiting infantry rides along when the truck moves.
    const loaded = scenario([unit("truck-1", 8, 8), unit("infantry-1", 7, 7)], []);
    expect(ridersFor(beginStrategicTurn(loaded), "truck-1")).toEqual(["infantry-1"]);
  });

  it("stays put when boxed in", () => {
    const mine = [unit("infantry-1", 0, 0), unit("wall-1", 1, 0), unit("tank-1", 0, 1)];
    const g = scenario(mine, []);
    const a = beginStrategicTurn(g);
    expect(a.players[0].units).toEqual(mine);
    expect(events(a)).toEqual([]);
    expect(a.strategic!.autoDoneTurn).toBe(1);
  });

  it("a blow that fells the enemy fort ends the game at once and stops the rest of the turn", () => {
    const mine = [unit("fort-1", 5, 8), unit("infantry-1", 33, 10), unit("infantry-2", 15, 9)];
    const g = scenario(mine, [unit("fort-1", 34, 11, 5)], 3);
    g.strategic!.orders = { "tank-1": { moved: true, fired: false } };
    const a = beginStrategicTurn(g);
    expect(a.phase).toBe("over");
    expect(a.winner).toBe(0);
    expect(find(a, 1, "fort-1")?.hits).toBe(6);
    expect(at(find(a, 0, "infantry-2"))).toEqual({ x: 15, y: 9 }); // never got its go
    expect(find(a, 0, "infantry-3")).toBeUndefined(); // no spawn either
    expect(a.strategic!.orders).toEqual({});
    expect(events(a)).toEqual([
      { kind: "melee", turn: 3, player: 0, unitId: "infantry-1", targetId: "fort-1", targetType: "fort", damage: 1, destroyed: true },
      { kind: "fort-destroyed", turn: 3, player: 1, by: 0 },
    ]);
    expect(beginStrategicTurn(a)).toBe(a);
    expect(endStrategicTurn(a)).toEqual({ ok: false, reason: "wrong_phase" });
  });

  it("acts in unit order, and a fallen enemy is neither attacked again nor in the way", () => {
    // Both touch the same enemy; the first fells it, so the second walks on instead.
    const g = scenario([unit("infantry-1", 10, 9), unit("infantry-2", 10, 10)], [unit("infantry-1", 11, 9)]);
    const a = beginStrategicTurn(g);
    expect(find(a, 1, "infantry-1")?.hits).toBe(1);
    expect(events(a).map((e) => (e.kind === "melee" || e.kind === "move" ? `${e.kind} ${e.unitId}` : e.kind))).toEqual([
      "melee infantry-1",
      "move infantry-2",
    ]);
    expect(at(find(a, 0, "infantry-1"))).toEqual({ x: 10, y: 9 });
    expect(find(a, 0, "infantry-2")?.x).toBe(11);
    expectSound(a);
  });
});

describe("fort spawns", () => {
  const myFort = unit("fort-1", 5, 8); // squares 5-7 x 8-10; the middle of the map is (20, 10)
  const theirFort = unit("fort-1", 34, 11); // squares 34-36 x 11-13

  it("sends nobody on the owner's first turn and one infantry a turn from the second, nearest the middle of the map", () => {
    const first = beginStrategicTurn(scenario([myFort], [theirFort], 1));
    expect(first.players[0].units).toHaveLength(1);
    expect(first.strategic!.nextInfantry).toEqual([3, 3]);
    expect(events(first)).toEqual([]);
    const second = beginStrategicTurn(scenario([myFort], [theirFort], 3));
    expect(second.players[0].units.map((u) => u.id)).toEqual(["fort-1", "infantry-3"]);
    expect(find(second, 0, "infantry-3")).toEqual(unit("infantry-3", 8, 9));
    expect(second.strategic!.nextInfantry).toEqual([4, 3]);
    expect(events(second)).toEqual([{ kind: "spawn", turn: 3, player: 0, unitId: "infantry-3", at: { x: 8, y: 9 } }]);
    // Player 2: nothing on Game.turn 2 (their first), one on turn 4, on their side facing the middle.
    expect(beginStrategicTurn(scenario([myFort], [theirFort], 2)).players[1].units).toHaveLength(1);
    const theirs = beginStrategicTurn(scenario([myFort], [theirFort], 4));
    expect(find(theirs, 1, "infantry-3")).toEqual(unit("infantry-3", 33, 10));
    expect(theirs.strategic!.nextInfantry).toEqual([3, 4]);
    expect(theirs.players[0].units).toHaveLength(1);
  });

  it("faces the middle of the map wherever the enemy base is, skipping terrain", () => {
    // A fort up by the hill at the top of the centre line: squares 14-16 x 1-3. The nearest ring
    // squares to the middle, (17,3) and (17,4), are hill, so the newcomer takes (16,4) below.
    const fort = unit("fort-1", 14, 1);
    expect(isBlocked(medium, 17, 3) && isBlocked(medium, 17, 4)).toBe(true);
    const g = scenario([fort], [theirFort], 3);
    expect(at(find(spawnInfantry(g, 0), 0, "infantry-3"))).toEqual({ x: 16, y: 4 });
    for (const base of [{ x: 24, y: 8 }, { x: 27, y: 1 }, { x: 26, y: 13 }, { x: 2, y: 1 }]) {
      const moved = structuredClone(g);
      moved.strategic!.bases[1] = base;
      expect(spawnInfantry(moved, 0).players[0].units).toEqual(spawnInfantry(g, 0).players[0].units);
    }
  });

  it("takes the next free ring square when the nearest is taken, and numbers infantry on from 3", () => {
    const g = scenario([myFort, unit("wall-1", 8, 9)], [theirFort], 3);
    const a = beginStrategicTurn(g);
    expect(at(find(a, 0, "infantry-3"))).toEqual({ x: 8, y: 10 });
    const b = beginStrategicTurn(nextTurn(nextTurn(a)));
    expect(b.players[0].units.filter((u) => u.type === "infantry").map((u) => u.id)).toEqual(["infantry-3", "infantry-4"]);
    expect(b.strategic!.nextInfantry).toEqual([5, 4]); // player 2's fort sent one out on their turn in between
  });

  it("sends nobody when the ring is full or the fort has fallen", () => {
    const ring: Unit[] = [];
    for (let y = 7; y <= 11; y++) for (let x = 4; x <= 8; x++) if (x < 5 || x > 7 || y < 8 || y > 10) ring.push(unit(`infantry-${10 + ring.length}`, x, y));
    expect(ring).toHaveLength(16);
    const full = scenario([myFort, ...ring], [theirFort], 3);
    const a = spawnInfantry(full, 0);
    expect(a.players[0].units).toHaveLength(17);
    expect(a.strategic!.nextInfantry).toEqual([3, 3]);
    expect(events(a)).toEqual([]);
    // One square freed: the spawn takes it, whatever its place in the ring.
    const gap = scenario([myFort, ...ring.filter((u) => !(u.x === 4 && u.y === 7))], [theirFort], 3);
    expect(at(find(spawnInfantry(gap, 0), 0, "infantry-3"))).toEqual({ x: 4, y: 7 });
    const fallen = scenario([{ ...myFort, hits: 6 }], [theirFort], 3);
    expect(spawnInfantry(fallen, 0)).toBe(fallen);
    const noFort = scenario([unit("tank-1", 5, 8)], [theirFort], 3);
    expect(spawnInfantry(noFort, 0)).toBe(noFort);
  });

  it("a new infantry waits for the next turn, by when the ring square is free again", () => {
    const a = beginStrategicTurn(scenario([myFort], [theirFort], 3));
    expect(events(a).map((e) => e.kind)).toEqual(["spawn"]);
    expect(at(find(a, 0, "infantry-3"))).toEqual({ x: 8, y: 9 });
    const b = beginStrategicTurn(nextTurn(nextTurn(a)));
    expect(at(find(b, 0, "infantry-3"))).not.toEqual({ x: 8, y: 9 });
    expect(find(b, 0, "infantry-3")?.x).toBe(9);
    expect(at(find(b, 0, "infantry-4"))).toEqual({ x: 8, y: 9 });
    expectSound(b);
  });
});

describe("beginStrategicTurn", () => {
  it("runs once per turn, clearing the orders, and leaves other phases and modes alone", () => {
    const g = structuredClone(fresh);
    g.strategic!.autoDoneTurn = 0;
    g.strategic!.orders = { "tank-1": { moved: true, fired: false } };
    const a = beginStrategicTurn(g);
    expect(a).not.toBe(g);
    expect(a.strategic!.orders).toEqual({});
    expect(a.strategic!.autoDoneTurn).toBe(1);
    expect(beginStrategicTurn(a)).toBe(a);
    a.strategic!.orders = { "tank-1": { moved: true, fired: true } };
    expect(beginStrategicTurn(a)).toBe(a);
    expect(g.strategic!.orders).toEqual({ "tank-1": { moved: true, fired: false } }); // the original is untouched
    const handoff = ok(endStrategicTurn(a));
    expect(beginStrategicTurn(handoff)).toBe(handoff);
    const skirmish = createGame({ seed: 1, mode: "skirmish" });
    expect(beginStrategicTurn(skirmish)).toBe(skirmish);
  });

  it("moves the player's infantry out on turn 1 and looks around afterwards", () => {
    const g = structuredClone(fresh);
    g.strategic!.autoDoneTurn = 0;
    const a = beginStrategicTurn(g);
    const before = g.players[0].units.filter((u) => u.type === "infantry");
    const after = a.players[0].units.filter((u) => u.type === "infantry");
    expect(after).toHaveLength(2);
    expect(after.some((u, i) => u.x !== before[i]!.x || u.y !== before[i]!.y)).toBe(true);
    expect(a.players[1].units).toEqual(g.players[1].units);
    const explored = decodeExplored(a.strategic!.explored[0], medium);
    for (const i of visibleSquares(a.players[0].units, medium)) expect(explored.has(i)).toBe(true);
    for (const i of decodeExplored(g.strategic!.explored[0], medium)) expect(explored.has(i)).toBe(true);
    expectSound(a);
  });

  it("over ten turns keeps every unit on the map, off terrain and apart, numbers spawns in order, and repeats exactly for a seed", () => {
    const play = (seed: number): Game => {
      let g = inTurn(seed);
      for (let turn = 1; turn <= 10; turn++) {
        if (turn > 1) g = ok(confirmHandoff(g));
        expect(g.turn).toBe(turn);
        g = beginStrategicTurn(g);
        expect(g.strategic!.autoDoneTurn).toBe(turn);
        const map = mapOfGame(g);
        expectSound(g, map);
        const explored = decodeExplored(g.strategic!.explored[g.current], map);
        for (const i of visibleSquares(g.players[g.current].units, map)) expect(explored.has(i)).toBe(true);
        g = ok(endStrategicTurn(g));
      }
      return g;
    };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = play(seed);
      expect(g.phase).toBe("handoff");
      expect(g.turn).toBe(11);
      for (const p of [0, 1] as PlayerIndex[]) {
        // Player 1 may spawn on Game.turns 3, 5, 7 and 9, player 2 on 4, 6, 8 and 10.
        const spawned = events(g).flatMap((e) => (e.kind === "spawn" && e.player === p ? [e.unitId] : []));
        expect(spawned.length).toBeGreaterThan(0);
        expect(spawned.length).toBeLessThanOrEqual(4);
        expect(spawned).toEqual(spawned.map((_, i) => `infantry-${3 + i}`));
        expect(g.strategic!.nextInfantry[p]).toBe(3 + spawned.length);
        const ids = g.players[p].units.map((u) => u.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
      const infantry = g.players[0].units.filter((u) => u.type === "infantry");
      expect(infantry.every((u) => u.x >= g.strategic!.bases[0].x)).toBe(true);
    }
    expect(play(3)).toEqual(play(3));
    expect(play(3).players[0].units).not.toEqual(play(4).players[0].units);
  });
});
