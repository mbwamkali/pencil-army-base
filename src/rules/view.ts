import type { UnitType } from "./constants.ts";
import { type Game, type PlayerIndex } from "./game.ts";
import type { ShotResult } from "./shots.ts";
import { unitState, type Unit, type UnitState } from "./units.ts";

export interface RevealedUnit {
  id: string;
  type: UnitType;
  x: number;
  y: number;
  upright: boolean;
  state: Exclude<UnitState, "normal">;
}

/**
 * What the shooter may see of the enemy base: their own shot marks, plus enemy units that are
 * damaged or destroyed. Undamaged enemy units are never included, so nothing here can leak them.
 */
export function targetView(game: Game, viewer: PlayerIndex): { shots: ShotResult[]; revealed: RevealedUnit[] } {
  const enemy = game.players[viewer === 0 ? 1 : 0];
  const revealed: RevealedUnit[] = [];
  for (const u of enemy.units) {
    const state = unitState(u);
    if (state === "normal") continue;
    revealed.push({ id: u.id, type: u.type, x: u.x, y: u.y, upright: u.upright, state });
  }
  return { shots: game.players[viewer].shots, revealed };
}

/** The viewer's own base with every unit, plus where the enemy has fired at it. */
export function ownView(
  game: Game,
  viewer: PlayerIndex,
): { units: Unit[]; incomingShots: ShotResult[]; lastIncoming: ShotResult | null } {
  const incoming = game.players[viewer === 0 ? 1 : 0].shots;
  return { units: game.players[viewer].units, incomingShots: incoming, lastIncoming: incoming.at(-1) ?? null };
}
