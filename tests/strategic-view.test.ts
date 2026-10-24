import { describe, expect, it } from "vitest";
import { Rng, typeOfId, type Game, type PlayerIndex, type Unit } from "../src/rules/index.ts";
import {
  BASE_GRID,
  decodeExplored,
  encodeExplored,
  endStrategicTurn,
  fireArtillery,
  fireTank,
  landingSquare,
  lookAround,
  shakeRadius,
  moveUnit,
  revealView,
  shooterView,
  shotForViewer,
  squareIndex,
  squaresOfRect,
  strategicView,
  unitSeen,
  type MapShot,
  type ShotHitRecord,
  type StrategicEvent,
} from "../src/strategic/rules/index.ts";
import { builtOnMedium, medium, ok } from "./strategic-fixtures.ts";

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

/** The widest shake there is (a shell aimed corner to corner), so a "steady" state aims exactly at any range. */
const WIDEST_SHAKE = shakeRadius(Math.hypot(medium.w, medium.h));

/** The first Rng state from `from` whose shell barely drifts, so a test can aim exactly. */
function steadyState(from = 1): number {
  for (let state = from; ; state++) if (WIDEST_SHAKE * Math.sqrt(new Rng(state).next()) < 0.1) return state;
}

/** A record of a hit, for crafting shots by hand. Unless told otherwise the shooter could not see the unit (a shell into the fog). */
const hitOn = (owner: PlayerIndex, unitId: string, damage = 1, destroyed = true, seen = false): ShotHitRecord => ({
  unitId,
  owner,
  type: typeOfId(unitId) as Unit["type"],
  damage,
  destroyed,
  seen,
});

/** A shot crafted by hand, as the rules would record it. */
function shot(id: number, by: PlayerIndex, x: number, y: number, hits: ShotHitRecord[], extra: Partial<MapShot> = {}): MapShot {
  const outcome = hits.length === 0 ? "miss" : hits.every((h) => h.type === "wall") ? "wall" : "hit";
  return { id, by, weapon: "shell", unitId: "artillery-1", aim: { x, y }, x, y, turn: 1, outcome, hits, revealed: false, ...extra };
}

const farFort = unit("fort-1", 30, 8);
const ownFort = unit("fort-1", 5, 8);

