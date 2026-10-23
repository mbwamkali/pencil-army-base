import { beforeAll, describe, expect, it } from "vitest";
import { Rng, confirmHandoff, createGame, finishBuild, randomLayout, rectOf, typeOfId, type Game, type PlayerIndex, type Unit } from "../src/rules/index.ts";
import {
  BASE_GRID,
  aimProblem,
  armiesAt,
  beginStrategicTurn,
  centreOf,
  clipTrack,
  drawnUnit,
  encodeExplored,
  endStrategicTurn,
  fireArtillery,
  fireTank,
  footprintAt,
  isAlive,
  lookAround,
  mapOf,
  matchReplay,
  moveUnit,
  pointInSight,
  reachableFor,
  replayFor,
  shakeRadius,
  shotForViewer,
  squaresOfRect,
  strategicView,
  tankTargets,
  unitSeen,
  unitTracks,
  visibleSquares,
  type DrawnUnit,
  type Point,
  type Replay,
  type ReplayMark,
  type ReplayStep,
  type StrategicEvent,
  type StrategicView,
} from "../src/strategic/rules/index.ts";

const medium = mapOf("medium-1");

function ok(r: { ok: boolean; game?: Game; reason?: string }): Game {
  if (!r.ok) throw new Error(r.reason);
  return r.game!;
}

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

/** A unit at a map square; the type comes from the id ("tank-2" is a tank). */
const unit = (id: string, x: number, y: number, hits = 0, upright = false): Unit => ({ id, type: typeOfId(id) as Unit["type"], x, y, upright, hits });

/** Both bases built at random, waiting on the handoff screen before player 1's first turn. */
function built(seed: number): Game {
  let g = createGame({ seed, mode: "strategic" });
  g = randomLayout(g, 0);
  g = ok(finishBuild(g, 0));
  g = ok(confirmHandoff(g));
  g = randomLayout(g, 1);
  return ok(finishBuild(g, 1));
}

const fresh = ok(confirmHandoff(built(1)));

/**
 * A Strategic game on the Medium map with hand-placed armies, recorded as the starting armies so
 * replays can rebuild it. Player 1's base is at (2,7) and player 2's at (26,7); each knows only their
 * own base plus what their units see. Odd Game.turns belong to player 1, whose automatic phase for
 * this turn counts as done (enemyAuto runs it).
 */
function scenario(p0: Unit[], p1: Unit[], turn = 1): Game {
  const g = structuredClone(fresh);
  const s = g.strategic!;
  g.players[0].units = structuredClone(p0);
  g.players[1].units = structuredClone(p1);
  g.turn = turn;
  g.current = turn % 2 === 1 ? 0 : 1;
  const baseOnly = (p: PlayerIndex) => encodeExplored(new Set(squaresOfRect({ ...s.bases[p], ...BASE_GRID }, medium)), medium);
  s.explored = [baseOnly(0), baseOnly(1)];
  s.lastSeen = [[], []];
  s.orders = {};
  s.autoDoneTurn = turn;
  s.events = [];
  s.shots = [];
  s.nextShot = 1;
  s.nextInfantry = [3, 3];
  s.start = [structuredClone(p0), structuredClone(p1)];
  return lookAround(lookAround(g, 0), 1);
}

/** Runs the current player's automatic start of turn (infantry, fort spawn) that scenario skipped. */
function enemyAuto(g: Game): Game {
  const h = structuredClone(g);
  h.strategic!.autoDoneTurn = 0;
  return beginStrategicTurn(h);
}

/** End the turn and let the other player tap Start: their automatic phase runs. */
const handover = (g: Game): Game => ok(confirmHandoff(ok(endStrategicTurn(g))));

/** The widest shake on Medium. */
const WIDEST_SHAKE = shakeRadius(Math.hypot(medium.w, medium.h));

/** The first Rng state whose shell barely drifts (under a tenth of a square at any range), so a test can aim exactly. */
function steadyState(from = 1): number {
  for (let state = from; ; state++) if (WIDEST_SHAKE * Math.sqrt(new Rng(state).next()) < 0.1) return state;
}
const STEADY = steadyState();

/** Fire a shell that lands within a tenth of a square of the aim. */
const shell = (g: Game, gunId: string, aim: Point): Game => ok(fireArtillery({ ...g, rngState: STEADY }, gunId, aim));

const texts = (r: Replay): string[] => r.steps.map((s) => s.text);
const tracksOf = (step: ReplayStep) => step.marks.filter((m): m is Extract<ReplayMark, { kind: "track" }> => m.kind === "track");
const centre = (u: { type: Unit["type"]; x: number; y: number; upright: boolean }): Point => centreOf(rectOf(u));

/** A drawn unit back as a rules unit, to check what it could see. */
const asUnit = (d: DrawnUnit): Unit => ({ id: d.id, type: d.type, x: d.x, y: d.y, upright: d.upright, hits: d.maxHp - d.hp });

/** Every point along a straight line, a tenth of a square apart, as the replay samples it. */
function samples(a: Point, b: Point): Point[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1 - 1e-9));
  return Array.from({ length: n + 1 }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }));
}

