import { type Grid } from "./modes.ts";
import { Rng } from "./rng.ts";
import type { ShotResult } from "./shots.ts";

/** The computer opponent's name. It is not one of the default player names, so the two never clash. */
export const AI_NAME = "Private Pencil";

/** A new shot never lands within this many squares of one the computer already fired. */
export const AI_MIN_GAP = 1;

/**
 * Easy AI: a random spot on the enemy base that it hasn't tried yet.
 * It is given only its own earlier shots (what its Enemy base view shows), never the hidden units.
 * Never throws: on a board that is nearly full it takes the square centre farthest from every earlier shot.
 */
export function chooseEasyShot(shots: readonly Pick<ShotResult, "x" | "y">[], grid: Grid, rng: Rng): { x: number; y: number } {
  const gap = (x: number, y: number) => Math.min(Infinity, ...shots.map((s) => Math.hypot(s.x - x, s.y - y)));
  for (let i = 0; i < 200; i++) {
    // Keep half a square from the edge so the whole shot circle can hit something.
    const x = 0.5 + rng.next() * (grid.w - 1);
    const y = 0.5 + rng.next() * (grid.h - 1);
    if (gap(x, y) >= AI_MIN_GAP) return { x, y };
  }
  let best = { x: 0.5, y: 0.5 };
  let bestGap = -1;
  for (let y = 0.5; y < grid.h; y++) {
    for (let x = 0.5; x < grid.w; x++) {
      const g = gap(x, y);
      if (g > bestGap) {
        bestGap = g;
        best = { x, y };
      }
    }
  }
  return best;
}
