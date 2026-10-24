import { describe, expect, it } from "vitest";
import {
  MODES,
  Rng,
  confirmHandoff,
  createGame,
  endTurn,
  finishBuild,
  fire,
  isStrategic,
  modeOf,
  playComputerTurn,
  randomLayout,
  rectOf,
  type Game,
  type PlayerIndex,
  type Unit,
} from "../src/rules/index.ts";
import {
  BASE_GRID,
  NEW_GAME_MAP_IDS,
  SIGHT,
  STRATEGIC_ARMY,
  decodeExplored,
  encodeExplored,
  endStrategicTurn,
  exploredPercent,
  lookAround,
  mapOf,
  squareIndex,
  squaresOfRect,
  startStrategic,
  strategicView,
  turnNumber,
  unitSeen,
  validBaseSpots,
  visibleSquares,
} from "../src/strategic/rules/index.ts";
import { mapOfGame } from "./strategic-fixtures.ts";

/** Medium 1, for the sight and encoding tests that need known ground. Games themselves land on any new-game map. */
const medium = mapOf("medium-1");

function ok(r: { ok: boolean; game?: Game; reason?: string }): Game {
  if (!r.ok) throw new Error(r.reason);
  return r.game!;
}

const unit = (type: Unit["type"], x: number, y: number, hits = 0): Unit => ({ id: `${type}-1`, type, x, y, upright: false, hits });

const squaresAround = (x0: number, y0: number, x1: number, y1: number) => {
  const out = new Set<number>();
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.add(squareIndex(medium, x, y));
  return out;
};

/** A two-player Strategic game with both bases built at random; player 2 has just tapped Done. */
function builtStrategic(seed: number): { before: Game; after: Game } {
  let g = createGame({ seed, mode: "strategic" });
  g = randomLayout(g, 0);
  g = ok(finishBuild(g, 0));
  g = ok(confirmHandoff(g));
  g = randomLayout(g, 1);
  return { before: g, after: ok(finishBuild(g, 1)) };
}

/** The same game, with player 1 looking at their first turn. */
const inTurn = (seed: number) => ok(confirmHandoff(builtStrategic(seed).after));

const inside = (u: Unit, base: { x: number; y: number }) => {
  const r = rectOf(u);
  return r.x >= base.x && r.y >= base.y && r.x + r.w <= base.x + BASE_GRID.w && r.y + r.h <= base.y + BASE_GRID.h;
};

describe("the Strategic mode entry", () => {
  it("is the fourth mode, with a Skirmish base and one extra tank, and is told apart by isStrategic", () => {
    expect(MODES.strategic).toEqual({
      id: "strategic",
      name: "Strategic (test)",
      blurb: "Test build. A big paper map hidden by fog of war: explore to find the enemy base. Two players on one phone.",
      army: { fort: 1, tank: 2, artillery: 1, infantry: 2, wall: 2, truck: 1 },
      grid: { w: 12, h: 6 },
      win: "core",
    });
    expect(isStrategic(MODES.strategic)).toBe(true);
    expect(isStrategic(MODES.skirmish)).toBe(false);
    expect(isStrategic(modeOf(undefined))).toBe(false);
    expect(BASE_GRID).toEqual({ w: 12, h: 6 });
    expect(STRATEGIC_ARMY).toEqual(MODES.strategic.army);
    expect(SIGHT).toEqual({ fort: 4, tank: 3, artillery: 2, infantry: 1, wall: 0, truck: 2 });
  });
});