describe("recording", () => {
  it("startStrategic records both armies as they land on the map, as a copy", () => {
    const g = built(3);
    const s = g.strategic!;
    expect(s.start).toEqual([g.players[0].units, g.players[1].units]);
    expect(s.start![0]).not.toBe(g.players[0].units);
    expect(s.start![0]![0]).not.toBe(g.players[0].units[0]);
    // Turn 1's infantry step changes the units but never the starting armies.
    const t = ok(confirmHandoff(g));
    expect(t.strategic!.start).toEqual(s.start);
    expect(armiesAt(t, 0)).toEqual(s.start);
    expect(t.strategic!.events.length).toBeGreaterThan(0);
  });

  it("moveUnit records where each rider went, in the same order as the riders", () => {
    const g = movesScenario();
    const truck = g.strategic!.events.find((e): e is Extract<StrategicEvent, { kind: "move" }> => e.kind === "move" && e.unitId === "truck-1")!;
    expect(truck.riders).toEqual(["infantry-1", "infantry-2"]);
    expect(truck.riderMoves!.map((r) => r.unitId)).toEqual(truck.riders);
    expect(truck.riderMoves!.map((r) => r.from)).toEqual([
      { x: 38, y: 4 },
      { x: 38, y: 5 },
    ]);
    for (const r of truck.riderMoves!) {
      const u = g.players[0].units.find((v) => v.id === r.unitId)!;
      expect(r.to).toEqual({ x: u.x, y: u.y });
    }
    // A tank carries nobody, and says so.
    const tank = g.strategic!.events.find((e) => e.kind === "move" && e.unitId === "tank-1");
    expect(tank).toMatchObject({ riders: [], riderMoves: [] });
  });
});

/**
 * The enemy (player 1) moves four units on turn 1 where player 2 can see some of it: a fort at (33,8)
 * and a tank at (28,13) see everything from column 25 or 26 rightward in rows 10 to 16, and the
 * columns right of 29 above that. Then player 2's turn begins.
 */
function movesScenario(): Game {
  const viewer = [unit("fort-1", 33, 8), unit("tank-1", 28, 13)];
  const enemy = [
    unit("fort-1", 3, 9),
    unit("tank-1", 26, 10), // in sight, stays in sight
    unit("tank-2", 22, 12), // in the fog, comes out
    unit("tank-3", 25, 15), // in sight, goes into the fog
    unit("truck-1", 36, 4),
    unit("infantry-1", 38, 4), // out of sight, rides into sight
    unit("infantry-2", 38, 5), // in sight, rides
  ];
  let g = scenario(enemy, viewer);
  g = ok(moveUnit(g, "tank-1", { x: 29, y: 11 }));
  g = ok(moveUnit(g, "tank-2", { x: 25, y: 12 }));
  g = ok(moveUnit(g, "tank-3", { x: 22, y: 13 }));
  g = ok(moveUnit(g, "truck-1", { x: 31, y: 5 }));
  return handover(g);
}

describe("armiesAt and unitTracks", () => {
  it("rebuilds every moment of a hand-made turn and lists each mover's track", () => {
    const g = movesScenario();
    const s = g.strategic!;
    expect(armiesAt(g, s.events.length)).toEqual([g.players[0].units, g.players[1].units]);
    expect(armiesAt(g, 0)).toEqual(s.start);
    const afterFirst = armiesAt(g, 1)!;
    expect(afterFirst[0].find((u) => u.id === "tank-1")).toMatchObject({ x: 29, y: 11 });
    expect(afterFirst[0].find((u) => u.id === "tank-2")).toMatchObject({ x: 22, y: 12 });
    const tracks = unitTracks(g);
    expect(tracks.map((t) => `${t.owner}:${t.unitId}`)).toEqual(["0:tank-1", "0:tank-2", "0:tank-3", "0:truck-1", "0:infantry-1", "0:infantry-2"]);
    expect(tracks[0]).toEqual({ unitId: "tank-1", owner: 0, type: "tank", points: [{ x: 27, y: 11 }, { x: 30, y: 12 }] });
    const rider = tracks.find((t) => t.unitId === "infantry-1")!;
    const now = g.players[0].units.find((u) => u.id === "infantry-1")!;
    expect(rider.points).toEqual([{ x: 38.5, y: 4.5 }, centre(now)]);
  });

  it("has nothing to rebuild for a game saved before the starting armies were recorded", () => {
    const g = movesScenario();
    delete g.strategic!.start;
    expect(armiesAt(g, 0)).toBeNull();
    expect(unitTracks(g)).toEqual([]);
    const r = replayFor(g);
    expect(r).toMatchObject({ steps: [], open: false });
    expect(r.before.units).toEqual(strategicView(g, 1).units);
    expect(matchReplay(g)).toMatchObject({ steps: [], open: false });
  });
});

