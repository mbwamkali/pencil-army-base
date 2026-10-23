import type { UnitType } from "../../rules/constants.ts";
import { MODES, type Grid } from "../../rules/modes.ts";
import type { MapSize } from "./types.ts";

/**
 * A Strategic base is built on today's build screen at Skirmish size, then dropped onto the map.
 * It is the mode's grid, so the build screen, Random layout and layout codes work unchanged.
 */
export const BASE_GRID: Grid = MODES.strategic.grid;

/** The Strategic army: the Skirmish army plus one extra tank. */
export const STRATEGIC_ARMY: Record<UnitType, number> = MODES.strategic.army;

/**
 * How far each unit sees, in squares beyond the edge of its footprint. A square is in sight when
 * its centre is within this distance of the nearest point of the unit. Walls see nothing but their
 * own squares.
 */
export const SIGHT: Record<UnitType, number> = { fort: 4, tank: 3, artillery: 2, infantry: 1, wall: 0 };

/** Map sizes in squares. Only Medium has a map in this build; Small and Large follow. */
export const MAP_SIZES: Record<MapSize, Grid> = {
  small: { w: 30, h: 15 },
  medium: { w: 40, h: 20 },
  large: { w: 60, h: 30 },
};
