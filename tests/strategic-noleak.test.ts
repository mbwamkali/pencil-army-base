import { describe, expect, it } from "vitest";
import { confirmHandoff, rectOf, typeOfId, type Game, type PlayerIndex, type Unit } from "../src/rules/index.ts";
import {
  BASE_GRID,
  beginStrategicTurn,
  encodeExplored,
  endStrategicTurn,
  fogSquareBeside,
  footprintAt,
  isAlive,
  isFree,
  key,
  lookAround,
  moveUnit,
  reachable,
  reachableFor,
  replayFor,
  ridersFor,
  ringAround,
  squareDistance,
  squaresOfRect,
  strategicView,
  unitSeen,
  validBaseSpots,
  visibleSquares,
  type Point,
} from "../src/strategic/rules/index.ts";
import { builtGame, builtOnMedium, mapOfGame, medium, ok, onMap } from "./strategic-fixtures.ts";

/**
 * The hidden enemy base must not steer anything a player can watch. Two games, identical except
 * where the other player's base stands (both spots valid, both out of sight), must give the player
 * exactly the same fort spawn, rider drops, infantry steps, turn screen and handover replay. Any
 * rule that read the true enemy base would tell the two games apart, and so would the player.
 */

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

/** The other valid spot furthest from `spot` (the first in reading order on a tie). */
function farSpot(spots: readonly Point[], spot: Point): Point {
  let best = spot;
  let bestD = -1;
  for (const s of spots) {
    const d = Math.hypot(s.x - spot.x, s.y - spot.y);
    if (d > bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * The same freshly set-up game twice, with the hidden player's base at two different valid spots,
 * waiting for `viewer` to tap Start on their second turn (so their fort sends out infantry). One of
 * the viewer's infantry stands beside their truck so it has a rider to carry.
 */
function twins(seed: number, viewer: PlayerIndex): [Game, Game] {
  const g = structuredClone(builtGame(seed));
  const s = g.strategic!;
  const map = mapOfGame(g);
  const hidden = other(viewer);
  const units = g.players[viewer].units;
  const truck = units.find((u) => u.type === "truck")!;
  const rider = units.find((u) => u.type === "infantry")!;
  const beside = ringAround(rectOf(truck)).find((p) => isFree(map, [...units, ...g.players[hidden].units], { ...p, w: 1, h: 1 }, new Set([rider])))!;
  rider.x = beside.x;
  rider.y = beside.y;
  const here = s.bases[hidden];
  const there = farSpot(validBaseSpots(map, hidden), here);
  expect(there).not.toEqual(here);
  const at = (spot: Point): Game => {
    const bases: [Point, Point] = viewer === 0 ? [s.bases[0], spot] : [spot, s.bases[1]];
    const twin = onMap(g, map.id, bases);
    twin.turn = viewer === 0 ? 3 : 4;
    twin.handoff = { to: viewer, then: "turn" };
    return twin;
  };
  return [at(here), at(there)];
}

/**
 * Everything the viewer can know or watch: their own army, their fog, what they have seen, the log
 * of their own side, the screen, the replay, and the blue reach the screen draws for each unit that
 * can move.
 */
function seenBy(g: Game, viewer: PlayerIndex) {
  const s = g.strategic!;
  const view = strategicView(g, viewer);
  return {
    units: g.players[viewer].units,
    explored: s.explored[viewer],
    lastSeen: s.lastSeen[viewer],
    events: s.events.filter((e) => e.player === viewer),
    view,
    replay: replayFor(g, viewer),
    reach: Object.fromEntries(view.orders.filter((r) => r.canMove).map((r) => [r.unitId, reachableFor(g, r.unitId)])),
  };
}

/** The viewer has seen nothing of the other side: no enemy unit, no enemy base. */
function blind(g: Game, viewer: PlayerIndex): boolean {
  const v = strategicView(g, viewer);
  return v.enemies.length === 0 && v.enemyBase === null && g.strategic!.lastSeen[viewer].length === 0;
}

describe("the hidden enemy base", () => {
  for (const viewer of [0, 1] as PlayerIndex[]) {
    it(`moving player ${other(viewer) + 1}'s unseen base changes nothing player ${viewer + 1} sees or does (12 seeds)`, () => {
      let spawned = 0;
      let rode = 0;
      let stepped = 0;
      for (const seed of SEEDS) {
        const [a, b] = twins(seed, viewer);
        expect(a.strategic!.bases[other(viewer)]).not.toEqual(b.strategic!.bases[other(viewer)]);
        expect(blind(a, viewer) && blind(b, viewer), `seed ${seed} before`).toBe(true);
        expect(seenBy(a, viewer)).toEqual(seenBy(b, viewer));

        // The start of the turn: infantry steps and the fort's new infantry.
        const startA = ok(confirmHandoff(a));
        const startB = ok(confirmHandoff(b));
        expect(blind(startA, viewer) && blind(startB, viewer), `seed ${seed} after the start of turn`).toBe(true);
        expect(seenBy(startA, viewer), `seed ${seed} start of turn`).toEqual(seenBy(startB, viewer));
        spawned += startA.strategic!.events.filter((e) => e.kind === "spawn").length;
        stepped += startA.strategic!.events.filter((e) => e.kind === "move").length;

        // The truck drives as far toward the other half as it can, setting its rider down.
        const truck = startA.players[viewer].units.find((u) => u.type === "truck")!;
        expect(ridersFor(startA, truck.id).length, `seed ${seed} riders`).toBeGreaterThan(0);
        const toward = (p: Point) => (viewer === 0 ? p.x : -p.x);
        const to = reachableFor(startA, truck.id).sort((p, q) => toward(q) - toward(p) || p.y - q.y)[0]!;
        expect(reachableFor(startB, truck.id)).toEqual(reachableFor(startA, truck.id));
        const droveA = ok(moveUnit(startA, truck.id, to));
        const droveB = ok(moveUnit(startB, truck.id, to));
        expect(blind(droveA, viewer) && blind(droveB, viewer), `seed ${seed} after the drive`).toBe(true);
        expect(seenBy(droveA, viewer), `seed ${seed} after the drive`).toEqual(seenBy(droveB, viewer));
        const move = droveA.strategic!.events.at(-1);
        rode += move?.kind === "move" ? move.riders.length : 0;
      }
      // The test really exercised each rule.
      expect(spawned).toBe(SEEDS.length);
      expect(rode).toBeGreaterThan(0);
      expect(stepped).toBeGreaterThan(0);
    });
  }
});

/** The truck's top-lefts in reach as `key` strings, planned round every living unit on the map, seen or not. */
function trueReach(g: Game, viewer: PlayerIndex, truckId: string): string[] {
  const truck = g.players[viewer].units.find((u) => u.id === truckId)!;
  return [...reachable(mapOfGame(g), [...g.players[0].units, ...g.players[1].units], truck).keys()];
}

describe("a picked unit's reach near the hidden enemy base", () => {
  for (const viewer of [0, 1] as PlayerIndex[]) {
    it(`leaves no gap where player ${other(viewer) + 1}'s unseen base stands, from a truck 3 to 5 squares off it (12 seeds)`, () => {
      let placed = 0;
      let exercised = 0;
      for (const seed of SEEDS) {
        const g = builtGame(seed);
        const s = g.strategic!;
        const map = mapOfGame(g);
        const hidden = other(viewer);
        const here = s.bases[hidden];
        const there = farSpot(validBaseSpots(map, hidden), here);
        // The viewer's own turn, its automatic start already done, with the hidden base at either spot.
        const at = (spot: Point): Game => {
          const twin = onMap(g, map.id, viewer === 0 ? [s.bases[0], spot] : [spot, s.bases[1]]);
          twin.turn = viewer === 0 ? 1 : 2;
          twin.current = viewer;
          twin.phase = "turn";
          twin.handoff = null;
          twin.strategic!.autoDoneTurn = twin.turn;
          return twin;
        };
        const [a0, b0] = [at(here), at(there)];
        const fort = a0.players[hidden].units.find((u) => u.type === "fort")!;
        const truck = a0.players[viewer].units.find((u) => u.type === "truck")!;
        /** The truck parked at (x, y) and looking around, or null when it cannot stand there or would see an enemy. */
        const park = (game: Game, x: number, y: number): Game | null => {
          const c = structuredClone(game);
          const t = c.players[viewer].units.find((u) => u.id === truck.id)!;
          if (!isFree(map, [...c.players[0].units, ...c.players[1].units], footprintAt(t, x, y), new Set([t]))) return null;
          t.x = x;
          t.y = y;
          const sight = visibleSquares(c.players[viewer].units, map);
          return c.players[hidden].units.some((u) => isAlive(u) && unitSeen(u, sight, map)) ? null : lookAround(c, viewer);
        };
        let here3 = 0;
        for (let y = 0; y < map.h && here3 < 3; y++) {
          for (let x = 0; x < map.w && here3 < 3; x++) {
            const d = squareDistance(footprintAt(truck, x, y), rectOf(fort));
            if (d < 3 || d > 5) continue;
            const a = park(a0, x, y);
            const b = park(b0, x, y);
            if (!a || !b) continue;
            here3 += 1;
            placed += 1;
            expect(blind(a, viewer) && blind(b, viewer), `seed ${seed} truck at ${x},${y}`).toBe(true);
            expect(seenBy(a, viewer), `seed ${seed} truck at ${x},${y}`).toEqual(seenBy(b, viewer));
            // Planned round every unit, the reach would have had gaps in A: the case really came up.
            const holes = reachableFor(a, truck.id).filter((p) => !trueReach(a, viewer, truck.id).includes(key(p)));
            if (holes.length === 0) continue;
            exercised += 1;
            // Driving onto one of those squares is no refused order: the truck stops beside what it ran into, and sees it.
            const to = holes[0]!;
            const drove = ok(moveUnit(a, truck.id, to));
            const move = drove.strategic!.events.at(-1)!;
            expect(move.kind === "move" && key(move.to) !== key(to), `seed ${seed} stopped short`).toBe(true);
            expect(blind(drove, viewer), `seed ${seed} sees what it ran into`).toBe(false);
          }
        }
      }
      expect(placed).toBeGreaterThan(SEEDS.length);
      expect(exercised).toBeGreaterThan(SEEDS.length);
    });
  }
});

/** A unit at a map square; the type comes from the id ("tank-2" is a tank). */
const unit = (id: string, x: number, y: number, upright = false): Unit => ({ id, type: typeOfId(id) as Unit["type"], x, y, upright, hits: 0 });

/**
 * A game on Medium 1 with hand-placed armies, recorded as the starting armies so the replay can
 * rebuild it, on Game.turn `turn` with that turn's automatic start still to run. Each side knows
 * only its own base plus what its units see.
 */
function handPlaced(p0: Unit[], p1: Unit[], turn: number): Game {
  const g = structuredClone(ok(confirmHandoff(builtOnMedium(1))));
  const s = g.strategic!;
  g.players[0].units = structuredClone(p0);
  g.players[1].units = structuredClone(p1);
  g.turn = turn;
  g.current = turn % 2 === 1 ? 0 : 1;
  const baseOnly = (p: PlayerIndex) => encodeExplored(new Set(squaresOfRect({ ...s.bases[p], ...BASE_GRID }, medium)), medium);
  s.explored = [baseOnly(0), baseOnly(1)];
  s.lastSeen = [[], []];
  s.orders = {};
  s.autoDoneTurn = 0;
  s.events = [];
  s.shots = [];
  s.nextShot = 1;
  s.nextInfantry = [3, 3];
  s.start = [structuredClone(p0), structuredClone(p1)];
  return lookAround(lookAround(g, 0), 1);
}

describe("an enemy infantry sent out beside a fort in the fog", () => {
  it("looks exactly like one walking in out of the fog: same turn screen, same replay", () => {
    // Player 1's fort (squares 14-16 x 7-9) sends infantry 3 out onto (17,9) on their second turn.
    // Player 2's tank sees that square but not one square of the fort.
    const spawned = handPlaced([unit("fort-1", 14, 7)], [unit("fort-1", 33, 8), unit("tank-1", 19, 12)], 3);
    const a = ok(confirmHandoff(ok(endStrategicTurn(beginStrategicTurn(spawned)))));
    const spawnAt = a.strategic!.events.findIndex((e) => e.kind === "spawn" && e.player === 0);
    const spawn = a.strategic!.events[spawnAt]!;
    expect(spawn).toMatchObject({ kind: "spawn", unitId: "infantry-3", at: { x: 17, y: 9 } });
    const sight = visibleSquares(a.players[1].units, medium);
    expect(unitSeen(a.players[0].units[0]!, sight, medium)).toBe(false);

    // The other history: player 1's fort stood far off, and infantry 3 walked onto (17,9) from the
    // square in the fog beside it that the replay picks for a hidden spawn.
    const from = fogSquareBeside({ x: 17, y: 9 }, sight, medium)!;
    const b = structuredClone(a);
    const sb = b.strategic!;
    const farFort = { x: 4, y: 14 };
    for (const army of [b.players[0].units, sb.start![0]]) Object.assign(army.find((u) => u.type === "fort")!, farFort);
    sb.start![0].push(unit("infantry-3", from.x, from.y));
    sb.events[spawnAt] = { kind: "move", turn: spawn.turn, player: 0, unitId: "infantry-3", type: "infantry", from, to: { x: 17, y: 9 }, riders: [] };
    expect(isFree(medium, [...b.players[0].units, ...b.players[1].units], { ...from, w: 1, h: 1 })).toBe(true);
    expect(unitSeen(b.players[0].units[0]!, sight, medium)).toBe(false);

    expect(blind(a, 1)).toBe(false); // the newcomer is in sight
    expect(strategicView(a, 1).enemyBase).toBeNull();
    expect(seenBy(a, 1)).toEqual(seenBy(b, 1));
    // The replay really showed the newcomer arriving.
    expect(replayFor(a, 1).steps.map((st) => st.text)).toContain("Enemy infantry came out of the fog");
  });
});
