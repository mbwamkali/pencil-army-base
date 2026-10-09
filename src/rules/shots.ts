import { GRID_H, GRID_W, SHOT_RADIUS } from "./constants.ts";
import type { UnitType } from "./constants.ts";
import { rectOf, unitState, type Rect, type Unit, type UnitState } from "./units.ts";

export type ShotOutcome = "miss" | "wall" | "damaged" | "destroyed";

export interface ShotHit {
  unitId: string;
  type: UnitType;
  before: UnitState;
  after: UnitState;
}

export interface ShotResult {
  /** Shot centre in grid squares (0..20 across, 0..10 down), exactly where the player aimed. */
  x: number;
  y: number;
  /** Turn number the shot was fired on (1 for the first shot of the game). */
  turn: number;
  outcome: ShotOutcome;
  /** Units that took a hit. When a wall absorbs the blow these are the walls only. */
  hits: ShotHit[];
  destroyed: string[];
  damaged: string[];
}

/** True when the circle overlaps the rectangle (touching an edge only does not count). */
export function circleHitsRect(cx: number, cy: number, r: number, rect: Rect): boolean {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

export function clampShot(x: number, y: number): { x: number; y: number } {
  return { x: Math.max(0, Math.min(GRID_W, x)), y: Math.max(0, Math.min(GRID_H, y)) };
}

/**
 * Resolve one shot against a base. Pure: returns the changed units and what happened.
 *
 * - Every unit the circle overlaps takes one hit, but units already destroyed are ignored.
 * - If the circle touches a standing wall, the wall(s) absorb the blow: they are destroyed and
 *   every other unit under the shot is unharmed. Destroyed walls no longer protect anything.
 * - Forts take two hits (normal -> damaged -> destroyed); everything else takes one.
 */
export function resolveShot(
  units: readonly Unit[],
  rawX: number,
  rawY: number,
  turn: number,
): { units: Unit[]; result: ShotResult } {
  const { x, y } = clampShot(rawX, rawY);
  const touched = units.filter(
    (u) => unitState(u) !== "destroyed" && circleHitsRect(x, y, SHOT_RADIUS, rectOf(u)),
  );
  const walls = touched.filter((u) => u.type === "wall");
  const struck = walls.length > 0 ? walls : touched;
  const ids = new Set(struck.map((u) => u.id));

  const hits: ShotHit[] = [];
  const next = units.map((u) => {
    if (!ids.has(u.id)) return u;
    const after = { ...u, hits: u.hits + 1 };
    hits.push({ unitId: u.id, type: u.type, before: unitState(u), after: unitState(after) });
    return after;
  });

  const destroyed = hits.filter((h) => h.after === "destroyed").map((h) => h.unitId);
  const damaged = hits.filter((h) => h.after === "damaged").map((h) => h.unitId);
  const outcome: ShotOutcome =
    hits.length === 0 ? "miss" : walls.length > 0 ? "wall" : destroyed.length > 0 ? "destroyed" : "damaged";

  return { units: next, result: { x, y, turn, outcome, hits, destroyed, damaged } };
}
