import type { UnitType } from "../../rules/constants.ts";
import type { Unit, UnitState } from "../../rules/units.ts";
import { MODES, type Grid } from "../../rules/modes.ts";
import type { MapSize } from "./types.ts";

/**
 * A Strategic base is built on today's build screen at Skirmish size, then dropped onto the map.
 * It is the mode's grid, so the build screen, Random layout and layout codes work unchanged.
 */
export const BASE_GRID: Grid = MODES.strategic.grid;

/** The Strategic army: the Skirmish army plus one extra tank and a troop truck. */
export const STRATEGIC_ARMY: Record<UnitType, number> = MODES.strategic.army;

/**
 * How far each unit sees, in squares beyond the edge of its footprint. A square is in sight when
 * its centre is within this distance of the nearest point of the unit. Walls see nothing but their
 * own squares.
 */
export const SIGHT: Record<UnitType, number> = { fort: 4, tank: 3, artillery: 2, infantry: 1, wall: 0, truck: 2 };

/** Map sizes in squares. New games are played on Large maps; Medium 1 stays so old saves still load. */
export const MAP_SIZES: Record<MapSize, Grid> = {
  small: { w: 30, h: 15 },
  medium: { w: 40, h: 20 },
  large: { w: 60, h: 30 },
};

/** Hit points: how much damage destroys a unit. A fort takes six, infantry fall to anything. */
export const HP: Record<UnitType, number> = { fort: 6, tank: 3, artillery: 2, infantry: 1, wall: 1, truck: 2 };

/** Damage dealt: an artillery shell, a tank's gun, infantry hand to hand. */
export const DAMAGE = { shell: 3, tank: 2, infantry: 1 } as const;

/** Squares a unit may move in one turn (8 directions, each step costs 1). Forts, artillery and walls never move. */
export const MOVE: Record<UnitType, number> = { fort: 0, tank: 3, artillery: 0, infantry: 1, wall: 0, truck: 5 };

/** A tank may fire at a visible enemy whose nearest square is at most this many squares from its own. */
export const TANK_RANGE = 2;

/** A shell must be aimed at least this far (straight line) from the artillery's own footprint. */
export const ARTILLERY_MIN_RANGE = 3;

/** A shell fired from the minimum range drifts this far at most from where it was aimed... */
export const SHAKE_RADIUS = 0.75;
/** ...and a twentieth of a square more for every square of range beyond that... */
export const SHAKE_PER_SQUARE = 0.05;
/** ...but never more than this, so a shell aimed across the map still lands near the aim. */
export const SHAKE_MAX = 2;

/**
 * How far a shell may drift when aimed `distance` squares (straight line) from the gun's own
 * footprint: 0.75 squares at the minimum range of 3, 1.25 at 13, 1.75 at 23 and the full 2 squares
 * from 28 on. Enough that a shot is never certain, small enough that aiming matters: the enemy base
 * lands at a random spot, so a player has to find it before shelling it pays.
 */
export function shakeRadius(distance: number): number {
  return Math.min(SHAKE_MAX, SHAKE_RADIUS + SHAKE_PER_SQUARE * Math.max(0, distance - ARTILLERY_MIN_RANGE));
}

/** Columns kept clear between a base and the centre line, so two bases start at least 8 columns apart and out of each other's sight. */
export const CENTRE_GAP = 4;

/** Infantry a truck carries along when it moves. */
export const TRUCK_CAPACITY = 4;

/** The fort sends out this many infantry at the start of each of its owner's turns, from this turn of theirs. */
export const SPAWN_PER_TURN = 1;
export const SPAWN_FROM_TURN = 2;

/** Units that take orders: everything else acts on its own (infantry, fort) or stands still (walls). */
export const ACTIVE_TYPES: readonly UnitType[] = ["tank", "artillery", "truck"];

/** Hit points a unit has left. */
export function hpLeft(u: Pick<Unit, "type" | "hits">): number {
  return Math.max(0, HP[u.type] - u.hits);
}

/** A unit's state in Strategic, where units have hit points rather than the Quick action hit counts. */
export function stateOf(u: Pick<Unit, "type" | "hits">): UnitState {
  if (u.hits >= HP[u.type]) return "destroyed";
  return u.hits > 0 ? "damaged" : "normal";
}

export const isAlive = (u: Pick<Unit, "type" | "hits">): boolean => stateOf(u) !== "destroyed";