describe("strategicView shots", () => {
  it("shows the viewer's own blind shell as unknown, a watched one as it is, and the victim only their own hurt", () => {
    const g = scenario([unit("artillery-1", 4, 8)], [farFort, unit("tank-1", 19, 12), unit("infantry-1", 19, 14)]);
    g.rngState = steadyState();
    const r = ok(fireArtillery(g, "artillery-1", { x: 20, y: 13.2 }));
    const real = r.strategic!.shots[0]!;
    expect(real.revealed).toBe(false);
    expect(real.hits.length).toBeGreaterThan(0);
    const mine = strategicView(r, 0);
    expect(mine.shots).toEqual([{ ...real, outcome: "unknown", hits: [] }]);
    expect(mine.lastShot).toEqual(mine.shots[0]);
    expect(mine.enemies).toEqual([]); // no reveal
    const theirs = strategicView(r, 1);
    expect(theirs.shots).toEqual([{ ...real, outcome: "hit", hits: real.hits.filter((h) => h.owner === 1) }]);
    expect(theirs.lastShot).toBeNull();

    const watched = scenario([unit("artillery-1", 4, 8), unit("tank-2", 16, 12)], [farFort, unit("tank-1", 19, 12)]);
    watched.rngState = steadyState();
    const w = ok(fireArtillery(watched, "artillery-1", { x: 20, y: 13.2 }));
    expect(w.strategic!.shots[0]!.revealed).toBe(true);
    expect(strategicView(w, 0).shots).toEqual(w.strategic!.shots);
  });

  it("shows enemy shots only when they hurt the viewer or fell on explored ground, with only the viewer's hits", () => {
    const g = scenario([ownFort, unit("tank-1", 10, 8), unit("wall-1", 5, 11)], [farFort, unit("infantry-1", 36, 3)]);
    const fog = { x: 36, y: 2 };
    const known = { x: 7.5, y: 9.5 }; // inside the viewer's base
    g.strategic!.shots = [
      shot(1, 1, fog.x, fog.y, []), // nothing, nowhere: hidden
      shot(2, 1, fog.x, fog.y, [hitOn(1, "infantry-1")]), // the enemy hurt themselves in the fog: hidden
      shot(3, 1, known.x, known.y, []), // a miss on known ground: shown
      shot(4, 1, known.x, known.y, [hitOn(1, "infantry-1")]), // shown as a miss; the enemy's loss stays hidden
      shot(5, 1, fog.x, fog.y, [hitOn(0, "tank-1", 3), hitOn(1, "infantry-1")]), // hurt the viewer: shown with their hit only
      shot(6, 1, 6, 11.5, [hitOn(0, "wall-1", 1, true, true)], { weapon: "tank", revealed: true }), // a tank shot on the viewer's wall
      shot(7, 1, fog.x, fog.y, [hitOn(0, "wall-1")]), // walls absorbed it in the fog
      shot(8, 0, fog.x, fog.y, [hitOn(1, "infantry-1")]), // the viewer's own blind shell
    ];
    const v = strategicView(g, 0);
    expect(v.shots.map((s) => [s.id, s.outcome, s.hits.map((h) => `${h.owner}:${h.unitId}`)])).toEqual([
      [3, "miss", []],
      [4, "miss", []],
      [5, "hit", ["0:tank-1"]],
      [6, "wall", ["0:wall-1"]],
      [7, "wall", ["0:wall-1"]],
      [8, "unknown", []],
    ]);
    expect(v.lastShot).toEqual(v.shots.at(-1));
    for (const s of v.shots) for (const h of s.hits) expect(h.owner).toBe(0);
    // The other side sees its own shells (blind ones as unknown) and the viewer's shell that hurt them.
    const e = strategicView({ ...g, current: 1 }, 1);
    expect(e.shots.map((s) => [s.id, s.outcome])).toEqual([
      [1, "unknown"],
      [2, "unknown"],
      [3, "unknown"],
      [4, "unknown"],
      [5, "unknown"],
      [6, "wall"],
      [7, "unknown"],
      [8, "hit"],
    ]);
  });

  it("shotForViewer leaves a shot it may show untouched apart from the filtering", () => {
    const explored = new Set([squareIndex(medium, 7, 9)]);
    const s = shot(1, 1, 7.5, 9.5, [], { turn: 4 });
    expect(shotForViewer(s, 0, explored, medium)).toEqual(s);
    expect(shotForViewer(s, 0, new Set(), medium)).toBeNull();
    expect(shotForViewer({ ...s, by: 0 }, 0, new Set(), medium)).toEqual({ ...s, by: 0, outcome: "unknown" });
    expect(shotForViewer({ ...s, by: 0, revealed: true }, 0, new Set(), medium)).toEqual({ ...s, by: 0, revealed: true });
    expect(landingSquare({ x: 40, y: 20 }, medium)).toBe(squareIndex(medium, 39, 19));
    expect(landingSquare({ x: 0.2, y: 19.9 }, medium)).toBe(squareIndex(medium, 0, 19));
  });

  it("shooterView keeps only the hits the shooter saw and reads the outcome from those", () => {
    const fogHit = hitOn(1, "infantry-1");
    const seenHit = hitOn(1, "tank-1", 3, true, true);
    const ownHit = hitOn(0, "tank-2", 3, true, true);
    const seenWall = hitOn(1, "wall-1", 1, true, true);
    // Blind shell: nothing seen is unknown; a unit in sight clipped by it is a hit.
    expect(shooterView(shot(1, 0, 20, 6, [fogHit]))).toMatchObject({ outcome: "unknown", hits: [] });
    expect(shooterView(shot(2, 0, 20, 6, [fogHit, seenHit]))).toMatchObject({ outcome: "hit", hits: [seenHit] });
    expect(shooterView(shot(3, 0, 20, 6, [seenWall]))).toMatchObject({ outcome: "wall", hits: [seenWall] });
    // Watched shell: a hit on a unit in the fog reads as a miss, the same as nothing hit at all.
    expect(shooterView(shot(4, 0, 20, 6, [fogHit], { revealed: true }))).toMatchObject({ outcome: "miss", hits: [] });
    expect(shooterView(shot(5, 0, 20, 6, [], { revealed: true }))).toMatchObject({ outcome: "miss", hits: [] });
    expect(shooterView(shot(6, 0, 20, 6, [fogHit, ownHit], { revealed: true }))).toMatchObject({ outcome: "hit", hits: [ownHit] });
    expect(shooterView(shot(7, 0, 20, 6, [hitOn(1, "wall-2")], { revealed: true }))).toMatchObject({ outcome: "miss", hits: [] });
    // Nothing else about the shot changes.
    const full = shot(8, 0, 20, 6, [seenHit, ownHit], { revealed: true, turn: 3 });
    expect(shooterView(full)).toEqual(full);
  });

  it("a blind shell that clips a unit in sight shows that hit; a watched shell that clips a unit in the fog shows nothing of it", () => {
    // The tank sees three squares out: the enemy infantry at x 18 is the last square in sight, the aim one square beyond.
    const g = scenario([unit("artillery-1", 4, 8), unit("tank-2", 14, 8)], [farFort, unit("infantry-1", 18, 8)]);
    g.rngState = steadyState();
    const r = ok(fireArtillery(g, "artillery-1", { x: 19.3, y: 8.5 }));
    const real = r.strategic!.shots[0]!;
    expect(real.revealed).toBe(false);
    expect(real.hits).toEqual([{ unitId: "infantry-1", owner: 1, type: "infantry", damage: 1, destroyed: true, seen: true }]);
    const v = strategicView(r, 0);
    expect(v.shots).toEqual([{ ...real, outcome: "hit" }]);
    expect(v.lastShot).toEqual(v.shots[0]);

    // The infantry sees one square out, so the landing square (11, 10) is watched but the enemy at x 12 is not.
    const g2 = scenario([unit("artillery-1", 4, 8), unit("infantry-1", 10, 10)], [farFort, unit("infantry-1", 12, 10)]);
    g2.rngState = steadyState();
    const r2 = ok(fireArtillery(g2, "artillery-1", { x: 11.9, y: 10.5 }));
    const real2 = r2.strategic!.shots[0]!;
    expect(real2.revealed).toBe(true);
    expect(real2.hits).toEqual([{ unitId: "infantry-1", owner: 1, type: "infantry", damage: 1, destroyed: true, seen: false }]);
    const v2 = strategicView(r2, 0);
    expect(v2.shots).toEqual([{ ...real2, outcome: "miss", hits: [] }]);
    expect(v2.enemies).toEqual([]);
    // The victim still sees what hit them.
    expect(strategicView(r2, 1).shots).toEqual([{ ...real2, outcome: "hit" }]);
  });

  it("lastShot is the viewer's latest shot this turn and nothing once the turn has passed", () => {
    const g = scenario([unit("artillery-1", 4, 8), unit("tank-1", 6, 12)], [farFort, unit("wall-1", 9, 12)]);
    expect(strategicView(g, 0).lastShot).toBeNull();
    const a = ok(fireArtillery(g, "artillery-1", { x: 20, y: 6 }));
    expect(strategicView(a, 0).lastShot?.id).toBe(1);
    const b = ok(fireTank(a, "tank-1", "wall-1"));
    expect(strategicView(b, 0).lastShot?.id).toBe(2);
    expect(strategicView(b, 0).shots).toHaveLength(2);
    expect(strategicView(b, 1).lastShot).toBeNull();
    const ended = ok(endStrategicTurn(b));
    expect(strategicView(ended, 0).lastShot).toBeNull();
    expect(strategicView(ended, 0).shots).toHaveLength(2);
  });
});