describe("replayFor: when it opens", () => {
  it("stays closed on the first two turns of a fresh game, when nothing of the enemy is seen", () => {
    const g1 = fresh;
    const r1 = replayFor(g1);
    expect(r1.open).toBe(false);
    // Player 1's infantry marched at the start of turn 1: listed, but marching alone never opens it.
    expect(r1.steps.length).toBeGreaterThan(0);
    expect(r1.steps.every((s) => s.part === "own" && s.text.startsWith("Your infantry marched"))).toBe(true);
    const g2 = handover(g1);
    const r2 = replayFor(g2);
    expect(r2.open).toBe(false);
    expect(r2.steps.every((s) => s.part === "own")).toBe(true);
  });

  it("opens for an enemy shell on ground the viewer knows, and shows where it fell", () => {
    let g = scenario([unit("fort-1", 3, 9), unit("artillery-1", 12, 0)], [unit("fort-1", 33, 8)]);
    g = handover(shell(g, "artillery-1", { x: 28.5, y: 9.5 }));
    const r = replayFor(g);
    expect(r.open).toBe(true);
    expect(texts(r)).toEqual(["A shell landed near your units"]);
    const [step] = r.steps;
    const shot = g.strategic!.shots[0]!;
    expect(step!.part).toBe("enemy");
    expect(step!.marks).toEqual([{ kind: "shot", shotId: 1, weapon: "shell", x: shot.x, y: shot.y, from: null }]);
    expect(step!.focus).toEqual({ x: shot.x, y: shot.y });
    expect(step!.frame.lastShot).toEqual(shotForViewer(shot, 1, strategicView(g, 1).explored, medium));
    expect(step!.frame.shots.map((s) => s.id)).toEqual([1]);
    expect(r.before.shots).toEqual([]);
    expect(r.before.lastShot).toBeNull();
  });

  it("leaves out an enemy shell that fell in the viewer's fog and hurt nobody of theirs", () => {
    let g = scenario([unit("fort-1", 3, 9), unit("artillery-1", 12, 0)], [unit("fort-1", 33, 8)]);
    g = handover(shell(g, "artillery-1", { x: 16.5, y: 16.5 }));
    expect(replayFor(g)).toMatchObject({ steps: [], open: false });
  });

  it("closes once the viewer gives an order, outside a turn, and for the player who is not on", () => {
    const g = movesScenario();
    expect(replayFor(g).open).toBe(true);
    expect(replayFor(g, 0)).toMatchObject({ steps: [], open: false });
    const to = reachableFor(g, "tank-1")[0]!;
    expect(replayFor(ok(moveUnit(g, "tank-1", to)))).toMatchObject({ steps: [], open: false });
    expect(replayFor(ok(endStrategicTurn(g)), 1)).toMatchObject({ steps: [], open: false });
  });
});

describe("replayFor: enemy moves", () => {
  const g = movesScenario();
  const r = replayFor(g);

  it("says how each enemy unit moved, from the viewer's side", () => {
    expect(texts(r)).toEqual(["Enemy tank moved", "Enemy tank came out of the fog", "Enemy tank went into the fog", "Enemy truck moved with 2 infantry"]);
    expect(r.steps.every((s) => s.part === "enemy")).toBe(true);
    expect(r.open).toBe(true);
  });

  it("draws a whole track for a move seen end to end", () => {
    const [step] = r.steps;
    expect(step!.marks).toEqual([{ kind: "track", owner: 0, points: [{ x: 27, y: 11 }, { x: 30, y: 12 }] }]);
    expect(step!.moves).toEqual([{ unitId: "tank-1", owner: 0, from: { x: 26, y: 10 }, to: { x: 29, y: 11 } }]);
    expect(step!.focus).toEqual({ x: 28.5, y: 11.5 });
  });

  it("cuts a tank coming out of the fog down to the part in sight, ending at the tank", () => {
    const step = r.steps[1]!;
    const [track] = tracksOf(step);
    const visible = step.frame.visible;
    const [a, b] = track!.points as [Point, Point];
    expect(b).toEqual({ x: 26, y: 13 }); // the tank's centre at (25,12)
    expect(a).toEqual({ x: 25, y: 13 }); // where the line enters sight
    for (const p of samples(a, b)) expect(pointInSight(p, visible, medium)).toBe(true);
    // The line from its old centre (23,13) left of column 25 lies in the fog: none of it is drawn.
    expect(pointInSight({ x: 24.9, y: 13 }, visible, medium)).toBe(false);
    // It slides only along what was seen, never out of the fog.
    expect(step.moves).toEqual([{ unitId: "tank-2", owner: 0, from: { x: 24, y: 12 }, to: { x: 25, y: 12 } }]);
    expect(step.frame.enemies.map((e) => e.id)).toContain("tank-2");
  });

  it("cuts a tank going into the fog where it left sight, and drops it from the frame", () => {
    const step = r.steps[2]!;
    const [track] = tracksOf(step);
    const [a, b] = track!.points as [Point, Point];
    expect(a).toEqual({ x: 26, y: 16 });
    for (const p of samples(a, b)) expect(pointInSight(p, step.frame.visible, medium)).toBe(true);
    expect(Math.hypot(b.x - 23, b.y - 14)).toBeGreaterThan(1); // stops well short of the real spot at (23,14)
    expect(step.frame.enemies.map((e) => e.id)).not.toContain("tank-3");
    expect(r.steps[1]!.frame.enemies.map((e) => e.id)).toContain("tank-3");
  });

  it("shows the truck's riders with their own tracks", () => {
    const step = r.steps[3]!;
    expect(tracksOf(step)).toHaveLength(3);
    expect(step.moves.map((m) => m.unitId)).toEqual(["truck-1", "infantry-1", "infantry-2"]);
    for (const t of tracksOf(step)) for (const p of t.points) expect(pointInSight(p, step.frame.visible, medium)).toBe(true);
  });

  it("frames show only the enemy units in sight at that moment, and end on the live armies", () => {
    expect(r.before.enemies.map((e) => e.id).sort()).toEqual(["infantry-2", "tank-1", "tank-3", "truck-1"]);
    for (const frame of [r.before, ...r.steps.map((s) => s.frame)]) {
      for (const e of frame.enemies) {
        expect(e.current).toBe(true);
        expect(unitSeen(e, frame.visible, medium)).toBe(true);
      }
      expect(frame).toMatchObject({ orders: [], report: [], over: false, winner: null });
    }
    const live = strategicView(g, 1);
    const last = r.steps.at(-1)!.frame;
    expect(last.units).toEqual(live.units);
    expect(last.visible).toEqual(live.visible);
    expect(last.explored).toEqual(live.explored);
    expect(last.enemyBase).toEqual(live.enemyBase);
    expect(last.turnNumber).toBe(live.turnNumber);
    expect(last.enemies.map((e) => e.id).sort()).toEqual(["infantry-1", "infantry-2", "tank-1", "tank-2", "truck-1"]);
  });
});

