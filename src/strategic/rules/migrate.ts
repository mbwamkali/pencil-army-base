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
  // A saved game is mid-turn, so that turn's automatic actions count as done.
  s.autoDoneTurn ??= game.turn;
  s.shots ??= [];
  s.events ??= [];
  s.nextInfantry ??= [STRATEGIC_ARMY.infantry + 1, STRATEGIC_ARMY.infantry + 1];
  s.nextShot ??= (s.shots.at(-1)?.id ?? 0) + 1;
  return game;
}