describe("strategicView orders", () => {
  const own = [ownFort, unit("tank-1", 9, 8), unit("tank-2", 9, 11), unit("artillery-1", 2, 11), unit("truck-1", 12, 9), unit("infantry-1", 11, 8), unit("infantry-2", 14, 11), unit("wall-1", 5, 7)];
  const enemy = [farFort, unit("wall-1", 12, 12)];

  it("has one row per living active unit in unit order, saying what each may still do", () => {
    const g = scenario(own, enemy);
    expect(strategicView(g, 0).orders).toEqual([
      { unitId: "tank-1", type: "tank", moved: false, fired: false, canMove: true, canFire: false },
      { unitId: "tank-2", type: "tank", moved: false, fired: false, canMove: true, canFire: true },
      { unitId: "artillery-1", type: "artillery", moved: false, fired: false, canMove: false, canFire: true },
      { unitId: "truck-1", type: "truck", moved: false, fired: false, canMove: true, canFire: false, riders: 2 },
    ]);
    const moved = ok(moveUnit(g, "tank-1", { x: 9, y: 6 }));
    expect(strategicView(moved, 0).orders[0]).toEqual({ unitId: "tank-1", type: "tank", moved: true, fired: false, canMove: false, canFire: false });
    const fired = ok(fireTank(moved, "tank-2", "wall-1"));
    expect(strategicView(fired, 0).orders[1]).toEqual({ unitId: "tank-2", type: "tank", moved: true, fired: true, canMove: false, canFire: false });
    const shelled = ok(fireArtillery(fired, "artillery-1", { x: 20, y: 6 }));
    expect(strategicView(shelled, 0).orders[2]).toEqual({ unitId: "artillery-1", type: "artillery", moved: false, fired: true, canMove: false, canFire: false });
    const trucked = ok(moveUnit(shelled, "truck-1", { x: 16, y: 9 }));
    expect(strategicView(trucked, 0).orders[3]).toMatchObject({ unitId: "truck-1", moved: true, canMove: false, canFire: false });
  });

  it("is empty when it is not the viewer's turn or the game is over, and leaves out destroyed units", () => {
    const g = scenario(own, enemy);
    expect(strategicView(g, 1).orders).toEqual([]);
    expect(strategicView({ ...g, phase: "over", winner: 0 }, 0).orders).toEqual([]);
    expect(strategicView({ ...g, phase: "handoff" }, 0).orders).toEqual([]);
    const lost = scenario([ownFort, unit("tank-1", 9, 8, 3), unit("artillery-1", 2, 11, 2), unit("truck-1", 12, 9)], enemy);
    expect(strategicView(lost, 0).orders.map((o) => o.unitId)).toEqual(["truck-1"]);
    expect(strategicView(lost, 0).units.map((u) => u.state)).toEqual(["normal", "destroyed", "destroyed", "normal"]);
  });

  it("a boxed-in tank cannot move but can still fire at the units boxing it in", () => {
    const box = [unit("infantry-1", 2, 0), unit("infantry-2", 2, 1), unit("infantry-3", 0, 2), unit("infantry-4", 1, 2), unit("infantry-5", 2, 2)];
    const g = scenario([unit("tank-1", 0, 0)], [farFort, ...box]);
    expect(strategicView(g, 0).orders).toEqual([{ unitId: "tank-1", type: "tank", moved: false, fired: false, canMove: false, canFire: true }]);
  });
});

