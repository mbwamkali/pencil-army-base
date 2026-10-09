import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAMES,
  confirmHandoff,
  createGame,
  nextDefaultName,
  randomDefaultNames,
  endTurn,
  finishBuild,
  fire,
  isRepeatOfMiss,
  ownView,
  placeUnit,
  randomLayout,
  setName,
  shotStats,
  targetView,
  unitsLeft,
  isArmyComplete,
  placementProblem,
  type Game,
  type PlayerIndex,
} from "../src/rules/index.ts";
import { EMPTY_SPOT_A, LAYOUT_A, centreOf, gameInBattle, placeAll } from "./helpers.ts";

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`failed: ${(r as unknown as { reason: string }).reason}`);
  return r as Extract<T, { ok: true }>;
}

describe("a new game", () => {
  it("is the same for the same seed and can differ between seeds", () => {
    expect(createGame({ seed: 7 })).toEqual(createGame({ seed: 7 }));
    const firsts = new Set(Array.from({ length: 20 }, (_, s) => createGame({ seed: s }).firstShooter));
    expect(firsts).toEqual(new Set([0, 1]));
  });

  it("gives each player a different default pencil-themed name", () => {
    for (let seed = 0; seed < 50; seed++) {
      const [a, b] = createGame({ seed }).players;
      expect(a.name).not.toBe(b.name);
      expect(DEFAULT_NAMES).toContain(a.name);
      expect(DEFAULT_NAMES).toContain(b.name);
    }
  });

  it("uses typed names, and a blank name falls back to a default", () => {
    const g = createGame({ seed: 1, names: ["Ana", "  "] });
    expect(g.players[0].name).toBe("Ana");
    expect(DEFAULT_NAMES).toContain(g.players[1].name);
    const renamed = setName(g, 1, "Ben");
    expect(renamed.players[1].name).toBe("Ben");
    const cleared = setName(renamed, 1, "");
    expect(cleared.players[1].name).not.toBe(cleared.players[0].name);
  });

  it("starts in the build phase with player 1 building first", () => {
    const g = createGame({ seed: 1 });
    expect(g).toMatchObject({ phase: "build", building: 0, turn: 1, winner: null });
  });
});

describe("turn flow", () => {
  it("goes build, handoff, build, handoff, then turn one for the random first shooter", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      let g = createGame({ seed });
      g = placeAll(g, 0, LAYOUT_A);
      g = ok(finishBuild(g, 0)).game;
      expect(g).toMatchObject({ phase: "handoff", handoff: { to: 1, then: "build" } });
      g = ok(confirmHandoff(g)).game;
      expect(g).toMatchObject({ phase: "build", building: 1 });
      g = placeAll(g, 1, LAYOUT_A);
      g = ok(finishBuild(g, 1)).game;
      expect(g).toMatchObject({ phase: "handoff", handoff: { to: g.firstShooter, then: "turn" } });
      g = ok(confirmHandoff(g)).game;
      expect(g).toMatchObject({ phase: "turn", current: g.firstShooter, turn: 1, shotFired: false });
    }
  });

  it("nothing can be fired during a handoff", () => {
    let g = createGame({ seed: 1 });
    g = ok(finishBuild(placeAll(g, 0, LAYOUT_A), 0)).game;
    expect(fire(g, 1, 1)).toEqual({ ok: false, reason: "wrong_phase" });
  });

  it("allows exactly one shot per turn", () => {
    const g = gameInBattle();
    const f = ok(fire(g, 5.5, 5.5));
    expect(fire(f.game, 5.5, 5.5)).toEqual({ ok: false, reason: "shot_already_fired" });
  });

  it("needs a shot before End turn, then alternates shooters through a handoff", () => {
    let g = gameInBattle();
    const first = g.current;
    expect(endTurn(g)).toEqual({ ok: false, reason: "shot_not_fired" });
    g = ok(fire(g, EMPTY_SPOT_A.x, EMPTY_SPOT_A.y)).game;
    g = ok(endTurn(g)).game;
    expect(g).toMatchObject({ phase: "handoff", handoff: { to: first === 0 ? 1 : 0, then: "turn" }, turn: 2 });
    g = ok(confirmHandoff(g)).game;
    expect(g).toMatchObject({ phase: "turn", current: first === 0 ? 1 : 0, shotFired: false });
  });

  it("records each shot with the player who fired it and applies it to the other base", () => {
    let g = gameInBattle();
    const shooter = g.current;
    const c = centreOf(LAYOUT_A, "tank-1");
    g = ok(fire(g, c.x, c.y)).game;
    expect(g.players[shooter].shots).toHaveLength(1);
    expect(g.players[shooter].shots[0]).toMatchObject({ outcome: "destroyed", turn: 1 });
    const victim = shooter === 0 ? 1 : 0;
    expect(unitsLeft(g.players[victim].units).total).toBe(12);
    expect(unitsLeft(g.players[shooter].units).total).toBe(13);
  });

  it("does not mutate the game it was given", () => {
    const g = gameInBattle();
    const snapshot = structuredClone(g);
    fire(g, 1, 1);
    expect(g).toEqual(snapshot);
  });

  it("survives a save and load as plain JSON", () => {
    let g = gameInBattle();
    g = ok(fire(g, 9.5, 4.5)).game;
    const loaded: Game = JSON.parse(JSON.stringify(g));
    expect(loaded).toEqual(g);
    expect(ok(endTurn(loaded)).game.turn).toBe(2);
  });
});

