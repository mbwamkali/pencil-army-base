import type { Game, PlayerIndex } from "../../rules/game.ts";
import { HP, stateOf } from "./constants.ts";

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

export interface DamageResult {
  game: Game;
  /** Hit points the unit had before and after. */
  before: number;
  after: number;
  destroyed: boolean;
}

/**
 * Hurt one unit. Hits never go past the unit's hit points, so a destroyed unit stays exactly
 * destroyed. When a fort falls the game is over: whoever owns the other fort wins, whatever hurt it
 * (a stray shell on your own fort still loses you the game). Returns a new game.
 */
export function applyDamage(game: Game, owner: PlayerIndex, unitId: string, amount: number, by: PlayerIndex): DamageResult {
  return damageInPlace(structuredClone(game), owner, unitId, amount, by);
}

/**
 * applyDamage on a game the caller already owns (a copy it made itself), changed in place. The start
 * of a turn hurts many units one after another, and copying the whole game for every blow was the
 * slow part of tapping Start late in a long game.
 */
export function damageInPlace(g: Game, owner: PlayerIndex, unitId: string, amount: number, by: PlayerIndex): DamageResult {
  const u = g.players[owner].units.find((v) => v.id === unitId);
  if (!u || amount <= 0) return { game: g, before: 0, after: 0, destroyed: false };
  const before = Math.max(0, HP[u.type] - u.hits);
  u.hits = Math.min(HP[u.type], u.hits + amount);
  const after = Math.max(0, HP[u.type] - u.hits);
  const destroyed = before > 0 && stateOf(u) === "destroyed";
  if (destroyed && u.type === "fort" && g.phase !== "over") {
    g.phase = "over";
    g.winner = other(owner);
    g.strategic?.events.push({ kind: "fort-destroyed", turn: g.turn, player: owner, by });
  }
  return { game: g, before, after, destroyed };
}