describe("strategicView enemies and the enemy base", () => {
  it("keeps the enemy base hidden until the fort has been seen, then remembers it", () => {
    const g = scenario([ownFort, unit("tank-1", 20, 6)], [farFort]);
    expect(strategicView(g, 0).enemyBase).toBeNull();
    expect(strategicView(g, 1).enemyBase).toBeNull();
    const near = structuredClone(g);
    near.players[0].units[1]!.x = 26;
    expect(strategicView(near, 0).enemyBase).toEqual(g.strategic!.bases[1]);
    expect(strategicView(near, 0).enemies).toEqual([{ id: "fort-1", type: "fort", x: 30, y: 8, upright: false, state: "normal", hp: 6, maxHp: 6, owner: 1, current: true }]);
    // The enemy fort sees the tank, but a tank is not a fort: the other side's base stays hidden.
    expect(strategicView(near, 1).enemies.map((e) => e.id)).toEqual(["tank-1"]);
    expect(strategicView(near, 1).enemyBase).toBeNull();
    const away = lookAround(near, 0);
    away.players[0].units[1]!.x = 20;
    expect(strategicView(away, 0).enemyBase).toEqual(g.strategic!.bases[1]);
    expect(strategicView(away, 0).enemies[0]).toMatchObject({ id: "fort-1", current: false, seenTurn: 1 });
  });

  it("shows an enemy the viewer saw destroyed as a destroyed last sighting", () => {
    const g = scenario([unit("tank-1", 6, 8)], [unit("wall-1", 8, 8), farFort]);
    const r = ok(fireTank(g, "tank-1", "wall-1"));
    expect(strategicView(r, 0).enemies).toEqual([{ id: "wall-1", type: "wall", x: 8, y: 8, upright: false, state: "destroyed", hp: 0, maxHp: 1, owner: 1, current: true }]);
    const later = structuredClone(ok(endStrategicTurn(r)));
    later.phase = "turn";
    later.players[0].units[0]!.x = 20;
    later.players[0].units[0]!.y = 6;
    expect(strategicView(later, 0).enemies).toEqual([{ id: "wall-1", type: "wall", x: 8, y: 8, upright: false, state: "destroyed", hp: 0, maxHp: 1, owner: 1, current: false, seenTurn: 1 }]);
  });

  it("never lists an enemy that is neither in sight nor in lastSeen, nor a shot the fog hides (20 seeds)", () => {
    for (let seed = 101; seed <= 120; seed++) {
      const g = turnGame(seed);
      const rng = new Rng(seed);
      const s = g.strategic!;
      for (const u of g.players[1].units) {
        u.x = rng.int(0, medium.w - 3);
        u.y = rng.int(0, medium.h - 3);
        u.hits = rng.int(0, 1);
      }
      for (const u of g.players[0].units) {
        u.x = rng.int(0, medium.w - 3);
        u.y = rng.int(0, medium.h - 3);
      }
      const ids = (p: PlayerIndex) => g.players[p].units.map((u) => u.id);
      s.shots = Array.from({ length: 12 }, (_, i) => {
        const by = rng.int(0, 1) as PlayerIndex;
        const hits = Array.from({ length: rng.int(0, 2) }, () => {
          const owner = rng.int(0, 1) as PlayerIndex;
          return hitOn(owner, rng.pick(ids(owner)), 1, rng.int(0, 1) === 1, rng.int(0, 1) === 1);
        });
        return shot(i + 1, by, rng.next() * medium.w, rng.next() * medium.h, hits, { revealed: rng.int(0, 1) === 1, turn: rng.int(1, 2) });
      });
      g.turn = 2;
      const seen = lookAround(lookAround(g, 0), 1);
      for (const viewer of [0, 1] as PlayerIndex[]) {
        const v = strategicView(seen, viewer);
        const enemy: PlayerIndex = viewer === 0 ? 1 : 0;
        const lastSeen = seen.strategic!.lastSeen[viewer];
        for (const e of v.enemies) {
          const live = seen.players[enemy].units.find((u) => u.id === e.id)!;
          if (e.current) expect(unitSeen(live, v.visible, medium)).toBe(true);
          else expect(lastSeen.some((x) => x.id === e.id)).toBe(true);
        }
        const listed = new Set(v.enemies.map((e) => e.id));
        for (const u of seen.players[enemy].units) if (!listed.has(u.id)) expect(unitSeen(u, v.visible, medium)).toBe(false);
        for (const sh of v.shots) {
          const real = seen.strategic!.shots.find((x) => x.id === sh.id)!;
          if (sh.by === viewer) {
            // The shooter sees exactly the hits they could vouch for, and an outcome that gives nothing else away.
            expect(sh.hits).toEqual(real.hits.filter((h) => h.seen));
            if (sh.hits.length > 0) expect(sh.outcome).toBe(sh.hits.every((h) => h.type === "wall") ? "wall" : "hit");
            else expect(sh.outcome).toBe(real.revealed ? "miss" : "unknown");
            expect({ ...sh, outcome: real.outcome, hits: real.hits }).toEqual(real);
          } else {
            for (const h of sh.hits) expect(h.owner).toBe(viewer);
            expect(sh.hits.length > 0 || v.explored.has(landingSquare(sh, medium))).toBe(true);
            if (sh.hits.length === 0) expect(sh.outcome).toBe("miss");
          }
        }
        // Every enemy shot that hurt the viewer is there.
        const shown = new Set(v.shots.map((x) => x.id));
        for (const real of seen.strategic!.shots) {
          if (real.by !== viewer && real.hits.some((h) => h.owner === viewer)) expect(shown.has(real.id)).toBe(true);
        }
        expect(v.lastShot === null || (v.lastShot.by === viewer && v.lastShot.turn === 2)).toBe(true);
      }
    }
  });
});