describe("explored encoding", () => {
  it("round-trips random sets and uses one hex character for every four squares", () => {
    const rng = new Rng(3);
    for (let i = 0; i < 40; i++) {
      const set = new Set<number>();
      const count = rng.int(0, medium.w * medium.h);
      for (let n = 0; n < count; n++) set.add(rng.int(0, medium.w * medium.h - 1));
      const text = encodeExplored(set, medium);
      expect(text).toHaveLength(Math.ceil((medium.w * medium.h) / 4));
      expect(text).toMatch(/^[0-9a-f]*$/);
      expect(decodeExplored(text, medium)).toEqual(set);
    }
    const odd = { w: 5, h: 3 }; // 15 squares: the last character holds three
    const all = new Set(Array.from({ length: 15 }, (_, i) => i));
    expect(encodeExplored(all, odd)).toBe("fff7");
    expect(decodeExplored("fff7", odd)).toEqual(all);
  });

  it("puts square i in character floor(i / 4), bit i % 4", () => {
    expect(encodeExplored(new Set([0]), medium).slice(0, 2)).toBe("10");
    expect(encodeExplored(new Set([1]), medium).slice(0, 2)).toBe("20");
    expect(encodeExplored(new Set([3, 4]), medium).slice(0, 3)).toBe("810");
  });

  it("decodes short, long and garbled strings to whatever bits they do have, never throwing", () => {
    expect(decodeExplored("", medium)).toEqual(new Set());
    expect(decodeExplored("1", medium)).toEqual(new Set([0]));
    expect(decodeExplored("zz", medium)).toEqual(new Set());
    expect(decodeExplored("z3", medium)).toEqual(new Set([4, 5]));
    const full = encodeExplored(new Set([0, 7, 799]), medium);
    expect(decodeExplored(full.slice(0, 2), medium)).toEqual(new Set([0, 7]));
    expect(decodeExplored(full + "ffff", medium)).toEqual(new Set([0, 7, 799]));
    expect(() => decodeExplored(undefined as unknown as string, medium)).not.toThrow();
    expect(() => decodeExplored(42 as unknown as string, medium)).not.toThrow();
    const rng = new Rng(9);
    const chars = "0123456789abcdefXYZ !-_";
    for (let i = 0; i < 300; i++) {
      const text = Array.from({ length: rng.int(0, 400) }, () => rng.pick([...chars])).join("");
      expect(() => decodeExplored(text, medium)).not.toThrow();
      for (const sq of decodeExplored(text, medium)) expect(sq).toBeLessThan(medium.w * medium.h);
    }
    // Indexes outside the map are dropped when encoding rather than corrupting the string.
    expect(decodeExplored(encodeExplored(new Set([-1, 800, 5]), medium), medium)).toEqual(new Set([5]));
  });
});

describe("sight", () => {
  it("a lone infantry at (5,5) sees exactly the 3 x 3 around it", () => {
    expect(visibleSquares([unit("infantry", 5, 5)], medium)).toEqual(squaresAround(4, 4, 6, 6));
  });

  it("a fort sees 4 squares beyond its edge but not 5, and not the far corners", () => {
    const fort = unit("fort", 10, 8); // squares 10-12 x 8-10
    const seen = visibleSquares([fort], medium);
    const at = (x: number, y: number) => seen.has(squareIndex(medium, x, y));
    expect(at(6, 9)).toBe(true); // 4 to the left
    expect(at(5, 9)).toBe(false); // 5 to the left
    expect(at(16, 9)).toBe(true);
    expect(at(17, 9)).toBe(false);
    expect(at(11, 4)).toBe(true); // 4 above
    expect(at(11, 3)).toBe(false);
    expect(at(11, 14)).toBe(true); // 4 below
    expect(at(11, 15)).toBe(false);
    expect(at(10, 8)).toBe(true); // its own squares
    expect(at(6, 4)).toBe(false); // the far corner is 4.95 away
    expect(at(7, 5)).toBe(true); // 3 out on both sides: 3.54 away
    expect(at(7, 4)).toBe(false); // 3 and 4 out: 4.3 away
  });

  it("a tank sees 3, artillery 2, a wall only its own squares, and a destroyed unit nothing", () => {
    const reach = (u: Unit) => {
      const seen = visibleSquares([u], medium);
      const r = rectOf(u);
      let n = 0;
      while (seen.has(squareIndex(medium, r.x - n - 1, r.y))) n++;
      return n;
    };
    expect(reach(unit("tank", 10, 8))).toBe(3);
    expect(reach(unit("artillery", 10, 8))).toBe(2);
    expect(reach(unit("wall", 10, 8))).toBe(0);
    expect(visibleSquares([unit("wall", 10, 8)], medium)).toEqual(squaresAround(10, 8, 11, 8));
    expect(visibleSquares([unit("tank", 10, 8, 3)], medium).size).toBe(0);
  });

  it("clips sight to the map and merges several units", () => {
    const seen = visibleSquares([unit("fort", 0, 0), unit("infantry", 39, 19)], medium);
    for (const i of seen) expect(i).toBeLessThan(medium.w * medium.h);
    expect(seen.has(squareIndex(medium, 0, 0))).toBe(true);
    expect(seen.has(squareIndex(medium, 38, 18))).toBe(true);
    expect(seen.has(squareIndex(medium, 20, 10))).toBe(false);
  });

  it("an enemy is seen when any of its squares is visible", () => {
    const seen = visibleSquares([unit("infantry", 5, 5)], medium);
    expect(unitSeen(unit("tank", 6, 6), seen, medium)).toBe(true); // its top-left square is in the 3 x 3
    expect(unitSeen(unit("tank", 7, 7), seen, medium)).toBe(false);
    expect(unitSeen(unit("fort", 2, 2), seen, medium)).toBe(true); // bottom-right square (4,4)
    expect(unitSeen(unit("fort", 1, 1), seen, medium)).toBe(false);
  });

  it("squaresOfRect lists a rectangle's squares inside the map only", () => {
    expect(squaresOfRect({ x: 1, y: 1, w: 2, h: 2 }, medium)).toEqual([41, 42, 81, 82]);
    expect(squaresOfRect({ x: -1, y: -1, w: 2, h: 2 }, medium)).toEqual([0]);
    expect(squaresOfRect({ x: 39, y: 19, w: 3, h: 3 }, medium)).toEqual([799]);
  });
});

