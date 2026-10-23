import type { Game, Outcome, PlayerIndex } from "../../rules/game.ts";
import { isStrategic, modeOf } from "../../rules/modes.ts";
import { lookAround } from "./fog.ts";

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

/**
 * End turn in Strategic: the player's units take a last look around (so everything in sight stays
 * explored), the turn counter moves on and the phone goes to the black handoff screen for the other
 * player. Nothing moves or shoots yet; that comes in later builds.
 */
export function endStrategicTurn(game: Game): Outcome {
  if (game.phase !== "turn" || !isStrategic(modeOf(game.mode)) || !game.strategic) return { ok: false, reason: "wrong_phase" };
  const g = lookAround(game, game.current);
  g.turn += 1;
  g.phase = "handoff";
  g.handoff = { to: other(g.current), then: "turn" };
  return { ok: true, game: g };
}
