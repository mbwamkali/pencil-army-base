import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGame, replay, unitsLeft, type GameRecord } from "../src/rules/index.ts";

/**
 * Golden games: recorded games whose exact outcome must never change. If one of these fails after a
 * change to the rules, either the change broke something or the rules changed on purpose, in which
 * case regenerate with `node scripts/make-golden.ts` and review the diff.
 */
const dir = new URL("./golden/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("golden games", () => {
  it("has fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  for (const file of files) {
    it(`replays ${file} to the same ending`, () => {
      const { record, expected } = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as {
        record: GameRecord;
        expected: {
          firstShooter: number;
          winner: number;
          turns: number;
          shots: number;
          outcomes: string[];
          destroyedInOrder: string[];
          loserFightingLeft: number;
          loserWallsLeft: number;
        };
      };
      expect(createGame({ seed: record.seed }).firstShooter).toBe(expected.firstShooter);
      const { game, results } = replay(record);
      expect(game.phase).toBe("over");
      expect(game.winner).toBe(expected.winner);
      expect(game.turn).toBe(expected.turns);
      expect(results).toHaveLength(expected.shots);
      expect(results.map((r) => r.outcome)).toEqual(expected.outcomes);
      expect(results.flatMap((r) => r.destroyed)).toEqual(expected.destroyedInOrder);
      const loser = expected.winner === 0 ? 1 : 0;
      expect(unitsLeft(game.players[loser]!.units).total).toBe(expected.loserFightingLeft);
      expect(unitsLeft(game.players[loser]!.units).wallsLeft).toBe(expected.loserWallsLeft);
    });
  }

  it("includes a wall absorbing a shot and a fort that took two hits", () => {
    const all = files.map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")).expected.outcomes as string[]).flat();
    expect(all).toContain("wall");
    expect(all).toContain("damaged");
  });
});