describe("startStrategic", () => {
  it("drops both bases on the map when player 2 finishes building, before the handoff", () => {
    const { before, after } = builtStrategic(11);
    expect(before.strategic).toBeUndefined();
    expect(after.phase).toBe("handoff");
    expect(after.handoff).toEqual({ to: after.firstShooter, then: "turn" });
    const s = after.strategic!;
    expect(NEW_GAME_MAP_IDS).toContain(s.map);
    // Each base at a random valid spot of its own half (tests/strategic-setup.test.ts checks the rules over 300 seeds).
    expect(validBaseSpots(mapOfGame(after), 0)).toContainEqual(s.bases[0]);
    expect(validBaseSpots(mapOfGame(after), 1)).toContainEqual(s.bases[1]);
    expect(s.lastSeen).toEqual([[], []]);
    expect(after.rngState).not.toBe(before.rngState);
  });

  it("moves every unit into its base rectangle in map squares, keeping each layout as built (player 2 not flipped)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { before, after } = builtStrategic(seed);
      const s = after.strategic!;
      for (const p of [0, 1] as PlayerIndex[]) {
        const base = s.bases[p];
        const built = before.players[p].units;
        const placed = after.players[p].units;
        expect(placed).toHaveLength(built.length);
        for (const u of placed) {
          expect(inside(u, base), `${p} ${u.id}`).toBe(true);
          const original = built.find((b) => b.id === u.id)!;
          expect({ ...u, x: u.x - base.x, y: u.y - base.y }).toEqual(original);
        }
      }
    }
  });

  it("starts each player knowing their whole base plus what their units can see", () => {
    const { after } = builtStrategic(7);
    const s = after.strategic!;
    const map = mapOfGame(after);
    for (const p of [0, 1] as PlayerIndex[]) {
      const explored = decodeExplored(s.explored[p], map);
      for (const i of squaresOfRect({ ...s.bases[p], ...BASE_GRID }, map)) expect(explored.has(i)).toBe(true);
      for (const i of visibleSquares(after.players[p].units, map)) expect(explored.has(i)).toBe(true);
      expect(explored.size).toBeLessThan((map.w * map.h) / 2);
    }
  });

  it("is deterministic for a seed and does nothing twice", () => {
    const a = builtStrategic(21).after;
    const b = builtStrategic(21).after;
    expect(a).toEqual(b);
    expect(startStrategic(a)).toEqual(a);
    expect(builtStrategic(22).after.players[0].units).not.toEqual(a.players[0].units);
  });

  it("does not touch the other modes", () => {
    let g = createGame({ seed: 1, mode: "skirmish" });
    g = randomLayout(g, 0);
    g = ok(finishBuild(g, 0));
    g = ok(confirmHandoff(g));
    g = randomLayout(g, 1);
    g = ok(finishBuild(g, 1));
    expect(g.strategic).toBeUndefined();
  });

  it("still sets up whole if a game against the computer were ever started", () => {
    let g = createGame({ seed: 2, mode: "strategic", vsComputer: true });
    g = randomLayout(g, 0);
    g = ok(finishBuild(g, 0));
    expect(g.phase).toBe("turn");
    expect(g.strategic).toBeDefined();
    expect(g.players[1].units.every((u) => inside(u, g.strategic!.bases[1]))).toBe(true);
    expect(playComputerTurn(g)).toEqual({ ok: false, reason: "wrong_phase" });
  });
});

