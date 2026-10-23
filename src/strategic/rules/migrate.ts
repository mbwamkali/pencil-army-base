import type { Game } from "../../rules/game.ts";
import { STRATEGIC_ARMY } from "./constants.ts";

/**
 * Fills in whatever a saved Strategic game from an earlier test build lacks, so it still loads.
 * The first build saved only the map, bases, fog and sightings. Changes the game in place and
 * returns it.
 */
export function upgradeStrategic(game: Game): Game {
  const s = game.strategic;
  if (!s) return game;
  s.orders ??= {};
  // A game saved mid-turn has had that turn's automatic actions (none, in the first build). One
  // saved on the handoff screen is already stamped with the next turn's number, and that turn's
  // infantry step and spawn have yet to run, so they must not count as done.
  s.autoDoneTurn ??= game.phase === "handoff" ? game.turn - 1 : game.turn;
  s.shots ??= [];
  s.events ??= [];
  s.nextInfantry ??= [STRATEGIC_ARMY.infantry + 1, STRATEGIC_ARMY.infantry + 1];
  s.nextShot ??= (s.shots.at(-1)?.id ?? 0) + 1;
  return game;
}