describe("winning", () => {
  /** Player A shoots every fighting unit dead while B fires at an empty spot. */
  function playToTheEnd(g0: Game) {
    let g = g0;
    const winner = g.current;
    const targets = LAYOUT_A.filter((p) => !p.id.startsWith("wall")).map((p) => p.id);
    const counters: number[] = [];
    let missTurns = 0;
    for (const id of targets) {
      const c = centreOf(LAYOUT_A, id);
      const shotsNeeded = id === "fort-1" ? 2 : 1;
      for (let i = 0; i < shotsNeeded; i++) {
        // Walls may stand in the way; keep firing at the same spot until the unit is hit.
        for (;;) {
          const f = ok(fire(g, c.x, c.y));
          g = f.game;
          counters.push(unitsLeft(g.players[winner === 0 ? 1 : 0].units).total);
          if (f.result.outcome !== "wall") break;
          g = ok(confirmHandoff(ok(endTurn(g)).game)).game;
          g = ok(fire(g, EMPTY_SPOT_A.x, EMPTY_SPOT_A.y)).game;
          missTurns++;
          g = ok(confirmHandoff(ok(endTurn(g)).game)).game;
        }
        if (g.phase === "over") return { g, winner, counters, missTurns };
        g = ok(confirmHandoff(ok(endTurn(g)).game)).game;
        g = ok(fire(g, EMPTY_SPOT_A.x, EMPTY_SPOT_A.y)).game;
        missTurns++;
        g = ok(confirmHandoff(ok(endTurn(g)).game)).game;
      }
    }
    return { g, winner, counters, missTurns };
  }

  it("ends the game the moment the last fighting unit goes, with walls still standing", () => {
    const { g, winner, counters } = playToTheEnd(gameInBattle());
    expect(g.phase).toBe("over");
    expect(g.winner).toBe(winner);
    const loser = winner === 0 ? 1 : 0;
    const left = unitsLeft(g.players[loser].units);
    expect(left.total).toBe(0);
    expect(left.wallsLeft).toBeGreaterThan(0);
    expect(counters.at(-1)).toBe(0);
    // the counter only ever goes down, one fighting unit at a time
    for (let i = 1; i < counters.length; i++) expect(counters[i - 1]! - counters[i]!).toBeLessThanOrEqual(1);
  });

  it("allows nothing after the game is over", () => {
    const { g } = playToTheEnd(gameInBattle());
    expect(fire(g, 1, 1)).toEqual({ ok: false, reason: "wrong_phase" });
    expect(endTurn(g)).toEqual({ ok: false, reason: "wrong_phase" });
  });

  it("counts hit rate as shots that destroyed at least one unit", () => {
    const { g, winner } = playToTheEnd(gameInBattle());
    const stats = shotStats(g.players[winner]);
    expect(stats.shots).toBeGreaterThanOrEqual(14);
    expect(stats.hits).toBeLessThan(stats.shots); // the fort's first hit only damages
    expect(shotStats(g.players[winner === 0 ? 1 : 0]).hits).toBe(0);
  });
});