describe("Strategic turns", () => {
  it("fire, endTurn and playComputerTurn refuse to run in a Strategic game", () => {
    const g = inTurn(5);
    expect(g.phase).toBe("turn");
    expect(fire(g, 5, 5)).toEqual({ ok: false, reason: "wrong_phase" });
    expect(endTurn(g)).toEqual({ ok: false, reason: "wrong_phase" });
    expect(playComputerTurn(g)).toEqual({ ok: false, reason: "wrong_phase" });
  });

  it("endStrategicTurn hands the phone to the other player and bumps the turn", () => {
    const g = inTurn(5);
    expect(g.current).toBe(0);
    const e = ok(endStrategicTurn(g));
    expect(e.phase).toBe("handoff");
    expect(e.handoff).toEqual({ to: 1, then: "turn" });
    expect(e.turn).toBe(2);
    expect(e.current).toBe(0);
    const g2 = ok(confirmHandoff(e));
    expect(g2.current).toBe(1);
    expect(g2.phase).toBe("turn");
    const e2 = ok(endStrategicTurn(g2));
    expect(e2.handoff).toEqual({ to: 0, then: "turn" });
    expect(e2.turn).toBe(3);
    expect(g.turn).toBe(1); // the original is untouched
  });

  it("endStrategicTurn fails outside the turn phase and in the other modes", () => {
    const { before, after } = builtStrategic(5);
    expect(endStrategicTurn(before)).toEqual({ ok: false, reason: "wrong_phase" });
    expect(endStrategicTurn(after)).toEqual({ ok: false, reason: "wrong_phase" });
    let sk = createGame({ seed: 1, mode: "skirmish" });
    sk = randomLayout(sk, 0);
    sk = ok(confirmHandoff(ok(finishBuild(sk, 0))));
    sk = randomLayout(sk, 1);
    sk = ok(confirmHandoff(ok(finishBuild(sk, 1))));
    expect(sk.phase).toBe("turn");
    expect(endStrategicTurn(sk)).toEqual({ ok: false, reason: "wrong_phase" });
  });

  it("keeps the explored set a superset of what the units see at the end of the turn", () => {
    const g = inTurn(8);
    // Walk player 1's fort out of the base (stage 2 will do this properly) and end the turn.
    const moved = structuredClone(g);
    const fort = moved.players[0].units.find((u) => u.type === "fort")!;
    fort.x = 15;
    fort.y = 1;
    const e = ok(endStrategicTurn(moved));
    const map = mapOfGame(g);
    const explored = decodeExplored(e.strategic!.explored[0], map);
    for (const i of visibleSquares(moved.players[0].units, map)) expect(explored.has(i)).toBe(true);
    for (const i of decodeExplored(g.strategic!.explored[0], map)) expect(explored.has(i)).toBe(true);
    expect(e.strategic!.explored[1]).toBe(g.strategic!.explored[1]);
  });

  it("turnNumber counts each player's own turns", () => {
    const game = (turn: number) => ({ turn, firstShooter: 0 as PlayerIndex });
    expect([1, 2, 3, 4, 5, 6].map((t) => turnNumber(game(t), 0))).toEqual([1, 1, 2, 2, 3, 3]);
    expect([1, 2, 3, 4, 5, 6].map((t) => turnNumber(game(t), 1))).toEqual([0, 1, 1, 2, 2, 3]);
    let g = inTurn(5);
    expect(strategicView(g, 0).turnNumber).toBe(1);
    g = ok(confirmHandoff(ok(endStrategicTurn(g))));
    expect(strategicView(g, 1).turnNumber).toBe(1);
    g = ok(confirmHandoff(ok(endStrategicTurn(g))));
    expect(strategicView(g, 0).turnNumber).toBe(2);
  });
});