describe("replayFor: clipping", () => {
  it("keeps the longest stretch in sight from the end the viewer saw, and drops a sliver", () => {
    // Columns 5 to 9 in sight on every row.
    const visible = new Set(Array.from({ length: medium.w * medium.h }, (_, i) => i).filter((i) => i % medium.w >= 5 && i % medium.w <= 9));
    expect(clipTrack({ x: 2, y: 3 }, { x: 7, y: 3 }, "to", visible, medium)).toEqual([
      { x: 5, y: 3 },
      { x: 7, y: 3 },
    ]);
    const out = clipTrack({ x: 7, y: 3 }, { x: 12, y: 3 }, "from", visible, medium)!;
    expect(out[0]).toEqual({ x: 7, y: 3 });
    expect(out[1].x).toBeCloseTo(10, 6);
    expect(clipTrack({ x: 4.2, y: 3 }, { x: 5.1, y: 3 }, "to", visible, medium)).toBeNull();
  });
});

/**
 * The enemy fires two tank shots and five shells at player 2's units: a fort (33,8), a tank (27,14)
 * that watches the first enemy tank, three infantry, a wall out on its own and one by the base.
 */
function shotsScenario(): Game {
  const viewer = [
    unit("fort-1", 33, 8),
    unit("tank-1", 27, 14),
    unit("infantry-3", 26, 12),
    unit("infantry-4", 30, 6),
    unit("infantry-5", 31, 6),
    unit("wall-1", 14, 7),
    unit("wall-2", 36, 13),
  ];
  const enemy = [
    unit("fort-1", 3, 9),
    unit("tank-1", 23, 12), // in sight of player 2's tank
    unit("tank-2", 11, 6), // nobody of player 2 can see it: walls see only their own squares
    unit("artillery-1", 0, 0),
    unit("artillery-2", 2, 0),
    unit("artillery-3", 12, 0),
    unit("artillery-4", 14, 0),
    unit("artillery-5", 0, 17),
  ];
  let g = scenario(enemy, viewer);
  expect(tankTargets(g, "tank-1")).toContain("infantry-3");
  g = ok(fireTank(g, "tank-1", "infantry-3"));
  g = ok(fireTank(g, "tank-2", "wall-1"));
  g = shell(g, "artillery-1", { x: 28, y: 15.2 }); // on player 2's tank
  g = shell(g, "artillery-2", { x: 34.5, y: 9.4 }); // on the fort
  g = shell(g, "artillery-3", { x: 31, y: 6.5 }); // between two infantry
  g = shell(g, "artillery-4", { x: 37, y: 13.5 }); // on the wall by the base
  g = shell(g, "artillery-5", { x: 28.5, y: 9.5 }); // on empty ground player 2 knows
  return handover(g);
}

