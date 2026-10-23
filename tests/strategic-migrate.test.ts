import { describe, expect, it } from "vitest";
import { confirmHandoff, createGame, finishBuild, randomLayout, type Game, type PlayerIndex } from "../src/rules/index.ts";
import { beginStrategicTurn, endStrategicTurn, upgradeStrategic } from "../src/strategic/rules/index.ts";

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