describe("strategicView", () => {
  it("shows the viewer their own units, base, explored ground and no enemies at the start (30 seeds)", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = inTurn(seed);
      const map = mapOfGame(g);
      for (const p of [0, 1] as PlayerIndex[]) {
        const v = strategicView(g, p);
        expect(v.viewer).toBe(p);
        expect(v.map).toBe(map);
        expect(NEW_GAME_MAP_IDS).toContain(v.map.id);
        expect(v.base).toEqual(g.strategic!.bases[p]);
        expect(v.units.map((u) => ({ id: u.id, type: u.type, x: u.x, y: u.y, upright: u.upright, hits: 0 }))).toEqual(g.players[p].units);
        expect(v.units.every((u) => u.owner === p && u.current && u.state === "normal" && u.hp === u.maxHp)).toBe(true);
        expect(v.enemies).toEqual([]);
        for (const i of v.visible) expect(v.explored.has(i)).toBe(true);
        for (const i of squaresOfRect({ ...v.base, ...BASE_GRID }, map)) expect(v.explored.has(i)).toBe(true);
        expect(v.exploredPercent).toBeGreaterThan(0);
        expect(v.exploredPercent).toBeLessThan(100);
        expect(v.exploredPercent).toBe(Math.round((100 * v.explored.size) / (map.w * map.h)));
      }
    }
  });

  it("never lists an enemy that is neither in sight nor in lastSeen", () => {
    for (let seed = 31; seed <= 45; seed++) {
      const g = structuredClone(inTurn(seed));
      const map = mapOfGame(g);
      // Scatter the enemy over the map, some in sight and some not.
      const rng = new Rng(seed);
      for (const u of g.players[1].units) {
        u.x = rng.int(0, map.w - 3);
        u.y = rng.int(0, map.h - 3);
      }
      const v = strategicView(g, 0);
      const lastSeen = g.strategic!.lastSeen[0];
      for (const e of v.enemies) {
        const live = g.players[1].units.find((u) => u.id === e.id)!;
        if (e.current) expect(unitSeen(live, v.visible, map)).toBe(true);
        else expect(lastSeen.some((s) => s.id === e.id)).toBe(true);
      }
      const listed = new Set(v.enemies.map((e) => e.id));
      for (const u of g.players[1].units) {
        if (!listed.has(u.id)) expect(unitSeen(u, v.visible, map)).toBe(false);
      }
    }
  });

  it("shows an enemy in sight as current, then as a faded last sighting once it moves out of sight", () => {
    const g = structuredClone(inTurn(3));
    const fort = g.players[0].units.find((u) => u.type === "fort")!;
    const scout = g.players[1].units.find((u) => u.type === "infantry")!;
    scout.x = fort.x + 4; // one square inside the fort's sight (4 beyond its right edge is x + 3 + 3)
    scout.y = fort.y + 1;
    const sighting = { id: scout.id, type: "infantry", x: scout.x, y: scout.y, upright: false, state: "normal", hp: 1, turn: 1 };
    const drawn = { id: scout.id, type: "infantry", x: scout.x, y: scout.y, upright: false, state: "normal", hp: 1, maxHp: 1, owner: 1 };
    expect(strategicView(g, 0).enemies).toEqual([{ ...drawn, current: true }]);
    expect(strategicView(g, 1).enemies.length).toBeGreaterThan(0); // the scout sees the fort back
    // Ending the turn records the sighting; the scout then slips away.
    const ended = ok(endStrategicTurn(g));
    expect(ended.strategic!.lastSeen[0]).toEqual([sighting]);
    const later = structuredClone(ended);
    later.phase = "turn";
    later.players[1].units.find((u) => u.id === scout.id)!.x = mapOfGame(g).w - 2;
    expect(strategicView(later, 0).enemies).toEqual([{ ...drawn, current: false, seenTurn: 1 }]);
    // A fresh sighting replaces the old record rather than adding a second one.
    const back = lookAround(g, 0);
    expect(lookAround(back, 0).strategic!.lastSeen[0]).toHaveLength(1);
  });

  it("exploredPercent rounds to whole percent", () => {
    expect(exploredPercent(new Set(), medium)).toBe(0);
    expect(exploredPercent(new Set([1, 2, 3, 4]), medium)).toBe(1); // 0.5% rounds up
    expect(exploredPercent(new Set([1, 2, 3]), medium)).toBe(0);
    expect(exploredPercent(new Set(Array.from({ length: 800 }, (_, i) => i)), medium)).toBe(100);
  });

  it("refuses a game that has no map yet", () => {
    expect(() => strategicView(builtStrategic(1).before, 0)).toThrow();
  });
});
