import type { UnitType } from "../rules/constants.ts";
import { pointsByType, scoreOf, shotStats, type Game, type PlayerIndex } from "../rules/game.ts";

/** The units that score points, in the order the end-of-game summary lists them. Walls score nothing. */
export const SCORING_TYPES: readonly UnitType[] = ["infantry", "tank", "artillery", "fort"];

export const SUMMARY_HEADERS = ["Shots", "Hit rate", "Infantry", "Tanks", "Artillery", "Fort", "Points"] as const;

export interface SummaryRow {
  name: string;
  /** The cells under SUMMARY_HEADERS, as the text to show. */
  cells: string[];
}

/**
 * One row per player: shots fired, hit rate (the share of shots that destroyed something),
 * points from each unit type with the number of hits in brackets, and the total.
 */
export function summaryRows(game: Game): SummaryRow[] {
  return ([0, 1] as PlayerIndex[]).map((p) => {
    const player = game.players[p];
    const { shots, hits } = shotStats(player);
    const byType = pointsByType(player);
    return {
      name: player.name,
      cells: [
        String(shots),
        shots === 0 ? "0%" : `${Math.round((hits / shots) * 100)}%`,
        ...SCORING_TYPES.map((t) => `${byType[t].points} (${byType[t].hits})`),
        String(scoreOf(player)),
      ],
    };
  });
}
