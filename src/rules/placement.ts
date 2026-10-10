import { WALL_SNAP_RANGE } from "./constants.ts";
import { FULL_GRID, type Grid } from "./modes.ts";
import { rectOf, rectsOverlap, type Rect, type Unit } from "./units.ts";

export type PlacementProblem =
  | "out_of_bounds"
  | "overlap"
  | "upright_only_for_walls"
  | "upright_not_beside_fort";

export interface Candidate {
  type: Unit["type"];
  x: number;
  y: number;
  upright: boolean;
}

/** Why a unit cannot go here, or null if it can. `others` are the units already placed (not the one being moved). */
export function placementProblem(others: readonly Unit[], c: Candidate, grid: Grid = FULL_GRID): PlacementProblem | null {
  if (c.upright && c.type !== "wall") return "upright_only_for_walls";
  const r = rectOf(c);
  if (r.x < 0 || r.y < 0 || r.x + r.w > grid.w || r.y + r.h > grid.h) return "out_of_bounds";
  if (others.some((o) => rectsOverlap(r, rectOf(o)))) return "overlap";
  if (c.upright) {
    const fort = others.find((o) => o.type === "fort");
    if (!fort || !standsBesideFort(r, rectOf(fort))) return "upright_not_beside_fort";
  }
  return null;
}

/** An upright wall must sit flush against the fort's left or right side, touching at least one row of it. */
function standsBesideFort(wall: Rect, fort: Rect): boolean {
  const flushLeft = wall.x + wall.w === fort.x;
  const flushRight = wall.x === fort.x + fort.w;
  const touchesRows = wall.y < fort.y + fort.h && wall.y + wall.h > fort.y;
  return (flushLeft || flushRight) && touchesRows;
}

/**
 * Where a wall dropped at (px, py) lands if it snaps to the fort, or null if it is too far away.
 * Left and right sides take an upright wall; top and bottom take a flat one. Along a side the wall
 * lines up with whichever end is nearer to the drop point.
 */
export function snapWall(fort: Pick<Unit, "x" | "y">, px: number, py: number): Candidate | null {
  const fw = 3;
  const dx = Math.max(fort.x - px, 0, px - (fort.x + fw));
  const dy = Math.max(fort.y - py, 0, py - (fort.y + fw));
  if (Math.hypot(dx, dy) > WALL_SNAP_RANGE) return null;
  const ox = px - (fort.x + fw / 2);
  const oy = py - (fort.y + fw / 2);
  if (Math.abs(ox) >= Math.abs(oy)) {
    return {
      type: "wall",
      upright: true,
      x: ox < 0 ? fort.x - 1 : fort.x + fw,
      y: oy < 0 ? fort.y : fort.y + 1,
    };
  }
  return {
    type: "wall",
    upright: false,
    x: ox < 0 ? fort.x : fort.x + 1,
    y: oy < 0 ? fort.y - 1 : fort.y + fw,
  };
}
