import { describe, expect, it } from "vitest";
import { confirmHandoff, createGame, finishBuild, randomLayout, rectOf, rectsOverlap, type Game, type PlayerIndex } from "../src/rules/index.ts";
import {
  beginStrategicTurn,
  endStrategicTurn,
  fireArtillery,
  insideMap,
  isAlive,
  isBlocked,
  moveUnit,
  oppositeSpot,
  reachableFor,
  strategicView,
  upgradeStrategic,
} from "../src/strategic/rules/index.ts";
import { MEDIUM_BASES, builtOnMedium, medium } from "./strategic-fixtures.ts";

function ok(r: { ok: boolean; game?: Game; reason?: string }): Game {
  if (!r.ok) throw new Error(r.reason);
  return r.game!;
}

/** Both bases built at random: the game as the first test build saved it on the black handoff screen before turn 1. */
function builtGame(seed: number): Game {
  let g = createGame({ seed, mode: "strategic" });
  g = randomLayout(g, 0);
  g = ok(finishBuild(g, 0));
  g = ok(confirmHandoff(g));
  g = randomLayout(g, 1);
  return ok(finishBuild(g, 1));
}

/** The same game as the first test build would have saved it: the stage 2 fields stripped, through a JSON round trip. */
function stageOneSave(g: Game): Game {
  const copy = JSON.parse(JSON.stringify(g)) as Game;
  const s = copy.strategic as unknown as Record<string, unknown>;
  for (const field of ["orders", "autoDoneTurn", "shots", "events", "nextInfantry", "nextShot"]) delete s[field];
  return copy;
}

const infantryAt = (g: Game, p: PlayerIndex): string[] => g.players[p].units.filter((u) => u.type === "infantry").map((u) => `${u.x},${u.y}`);

describe("upgradeStrategic", () => {
  it("fills the stage 2 fields into a first-build save and leaves a stage 2 save alone", () => {
    const g = ok(confirmHandoff(builtGame(3)));
    const loaded = upgradeStrategic(stageOneSave(g));
    expect(loaded.strategic).toMatchObject({ orders: {}, shots: [], events: [], nextInfantry: [3, 3], nextShot: 1 });
    expect(upgradeStrategic(structuredClone(g))).toEqual(g);
    expect(upgradeStrategic(createGame({ seed: 1, mode: "skirmish" })).strategic).toBeUndefined();
  });

  it("a save made mid-turn counts that turn's automatic phase as done", () => {
    const g = ok(confirmHandoff(builtGame(3)));
    expect(g.phase).toBe("turn");
    const loaded = upgradeStrategic(stageOneSave(g));
    expect(loaded.strategic!.autoDoneTurn).toBe(g.turn);
    expect(beginStrategicTurn(loaded)).toBe(loaded);
  });

  it("a save made on the handoff screen still gives the next player their automatic phase", () => {
    for (const seed of [3, 5, 11]) {
      // Before turn 1: the first player's infantry step out when the turn begins.
      const built = builtGame(seed);
      expect(built.phase).toBe("handoff");
      const real = ok(confirmHandoff(built));
      const loaded = ok(confirmHandoff(upgradeStrategic(stageOneSave(built))));
      expect(infantryAt(real, 0)).not.toEqual(infantryAt(built, 0));
      expect(infantryAt(loaded, 0)).toEqual(infantryAt(real, 0));
      expect(loaded.strategic!.autoDoneTurn).toBe(real.strategic!.autoDoneTurn);

      // Between turns: the other player's infantry step and, from their second turn, the fort's new infantry.
      let g = real;
      for (let i = 0; i < 3; i++) {
        const ended = ok(endStrategicTurn(g));
        expect(ended.phase).toBe("handoff");
        const next = ok(confirmHandoff(ended));
        const fromSave = ok(confirmHandoff(upgradeStrategic(stageOneSave(ended))));
        expect(infantryAt(fromSave, next.current)).toEqual(infantryAt(next, next.current));
        expect(fromSave.players[next.current].units.length).toBe(next.players[next.current].units.length);
        g = next;
      }
      expect(g.players[0].units.length).toBe(10); // turn 2 of player 1 spawned one
    }
  });
});

describe("a game saved on Medium 1 by the stage 3 build", () => {
  /** Saved and loaded again, as the browser does: a JSON round trip, then upgradeStrategic. */
  const reload = (g: Game): Game => upgradeStrategic(JSON.parse(JSON.stringify(g)) as Game);

  /** Every living unit stands inside the map, off the terrain and on top of nobody else. */
  function sound(g: Game): boolean {
    const alive = [...g.players[0].units, ...g.players[1].units].filter((u) => isAlive(u));
    const onGround = alive.every((u) => {
      const r = rectOf(u);
      if (!insideMap(medium, r)) return false;
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (isBlocked(medium, x, y)) return false;
      return true;
    });
    return onGround && alive.every((a, i) => alive.every((b, j) => i === j || !rectsOverlap(rectOf(a), rectOf(b))));
  }

  it("still loads with its mirrored bases and plays on for several turns, orders and all", () => {
    // Stage 3 put every game on Medium 1, player 2 at player 1's spot turned half a circle.
    const saved = builtOnMedium(4);
    expect(saved.strategic!.map).toBe("medium-1");
    expect(saved.strategic!.bases).toEqual(MEDIUM_BASES);
    expect(MEDIUM_BASES[1]).toEqual(oppositeSpot(MEDIUM_BASES[0], medium));
    let g = ok(confirmHandoff(reload(saved)));
    for (let turn = 1; turn <= 8; turn++) {
      expect(g.phase).toBe("turn");
      expect(g.turn).toBe(turn);
      const p = g.current;
      // Each tank and the truck drive to the reachable square furthest toward the other half; the artillery fires across.
      for (const u of g.players[p].units.filter((v) => (v.type === "tank" || v.type === "truck") && isAlive(v))) {
        const reach = reachableFor(g, u.id);
        const best = reach.sort((a, b) => (p === 0 ? b.x - a.x : a.x - b.x) || a.y - b.y)[0];
        if (best) g = ok(moveUnit(g, u.id, best));
      }
      const gun = g.players[p].units.find((v) => v.type === "artillery" && isAlive(v));
      if (gun) g = ok(fireArtillery(g, gun.id, { x: p === 0 ? 30 : 10, y: 4 + turn }));
      expect(sound(g)).toBe(true);
      const view = strategicView(g, p);
      expect(view.map.id).toBe("medium-1");
      expect(view.base).toEqual(MEDIUM_BASES[p]);
      // Saved and loaded at the end of every turn, as the browser does.
      g = ok(confirmHandoff(reload(ok(endStrategicTurn(g)))));
    }
    const s = g.strategic!;
    expect(s.map).toBe("medium-1");
    expect(s.bases).toEqual(MEDIUM_BASES);
    expect(s.shots.length).toBeGreaterThan(3); // until a shell from the other side catches the gun
    expect(s.events.some((e) => e.kind === "spawn" && e.player === 0)).toBe(true);
    expect(s.events.some((e) => e.kind === "spawn" && e.player === 1)).toBe(true);
  });
});