describe("replayFor: enemy shots", () => {
  const g = shotsScenario();
  const r = replayFor(g);

  it("says what each shot did to the viewer's units", () => {
    expect(texts(r)).toEqual([
      "Enemy tank destroyed your infantry 3",
      "A tank shot hit your wall 1",
      "A shell destroyed your tank 1",
      "A shell hit your fort: 3 of 6 left",
      "A shell hit 2 of your units",
      "Your wall 2 stopped a shell",
      "A shell landed near your units",
    ]);
  });

  it("draws the line from a shooter in sight, and never from a hidden one", () => {
    const [seen, hidden, ...shells] = r.steps;
    const shotMark = (s: ReplayStep) => s.marks.find((m): m is Extract<ReplayMark, { kind: "shot" }> => m.kind === "shot")!;
    expect(shotMark(seen!).from).toEqual({ x: 24, y: 13 });
    expect(shotMark(hidden!).from).toBeNull();
    for (const s of shells) expect(shotMark(s).from).toBeNull();
    expect(seen!.frame.enemies.map((e) => e.id)).toEqual(["tank-1"]);
    expect(hidden!.frame.enemies.map((e) => e.id)).not.toContain("tank-2");
  });

  it("stops seeing through a unit from the moment it is destroyed", () => {
    // Player 2's tank watched enemy tank 1 until a shell destroyed it.
    expect(r.steps[1]!.frame.enemies.map((e) => e.id)).toEqual(["tank-1"]);
    expect(r.steps[2]!.frame.enemies).toEqual([]);
    expect(r.steps[2]!.frame.units.find((u) => u.id === "tank-1")!.state).toBe("destroyed");
    expect(r.steps[2]!.frame.lastShot!.hits.map((h) => h.unitId)).toEqual(["tank-1"]);
    expect(r.steps[2]!.frame.shots.map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

describe("replayFor: hand-to-hand fighting", () => {
  it("always shows a blow on the viewer's unit, drawing it on the victim when the attacker is out of sight", () => {
    const viewer = [unit("fort-1", 33, 8), unit("infantry-2", 28, 12), unit("wall-1", 23, 3)];
    const enemy = [unit("fort-1", 3, 9), unit("infantry-1", 27, 12), unit("infantry-2", 32, 9), unit("infantry-3", 23, 2)];
    const g = handover(enemyAuto(scenario(enemy, viewer)));
    const r = replayFor(g);
    expect(texts(r)).toEqual(["Enemy infantry destroyed your infantry 2", "Enemy infantry hit your fort: 5 of 6 left", "Enemy infantry hit your wall 1"]);
    expect(r.steps.map((s) => s.marks)).toEqual([[{ kind: "clash", at: { x: 28, y: 12.5 } }], [{ kind: "clash", at: { x: 33.5, y: 9.5 } }], [{ kind: "clash", at: { x: 24, y: 3.5 } }]]);
    // The attacker on the wall was never in sight: it shows in no frame.
    for (const s of r.steps) expect(s.frame.enemies.map((e) => `${e.id}@${e.x},${e.y}`)).not.toContain("infantry-3@23,2");
    expect(r.open).toBe(true);
  });
});

describe("replayFor: new infantry", () => {
  const viewer = (extra: Unit[]) => [unit("fort-1", 33, 8), ...extra];
  const enemy = [unit("fort-1", 14, 7)];

  it("shows the enemy fort sending out infantry only where the viewer can see it, and their own fort's always", () => {
    const seen = handover(enemyAuto(scenario(enemy, viewer([unit("tank-1", 16, 12)]), 3)));
    const r = replayFor(seen);
    expect(texts(r)).toEqual(["The enemy fort sent out infantry", "Your fort sent out infantry 3"]);
    expect(r.steps[0]!.marks).toEqual([{ kind: "spawn", at: { x: 17.5, y: 9.5 } }]);
    expect(r.steps[0]!.frame.enemies.map((e) => e.id)).toContain("infantry-3");
    expect(r.steps[1]!.part).toBe("own");
    expect(r.open).toBe(true);

    const hidden = handover(enemyAuto(scenario(enemy, viewer([]), 3)));
    const q = replayFor(hidden);
    expect(texts(q)).toEqual(["Your fort sent out infantry 3"]);
    expect(q.open).toBe(false); // the viewer's own fort sends out infantry every turn
  });

  it("keeps quiet about a spawn beside a fort still in the fog, which would give the fort away", () => {
    // The tank sees the spawn square (17,9) but not one square of the fort behind it.
    const tank = unit("tank-1", 19, 12);
    const g = handover(enemyAuto(scenario(enemy, viewer([tank]), 3)));
    const fort = g.players[0].units.find((u) => u.type === "fort")!;
    expect(visibleSquares([tank], medium).has(9 * medium.w + 17)).toBe(true);
    expect(unitSeen(fort, visibleSquares([tank], medium), medium)).toBe(false);
    expect(strategicView(g, 1).enemyBase).toBeNull();
    const r = replayFor(g);
    expect(texts(r)).toEqual(["Your fort sent out infantry 3"]);
    expect(r.steps.filter((st) => st.part === "enemy")).toEqual([]);
    expect(r.open).toBe(false);
    // The newcomer still shows in the frame as an enemy in sight, as on the turn screen.
    expect(r.steps[0]!.frame.enemies.map((e) => e.id)).toEqual(["infantry-3"]);
  });

  it("shows a spawn beside a fort the viewer found earlier, even with the fort out of sight now", () => {
    // A scout saw the fort at the start and was gone by the enemy's turn; the sighting stays.
    const scout = unit("tank-2", 16, 12);
    const tank = unit("tank-1", 19, 12);
    const g = scenario(enemy, viewer([tank, scout]), 3);
    expect(g.strategic!.lastSeen[1].map((u) => u.id)).toContain("fort-1");
    g.players[1].units = g.players[1].units.filter((u) => u.id !== scout.id);
    g.strategic!.start![1] = g.strategic!.start![1].filter((u) => u.id !== scout.id);
    const found = handover(enemyAuto(g));
    expect(strategicView(found, 1).enemyBase).not.toBeNull();
    const r = replayFor(found);
    expect(texts(r)).toEqual(["The enemy fort sent out infantry", "Your fort sent out infantry 3"]);
    expect(r.open).toBe(true);
  });
});

describe("replayFor: the viewer's own start of turn", () => {
  it("groups marching infantry into one step and opens for a fight", () => {
    const viewer = [
      unit("fort-1", 33, 8),
      unit("infantry-1", 26, 13),
      unit("infantry-4", 27, 13),
      unit("infantry-5", 28, 13),
      unit("infantry-2", 17, 8), // touching the enemy fort
      unit("infantry-3", 16, 12), // touching a badly hurt enemy tank
      unit("infantry-6", 36, 15),
    ];
    const enemy = [unit("fort-1", 14, 7, 1), unit("tank-1", 14, 13, 2)];
    const g = handover(scenario(enemy, viewer));
    const r = replayFor(g);
    expect(texts(r)).toEqual(["Your infantry marched (3)", "Infantry 2 hit the enemy fort: 4 of 6 left", "Infantry 3 destroyed an enemy tank", "Your infantry marched"]);
    expect(r.steps.every((s) => s.part === "own")).toBe(true);
    expect(tracksOf(r.steps[0]!)).toHaveLength(3);
    expect(r.steps[0]!.moves.map((m) => m.unitId)).toEqual(["infantry-1", "infantry-4", "infantry-5"]);
    expect(r.steps[1]!.marks).toEqual([{ kind: "clash", at: { x: 16.5, y: 8.5 } }]);
    expect(r.open).toBe(true);
  });

  it("groups enemy infantry marching in sight, past one that walked in the fog", () => {
    const viewer = [unit("fort-1", 33, 8), unit("tank-1", 28, 13)];
    const enemy = [unit("fort-1", 3, 9), unit("infantry-1", 25, 11), unit("infantry-2", 12, 12), unit("infantry-3", 25, 13), unit("infantry-4", 25, 16)];
    const g = handover(enemyAuto(scenario(enemy, viewer)));
    const walked = g.strategic!.events.filter((e) => e.kind === "move" && e.player === 0).map((e) => (e as { unitId: string }).unitId);
    expect(walked).toEqual(["infantry-1", "infantry-2", "infantry-3", "infantry-4"]);
    const r = replayFor(g);
    expect(texts(r)).toEqual(["Enemy infantry moved (3)"]);
    expect(r.steps[0]!.moves.map((m) => m.unitId)).toEqual(["infantry-1", "infantry-3", "infantry-4"]);
    expect(tracksOf(r.steps[0]!)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------------------------
// Simulated games: the fold invariant, the leak fuzz and the match replay over many seeds
// ---------------------------------------------------------------------------------------------

/** Where the current player's units head: the middle of the enemy base. */
function goalOf(g: Game): Point {
  const b = g.strategic!.bases[other(g.current)];
  return { x: b.x + BASE_GRID.w / 2, y: b.y + BASE_GRID.h / 2 };
}

/** Move a unit to the reachable square nearest the enemy base, if any is nearer than where it stands. */
function advance(g: Game, id: string): Game {
  const u = g.players[g.current].units.find((v) => v.id === id)!;
  const goal = goalOf(g);
  const away = (p: Point) => {
    const c = centreOf(footprintAt(u, p.x, p.y));
    return Math.hypot(c.x - goal.x, c.y - goal.y);
  };
  let best: Point | null = null;
  let bestD = away(u);
  for (const p of reachableFor(g, id)) {
    if (away(p) < bestD - 1e-9) {
      best = p;
      bestD = away(p);
    }
  }
  return best ? ok(moveUnit(g, id, best)) : g;
}

/** Shells land this far from the enemy base's middle, turn by turn, so games last but shells still hit things. */
const OFFSETS: Point[] = [
  { x: -8, y: -6 },
  { x: 7, y: 7 },
  { x: -6, y: 8 },
  { x: 9, y: -6 },
  { x: 0, y: -9 },
];

/**
 * A simple fixed policy: each tank fires at an enemy in range (a fort last), or advances and then
 * fires; the truck advances (riders and all); the artillery shells a point offset from the enemy base.
 */
function playTurn(game: Game): Game {
  let g = game;
  const p = g.current;
  for (const id of g.players[p].units.filter((u) => u.type === "tank" && isAlive(u)).map((u) => u.id)) {
    if (g.phase !== "turn") return g;
    if (tankTargets(g, id).length === 0) g = advance(g, id);
    const targets = tankTargets(g, id);
    const target = targets.find((t) => !t.startsWith("fort")) ?? targets[0];
    if (target) g = ok(fireTank(g, id, target));
  }
  for (const id of g.players[p].units.filter((u) => u.type === "truck" && isAlive(u)).map((u) => u.id)) if (g.phase === "turn") g = advance(g, id);
  for (const id of g.players[p].units.filter((u) => u.type === "artillery" && isAlive(u)).map((u) => u.id)) {
    if (g.phase !== "turn") return g;
    const goal = goalOf(g);
    const o = OFFSETS[g.turn % OFFSETS.length]!;
    const aim = { x: Math.max(0, Math.min(medium.w, goal.x + o.x)), y: Math.max(0, Math.min(medium.h, goal.y + o.y)) };
    if (aimProblem(g, id, aim) === null) g = ok(fireArtillery(g, id, aim));
  }
  return g;
}

interface Played {
  seed: number;
  /** The game at the start of each turn, just after the player tapped Start. */
  starts: Game[];
  /** The game after each turn's orders. */
  ends: Game[];
  last: Game;
}

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const TURNS = 40;

/** Plays a seeded game through the public rules for TURNS Game.turns, or until a fort falls. */
function play(seed: number): Played {
  let g = ok(confirmHandoff(built(seed)));
  const starts: Game[] = [];
  const ends: Game[] = [];
  while (g.phase === "turn" && g.turn <= TURNS) {
    starts.push(g);
    g = playTurn(g);
    ends.push(g);
    if (g.phase !== "turn") break;
    g = handover(g);
  }
  return { seed, starts, ends, last: g };
}

/** Both armies of a game, the way armiesAt returns them. */
const liveArmies = (g: Game) => [g.players[0].units, g.players[1].units];

/**
 * Checks one handover replay against the leak rule: nothing in any frame, mark, move or line may
 * show an enemy unit, track point or shot the viewer's units could not see at that moment, beyond
 * what the live turn screen shows (shots by shotForViewer). Returns what broke the rule (nothing,
 * when all is well), so thousands of checks cost one assertion.
 */
function leaks(g: Game, r: Replay, viewer: PlayerIndex): string[] {
  const s = g.strategic!;
  const enemy = other(viewer);
  const live = strategicView(g, viewer);
  const problems: string[] = [];
  const fail = (what: string) => problems.push(`turn ${g.turn} viewer ${viewer}: ${what}`);
  const first = s.events.findIndex((e) => e.turn >= g.turn - 1);
  const from = first < 0 ? s.events.length : first;
  // The armies at every moment of the replay's window, keyed by how many events had happened.
  const moments = new Map(Array.from({ length: s.events.length - from + 1 }, (_, k) => [from + k, armiesAt(g, from + k)!] as const));
  const sightAt = new Map([...moments].map(([k, armies]) => [k, visibleSquares(armies[viewer], medium)] as const));
  // Where each enemy unit stood, with its hits, at some moment one of the viewer's units saw it.
  const sightings = new Set<string>();
  const inSightEver = new Set<number>();
  for (const [k, armies] of moments) {
    const visible = sightAt.get(k)!;
    for (const i of visible) inSightEver.add(i);
    for (const u of armies[enemy]) if (unitSeen(u, visible, medium)) sightings.add(`${u.id}@${u.x},${u.y}:${u.hits}`);
  }
  const liveShotIds = new Set(live.shots.map((shot) => shot.id));
  const checkFrame = (frame: StrategicView, label: string) => {
    if (frame.viewer !== viewer) fail(`${label}: wrong viewer`);
    const own = visibleSquares(frame.units.map(asUnit), medium);
    if (own.size !== frame.visible.size || [...own].some((i) => !frame.visible.has(i))) fail(`${label}: visible is not what the viewer's units see`);
    if ([...frame.visible].some((i) => !inSightEver.has(i))) fail(`${label}: a square in sight that was never in sight`);
    for (const e of frame.enemies) {
      if (!e.current) fail(`${label}: a last-seen mark ${e.id}`);
      if (!unitSeen(e, frame.visible, medium)) fail(`${label}: ${e.id} drawn out of sight`);
      if (!sightings.has(`${e.id}@${e.x},${e.y}:${e.maxHp - e.hp}`)) fail(`${label}: ${e.id} at ${e.x},${e.y} was never seen like that`);
    }
    for (const shot of frame.shots) if (!liveShotIds.has(shot.id)) fail(`${label}: shot ${shot.id} the turn screen hides`);
    if (frame.orders.length > 0 || frame.report.length > 0 || frame.over || frame.winner !== null) fail(`${label}: orders, report or game over in a frame`);
  };
  checkFrame(r.before, "before");
  // The clash points the rule allows: midway when the attacker was in sight just before the blow, else on the victim.
  const clashes: string[] = [];
  s.events.forEach((e, i) => {
    if (i < from || e.kind !== "melee") return;
    const armies = moments.get(i)!;
    const attacker = armies[e.player].find((u) => u.id === e.unitId)!;
    const target = armies[other(e.player)].find((u) => u.id === e.targetId)!;
    const mid = { x: (centre(attacker).x + centre(target).x) / 2, y: (centre(attacker).y + centre(target).y) / 2 };
    const at = e.player === viewer || unitSeen(attacker, sightAt.get(i)!, medium) ? mid : centre(target);
    clashes.push(`${at.x},${at.y}`);
  });
  r.steps.forEach((step, n) => {
    const label = `step ${n + 1} "${step.text}"`;
    checkFrame(step.frame, label);
    const shotIds: number[] = [];
    for (const m of step.marks) {
      if (m.kind === "track") {
        if (m.points.length < 2) fail(`${label}: a track of one point`);
        if (m.owner === enemy && m.points.some((p) => !pointInSight(p, step.frame.visible, medium))) fail(`${label}: an enemy track point out of sight`);
      } else if (m.kind === "shot") {
        shotIds.push(m.shotId);
        const shot = s.shots.find((x) => x.id === m.shotId)!;
        if (shot.by !== enemy || shotForViewer(shot, viewer, live.explored, medium) === null) fail(`${label}: shot ${m.shotId} the turn screen hides`);
        if (m.from !== null) {
          const at = s.events.findIndex((e) => e.kind === "shot" && e.shotId === m.shotId);
          const shooter = moments.get(at)![enemy].find((u) => u.id === shot.unitId)!;
          if (!unitSeen(shooter, sightAt.get(at)!, medium)) fail(`${label}: a line from a shooter out of sight`);
          if (m.from.x !== centre(shooter).x || m.from.y !== centre(shooter).y) fail(`${label}: the line starts away from the shooter`);
        } else if (step.text.startsWith("Enemy tank")) fail(`${label}: names a shooter it could not see`);
      } else if (m.kind === "clash") {
        if (!clashes.includes(`${m.at.x},${m.at.y}`)) fail(`${label}: a clash at ${m.at.x},${m.at.y}`);
      } else if (step.part === "enemy") {
        if (!step.frame.visible.has(Math.floor(m.at.y) * medium.w + Math.floor(m.at.x))) fail(`${label}: a spawn out of sight`);
        // A spawn square touches the fort, so a spawn may only be told beside a fort in sight or already found.
        const fort = moments.get(from)![enemy].find((u) => u.type === "fort");
        if (!live.enemyBase && !(fort && unitSeen(fort, step.frame.visible, medium))) fail(`${label}: a spawn gives away a fort out of sight`);
      }
    }
    for (const mv of step.moves) {
      if (mv.owner !== enemy) continue;
      const u = moments.get(from)![enemy].find((v) => v.id === mv.unitId) ?? { type: "infantry" as const, upright: false };
      const { w, h } = rectOf({ ...u, x: 0, y: 0 });
      for (const p of [mv.from, mv.to]) if (!pointInSight({ x: p.x + w / 2, y: p.y + h / 2 }, step.frame.visible, medium)) fail(`${label}: ${mv.unitId} slides through the fog`);
    }
    if (step.frame.lastShot && !shotIds.includes(step.frame.lastShot.id)) fail(`${label}: lastShot is not this step's shot`);
    // About 34 characters; the longest forms ("Infantry 12 hit the enemy fort: 4 of 6 left") run to 43.
    if (step.text.length > 43) fail(`${label}: too long`);
  });
  return problems;
}

describe("simulated games", () => {
  let games: Played[] = [];
  beforeAll(() => {
    games = SEEDS.map(play);
  }, 180_000);

  it("plays at least 20 seeded games, nearly all for 40 Game.turns", () => {
    expect(games).toHaveLength(20);
    expect(games.filter((p) => p.starts.length >= TURNS).length).toBeGreaterThanOrEqual(18);
    expect(games.some((p) => p.last.phase === "over")).toBe(true);
  });

  it("rebuilds every moment exactly from the starting armies and the events (the fold invariant)", () => {
    for (const { seed, starts, ends, last } of games) {
      const snapshots = [...starts, ...ends];
      for (const g of snapshots) expect(armiesAt(g, g.strategic!.events.length), `seed ${seed} turn ${g.turn}`).toEqual(liveArmies(g));
      // The finished game alone rebuilds the armies as they stood at every earlier turn.
      for (const g of snapshots) expect(armiesAt(last, g.strategic!.events.length), `seed ${seed} turn ${g.turn} from the end`).toEqual(liveArmies(g));
    }
  }, 60_000);

  it("never leaks the fog in a handover replay, for both players at every turn", () => {
    let opened = 0;
    let steps = 0;
    for (const { starts } of games) {
      for (const g of starts) {
        const viewer = g.current;
        const r = replayFor(g);
        expect(leaks(g, r, viewer)).toEqual([]);
        if (r.open) opened += 1;
        steps += r.steps.length;
        // The player who is not on gets nothing, and the map they would get still hides the enemy.
        const off = replayFor(g, other(viewer));
        expect(off).toMatchObject({ steps: [], open: false });
        for (const e of off.before.enemies) expect(unitSeen(e, off.before.visible, medium)).toBe(true);
        // The last frame always shows the viewer's own units exactly as the turn screen does.
        if (r.steps.length > 0) expect(r.steps.at(-1)!.frame.units).toEqual(strategicView(g, viewer).units);
      }
    }
    expect(opened).toBeGreaterThan(100);
    expect(steps).toBeGreaterThan(1000);
  }, 120_000);

  it("matchReplay has one step per Game.turn and ends on the live armies, over only on the last", () => {
    const finished = games.find((p) => p.last.phase === "over")!.last;
    const r = matchReplay(finished);
    expect(r.open).toBe(true);
    expect(r.steps.map((s) => s.turn)).toEqual(Array.from({ length: finished.turn }, (_, i) => i + 1));
    expect(r.steps.map((s) => s.player)).toEqual(r.steps.map((_, i) => (i % 2 === 0 ? 0 : 1)));
    expect(r.steps[0]!.text).toBe(`Turn 1 · ${finished.players[0].name}`);
    expect(r.steps[3]!.text).toBe(`Turn 2 · ${finished.players[1].name}`);
    expect(r.steps.map((s) => s.frame.over)).toEqual(r.steps.map((_, i) => i === r.steps.length - 1));
    const last = r.steps.at(-1)!.frame;
    expect(last.units).toEqual(finished.players[0].units.map((u) => drawnUnit(u, 0)));
    expect(last.enemies).toEqual(finished.players[1].units.map((u) => drawnUnit(u, 1)));
    expect(last.winner).toBe(finished.winner);
    expect(last.shots).toHaveLength(finished.strategic!.shots.length);
    expect(r.before.units).toEqual(finished.strategic!.start![0].map((u) => drawnUnit(u, 0)));
    for (const step of r.steps) {
      const events = finished.strategic!.events.filter((e) => e.turn === step.turn);
      const moved = events.flatMap((e) => (e.kind === "move" ? [e.unitId, ...(e.riderMoves ?? []).map((m) => m.unitId)] : []));
      expect(step.moves.map((m) => m.unitId)).toEqual(moved);
      expect(tracksOf(step)).toHaveLength(moved.length);
      expect(step.marks.filter((m) => m.kind === "shot")).toHaveLength(events.filter((e) => e.kind === "shot").length);
      expect(step.frame.visible.size).toBe(0);
      expect(step.frame.explored.size).toBe(medium.w * medium.h);
      expect(step.frame.lastShot).toBeNull();
      expect(step.part).toBe("turn");
    }
    expect(matchReplay(games[0]!.starts[5]!).steps).toHaveLength(games[0]!.starts[5]!.turn);
  });

  it("unitTracks follows every unit that moved from where it started to where it stands", () => {
    for (const { last } of games.slice(0, 5)) {
      const tracks = unitTracks(last);
      expect(tracks.length).toBeGreaterThan(5);
      for (const t of tracks) {
        const now = last.players[t.owner].units.find((u) => u.id === t.unitId)!;
        expect(t.points.at(-1)).toEqual(centre(now));
        expect(t.points.length).toBeGreaterThanOrEqual(2);
        const started = last.strategic!.start![t.owner].find((u) => u.id === t.unitId);
        if (started) expect(t.points[0]).toEqual(centre(started));
      }
    }
  });
});
