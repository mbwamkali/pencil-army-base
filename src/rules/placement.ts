import { WALL_SNAP_RANGE } from "./constants.ts";
import { FULL_GRID, type Grid } from "./modes.ts";
import { rectOf, rectsOverlap, sizeOf, type Rect, type Unit } from "./units.ts";

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

/**
 * Where a placed wall goes when tapped to give it a quarter turn, or null if it has nowhere to go.
 * It turns about its own centre and snaps to the grid. Near the fort it may instead snap into the
 * nearest free spot along the fort, since an upright wall can only stand beside the fort.
 */
export function turnWall(
  others: readonly Unit[],
  wall: Pick<Unit, "x" | "y" | "upright">,
  grid: Grid = FULL_GRID,
): Candidate | null {
  const upright = !wall.upright;
  const from = rectOf({ type: "wall", ...wall });
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const size = sizeOf("wall", upright);
  const options: Candidate[] = [];
  for (const x of new Set([Math.floor(cx - size.w / 2), Math.ceil(cx - size.w / 2)])) {
    for (const y of new Set([Math.floor(cy - size.h / 2), Math.ceil(cy - size.h / 2)])) {
      options.push({ type: "wall", upright, x, y });
    }
  }
  const fort = others.find((o) => o.type === "fort");
  if (fort) {
    const f = rectOf(fort);
    const gapX = Math.max(f.x - (from.x + from.w), 0, from.x - (f.x + f.w));
    const gapY = Math.max(f.y - (from.y + from.h), 0, from.y - (f.y + f.h));
    if (Math.hypot(gapX, gapY) <= WALL_SNAP_RANGE) {
      if (upright) {
        for (const x of [f.x - 1, f.x + f.w]) {
          for (let y = f.y - 1; y < f.y + f.h; y++) options.push({ type: "wall", upright, x, y });
        }
      } else {
        for (const y of [f.y - 1, f.y + f.h]) {
          for (let x = f.x - 1; x < f.x + f.w; x++) options.push({ type: "wall", upright, x, y });
        }
      }
    }
  }
  // Nearest centre wins; on a tie, the one that keeps its top-left corner nearer, so two taps undo each other.
  let best: Candidate | null = null;
  let bestDist = Infinity;
  for (const c of options) {
    if (placementProblem(others, c, grid) !== null) continue;
    const r = rectOf(c);
    const d = Math.hypot(r.x + r.w / 2 - cx, r.y + r.h / 2 - cy) + Math.hypot(c.x - wall.x, c.y - wall.y) / 1000;
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
