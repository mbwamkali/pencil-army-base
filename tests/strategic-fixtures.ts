import { confirmHandoff, createGame, finishBuild, randomLayout, type Game, type PlayerIndex } from "../src/rules/index.ts";
import { mapOf, placeBases, type Point, type StrategicMap } from "../src/strategic/rules/index.ts";

/**
 * Shared set-ups for the Strategic tests. New games land on a random map at random base spots, so
 * a test that hand-places units on known ground first moves the game onto Medium 1 with the bases
 * where stage 3 put them.
 */

export function ok(r: { ok: boolean; game?: Game; reason?: string }): Game {
  if (!r.ok) throw new Error(r.reason);
  return r.game as Game;
}

/** Where stage 3 put the bases on Medium 1: player 1 at (2,7) and player 2 at (26,7), the same spot turned half a circle. */
export const MEDIUM_BASES: [Point, Point] = [
  { x: 2, y: 7 },
  { x: 26, y: 7 },
];

export const medium: StrategicMap = mapOf("medium-1");

/** The map a set-up game is played on. */
export const mapOfGame = (g: Game): StrategicMap => mapOf(g.strategic?.map);

/**
 * Both bases built with Random layout: player 2 has just tapped Done, so startStrategic has drawn
 * the map and both spots, and the game waits on the handoff screen before player 1's first turn.
 */
export function builtGame(seed: number): Game {
  let g = createGame({ seed, mode: "strategic" });
  g = randomLayout(g, 0);
  g = ok(finishBuild(g, 0));
  g = ok(confirmHandoff(g));
  g = randomLayout(g, 1);
  return ok(finishBuild(g, 1));
}

/**
 * A game that has just been set up, moved onto another map and base spots (by default Medium 1
 * with the stage 3 spots), as though startStrategic had drawn those. The Rng state stays as it was
 * drawn. Only for a game no turn has touched yet: the units go back to base squares and are
 * dropped again.
 */
export function onMap(game: Game, mapId = "medium-1", bases: [Point, Point] = MEDIUM_BASES): Game {
  const s = game.strategic;
  if (!s) throw new Error("onMap needs a game that has been set up");
  const g = structuredClone(game);
  for (const p of [0, 1] as PlayerIndex[]) {
    g.players[p].units = g.players[p].units.map((u) => ({ ...u, x: u.x - s.bases[p].x, y: u.y - s.bases[p].y }));
  }
  delete g.strategic;
  return placeBases(g, mapId, bases);
}

/** builtGame on Medium 1 with the stage 3 spots, for tests that need known ground. */
export const builtOnMedium = (seed: number): Game => onMap(builtGame(seed));