describe("strategicView report", () => {
  /** Player 1 on their second turn (Game.turn 3): the window is the enemy's turn 2 and this turn's events. */
  function reportGame(own: Unit[] = [], enemy: Unit[] = []): Game {
    const g = scenario([ownFort, unit("tank-1", 9, 8), unit("tank-2", 4, 11), unit("infantry-1", 3, 8), unit("infantry-2", 3, 10), ...own], [farFort, ...enemy]);
    g.turn = 3;
    return g;
  }
  const melee = (turn: number, player: PlayerIndex, targetId: string, destroyed: boolean, unitId = "infantry-1"): StrategicEvent => ({
    kind: "melee",
    turn,
    player,
    unitId,
    targetId,
    targetType: typeOfId(targetId) as Unit["type"],
    damage: 1,
    destroyed,
  });

  it("is empty when nothing happened", () => {
    expect(strategicView(reportGame(), 0).report).toEqual([]);
    expect(strategicView(scenario([ownFort], [farFort]), 0).report).toEqual([]);
  });

  it("names the units lost to shells and hand-to-hand fighting since the viewer's last turn", () => {
    const g = reportGame();
    g.players[0].units[1]!.hits = 3; // tank-1
    g.players[0].units[4]!.hits = 1; // infantry-2
    g.players[0].units[2]!.hits = 3; // tank-2, lost two turns ago
    g.strategic!.shots = [
      shot(1, 1, 5, 11.5, [hitOn(0, "tank-2", 3)], { turn: 1 }),
      shot(2, 1, 9.5, 9.5, [hitOn(0, "tank-1", 3)], { turn: 2 }),
    ];
    g.strategic!.events = [
      { kind: "shot", turn: 1, player: 1, shotId: 1 },
      { kind: "shot", turn: 2, player: 1, shotId: 2 },
      melee(2, 1, "infantry-2", true),
    ];
    expect(strategicView(g, 0).report).toEqual(["Lost: tank 1, infantry 2"]);
  });

  it("reports hits on the fort with the hit points left", () => {
    const g = reportGame();
    g.players[0].units[0]!.hits = 2;
    g.strategic!.shots = [shot(1, 1, 6.5, 9.5, [hitOn(0, "fort-1", 2, false)], { turn: 2, weapon: "tank" })];
    g.strategic!.events = [{ kind: "shot", turn: 2, player: 1, shotId: 1 }];
    expect(strategicView(g, 0).report).toEqual(["Fort hit: 4 of 6 left"]);
    const bitten = reportGame();
    bitten.players[0].units[0]!.hits = 1;
    bitten.strategic!.events = [melee(2, 1, "fort-1", false)];
    expect(strategicView(bitten, 0).report).toEqual(["Fort hit: 5 of 6 left"]);
    const old = reportGame();
    old.players[0].units[0]!.hits = 2;
    old.strategic!.shots = [shot(1, 1, 6.5, 9.5, [hitOn(0, "fort-1", 2, false)], { turn: 1 })];
    expect(strategicView(old, 0).report).toEqual([]);
  });

  it("tells what the viewer's own infantry did and who the fort sent out", () => {
    const g = reportGame();
    g.strategic!.events = [melee(3, 0, "wall-1", false)];
    expect(strategicView(g, 0).report).toEqual(["Your infantry hit an enemy wall"]);
    g.strategic!.events = [melee(3, 0, "tank-1", true)];
    expect(strategicView(g, 0).report).toEqual(["Your infantry destroyed an enemy tank"]);
    g.strategic!.events = [melee(3, 0, "tank-1", true), melee(3, 0, "infantry-2", true, "infantry-2")];
    expect(strategicView(g, 0).report).toEqual(["Your infantry destroyed 2 enemy units"]);
    g.strategic!.events = [melee(3, 0, "tank-1", false), melee(3, 0, "infantry-2", true, "infantry-2")];
    expect(strategicView(g, 0).report).toEqual(["Your infantry hit 2 enemy units (1 destroyed)"]);
    g.strategic!.events = [
      { kind: "spawn", turn: 3, player: 0, unitId: "infantry-3", at: { x: 8, y: 9 } },
      { kind: "spawn", turn: 2, player: 1, unitId: "infantry-3", at: { x: 29, y: 9 } },
    ];
    expect(strategicView(g, 0).report).toEqual(["The fort sent out infantry 3"]);
    expect(strategicView({ ...g, turn: 2, current: 1 }, 1).report).toEqual(["The fort sent out infantry 3"]);
    expect(strategicView({ ...g, turn: 4, current: 1 }, 1).report).toEqual([]); // two turns on, it is old news
  });

  it("counts enemy shells that landed on known ground without hurting anyone, and enemies in sight", () => {
    const g = reportGame();
    g.strategic!.shots = [
      shot(1, 1, 6.5, 11.5, [], { turn: 2 }),
      shot(2, 1, 12.2, 8.3, [hitOn(1, "infantry-1")], { turn: 2 }),
      shot(3, 1, 36, 2, [], { turn: 2 }), // in the fog: unknown to the viewer
      shot(4, 1, 6.5, 11.5, [], { turn: 1 }), // too long ago
      shot(5, 0, 20, 6, [], { turn: 3 }), // the viewer's own
    ];
    expect(strategicView(g, 0).report).toEqual(["2 shells landed near you"]);
    g.strategic!.shots = [shot(1, 1, 6.5, 11.5, [], { turn: 2 })];
    expect(strategicView(g, 0).report).toEqual(["A shell landed near you"]);
    const one = reportGame([], [unit("infantry-1", 13, 8)]);
    expect(strategicView(one, 0).report).toEqual(["Enemy infantry in sight"]);
    const two = reportGame([], [unit("infantry-1", 13, 8), unit("tank-1", 12, 10)]);
    expect(strategicView(two, 0).report).toEqual(["2 enemy units in sight"]);
    const broken = reportGame([], [unit("wall-1", 12, 8, 1)]);
    expect(strategicView(broken, 0).report).toEqual([]);
  });

  it("keeps the worst news first and at most four lines", () => {
    const g = reportGame([], [unit("infantry-1", 13, 8)]);
    g.players[0].units[0]!.hits = 1;
    g.players[0].units[1]!.hits = 3;
    g.strategic!.shots = [shot(1, 1, 9.5, 9.5, [hitOn(0, "tank-1", 3)], { turn: 2 }), shot(2, 1, 6.5, 11.5, [], { turn: 2 })];
    g.strategic!.events = [
      { kind: "shot", turn: 2, player: 1, shotId: 1 },
      { kind: "shot", turn: 2, player: 1, shotId: 2 },
      melee(2, 1, "fort-1", false),
      melee(3, 0, "wall-1", true),
      { kind: "spawn", turn: 3, player: 0, unitId: "infantry-3", at: { x: 8, y: 9 } },
    ];
    expect(strategicView(g, 0).report).toEqual([
      "Lost: tank 1",
      "Fort hit: 5 of 6 left",
      "Your infantry destroyed an enemy wall",
      "The fort sent out infantry 3",
    ]);
  });
});