describe("what each player may see", () => {
  it("shows the shooter no undamaged enemy unit, only shot marks", () => {
    const g = gameInBattle();
    const view = targetView(g, g.current);
    expect(view.revealed).toEqual([]);
    expect(view.shots).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("tank");
  });

  it("reveals only destroyed units and damaged forts, and keeps earlier shots", () => {
    let g = gameInBattle();
    const shooter = g.current;
    const tank = centreOf(LAYOUT_A, "tank-1");
    g = ok(fire(g, tank.x, tank.y)).game;
    g = ok(confirmHandoff(ok(endTurn(g)).game)).game;
    g = ok(fire(g, EMPTY_SPOT_A.x, EMPTY_SPOT_A.y)).game;
    g = ok(confirmHandoff(ok(endTurn(g)).game)).game;
    const fort = centreOf(LAYOUT_A, "fort-1");
    g = ok(fire(g, fort.x, fort.y)).game;
    const view = targetView(g, shooter);
    expect(view.shots).toHaveLength(2);
    expect(view.revealed.map((r) => [r.id, r.state]).sort()).toEqual([
      ["fort-1", "damaged"],
      ["tank-1", "destroyed"],
    ]);
  });

  it("shows a player their own base plus the enemy's last shot", () => {
    let g = gameInBattle();
    const shooter = g.current;
    const victim: PlayerIndex = shooter === 0 ? 1 : 0;
    g = ok(fire(g, EMPTY_SPOT_A.x, EMPTY_SPOT_A.y)).game;
    const view = ownView(g, victim);
    expect(view.units).toHaveLength(17);
    expect(view.lastIncoming).toMatchObject({ x: EMPTY_SPOT_A.x, outcome: "miss" });
  });

  it("warns about repeating a spot that was empty last time", () => {
    let g = gameInBattle();
    const shooter = g.current;
    g = ok(fire(g, EMPTY_SPOT_A.x, EMPTY_SPOT_A.y)).game;
    expect(isRepeatOfMiss(g, shooter, EMPTY_SPOT_A.x + 0.3, EMPTY_SPOT_A.y)).toBe(true);
    expect(isRepeatOfMiss(g, shooter, 12, 7)).toBe(false);
    expect(isRepeatOfMiss(g, shooter === 0 ? 1 : 0, EMPTY_SPOT_A.x, EMPTY_SPOT_A.y)).toBe(false);
  });
});

describe("random layout", () => {
  it("always fills a valid army", () => {
    for (let seed = 0; seed < 60; seed++) {
      const g = randomLayout(createGame({ seed }), 0);
      const units = g.players[0].units;
      expect(isArmyComplete(units)).toBe(true);
      expect(units).toHaveLength(17);
      units.forEach((u, i) => {
        const others = units.filter((_, j) => j !== i);
        expect(placementProblem(others, u)).toBeNull();
      });
      expect(ok(finishBuild(g, 0)).game.phase).toBe("handoff");
    }
  });

  it("is repeatable from a seed and different the second time", () => {
    const a = randomLayout(createGame({ seed: 5 }), 0);
    expect(randomLayout(createGame({ seed: 5 }), 0)).toEqual(a);
    expect(randomLayout(a, 0).players[0].units).not.toEqual(a.players[0].units);
  });

  it("replaces what was already placed", () => {
    const g = ok(placeUnit(createGame({ seed: 3 }), 0, "tank-1", 0, 0)).game;
    expect(randomLayout(g, 0).players[0].units).toHaveLength(17);
  });
});

describe("default player names", () => {
  it("starts the setup screen with two different pencil names", () => {
    for (let i = 0; i < 50; i++) {
      const [a, b] = randomDefaultNames(Math.random);
      expect(DEFAULT_NAMES).toContain(a);
      expect(DEFAULT_NAMES).toContain(b);
      expect(a).not.toBe(b);
    }
  });

  it("shuffles to a name that is neither the current one nor the other player's", () => {
    for (let i = 0; i < 100; i++) {
      const next = nextDefaultName("General Graphite", "Colonel Eraser", Math.random);
      expect(DEFAULT_NAMES).toContain(next);
      expect(next).not.toBe("General Graphite");
      expect(next).not.toBe("Colonel Eraser");
    }
  });
});