describe("strategicView basics and revealView", () => {
  it("lists every own unit, living and destroyed, with hit points, and the game's state", () => {
    const g = scenario([ownFort, unit("tank-1", 9, 8, 1), unit("wall-1", 5, 11, 1)], [farFort]);
    const v = strategicView(g, 0);
    expect(v.units).toEqual([
      { id: "fort-1", type: "fort", x: 5, y: 8, upright: false, state: "normal", hp: 6, maxHp: 6, owner: 0, current: true },
      { id: "tank-1", type: "tank", x: 9, y: 8, upright: false, state: "damaged", hp: 2, maxHp: 3, owner: 0, current: true },
      { id: "wall-1", type: "wall", x: 5, y: 11, upright: false, state: "destroyed", hp: 0, maxHp: 1, owner: 0, current: true },
    ]);
    expect(v.over).toBe(false);
    expect(v.winner).toBeNull();
    expect(v.base).toEqual(g.strategic!.bases[0]);
    for (const i of squaresOfRect({ ...v.base, ...BASE_GRID }, medium)) expect(v.explored.has(i)).toBe(true);
    const over = strategicView({ ...g, phase: "over", winner: 1 }, 0);
    expect(over.over).toBe(true);
    expect(over.winner).toBe(1);
    expect(over.orders).toEqual([]);
  });

  it("revealView shows both armies, the whole map and every shot as it really was", () => {
    const g = scenario([ownFort, unit("tank-1", 9, 8, 3)], [farFort, unit("tank-1", 33, 12, 1), unit("infantry-1", 20, 6)]);
    g.strategic!.shots = [shot(1, 0, 20, 6, [hitOn(1, "infantry-1")]), shot(2, 1, 9.5, 9.5, [hitOn(0, "tank-1", 3)], { turn: 2 })];
    g.strategic!.explored = [encodeExplored(new Set([0]), medium), encodeExplored(new Set([1]), medium)];
    const v = revealView(g);
    expect(v.viewer).toBe(0);
    expect(v.base).toEqual(g.strategic!.bases[0]);
    expect(v.enemyBase).toEqual(g.strategic!.bases[1]);
    expect(v.units.map((u) => [u.id, u.state, u.owner])).toEqual([
      ["fort-1", "normal", 0],
      ["tank-1", "destroyed", 0],
    ]);
    expect(v.enemies.map((u) => [u.id, u.state, u.owner, u.current])).toEqual([
      ["fort-1", "normal", 1, true],
      ["tank-1", "damaged", 1, true],
      ["infantry-1", "normal", 1, true],
    ]);
    expect(v.explored.size).toBe(medium.w * medium.h);
    expect(v.visible.size).toBe(0);
    expect(v.exploredPercent).toBe(100);
    expect(v.shots).toEqual(g.strategic!.shots.map((s) => ({ ...s, revealed: true })));
    expect(v.shots.map((s) => s.outcome)).toEqual(["hit", "hit"]);
    expect(v.lastShot).toBeNull();
    expect(v.orders).toEqual([]);
    expect(v.report).toEqual([]);
    expect(v.over).toBe(false);
    expect(v.winner).toBeNull();
    const done = revealView({ ...g, phase: "over", winner: 1 });
    expect(done.over).toBe(true);
    expect(done.winner).toBe(1);
    // Meanwhile the fogged view still hides what revealView shows.
    expect(decodeExplored(g.strategic!.explored[0], medium).size).toBe(1);
    expect(strategicView(g, 0).enemies.map((e) => e.id)).toEqual([]);
  });
});
