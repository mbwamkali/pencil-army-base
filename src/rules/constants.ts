export const GRID_W = 20;
export const GRID_H = 10;

/** The shot is a circle about 1.75 squares across, centred exactly where the player aimed. */
export const SHOT_DIAMETER = 1.75;
export const SHOT_RADIUS = SHOT_DIAMETER / 2;

/**
 * Width in squares of the box the shot smudge art is drawn in. The smudge reaches 0.476 of the box
 * from its centre, so at 1.8 squares it stays inside the hit circle: wherever the smudge touches a
 * unit's drawing, the shot hit it.
 */
export const SHOT_ART_SIZE = 1.8;

/** A dropped wall snaps to the fort when its drop point is within this many squares of the fort. */
export const WALL_SNAP_RANGE = 2;

export const UNIT_TYPES = ["fort", "tank", "artillery", "infantry", "wall"] as const;
export type UnitType = (typeof UNIT_TYPES)[number];

/** Units each player gets. 17 in total, 13 of them fighting units (everything but walls). */
export const ARMY: Record<UnitType, number> = {
  fort: 1,
  tank: 3,
  artillery: 3,
  infantry: 6,
  wall: 4,
};

/** Footprint in grid squares when laid in the default direction. Walls can also stand upright (1 x 2). */
export const FOOTPRINT: Record<UnitType, { w: number; h: number }> = {
  fort: { w: 3, h: 3 },
  tank: { w: 2, h: 2 },
  artillery: { w: 2, h: 2 },
  infantry: { w: 1, h: 1 },
  wall: { w: 2, h: 1 },
};

/**
 * How far in from each edge of a unit's footprint its drawing starts, in squares (default direction).
 * Shots hit the drawing, not the empty paper around it. Left and right are the same so player 2's
 * mirrored army is hit exactly like player 1's. Walls keep their whole footprint.
 */
export const HIT_INSET: Record<UnitType, { side: number; top: number; bottom: number }> = {
  fort: { side: 0.2, top: 0.1, bottom: 0.25 },
  tank: { side: 0.05, top: 0.7, bottom: 0.3 },
  artillery: { side: 0.1, top: 0.35, bottom: 0.25 },
  infantry: { side: 0.15, top: 0.1, bottom: 0.05 },
  wall: { side: 0, top: 0, bottom: 0 },
};

/** Hits needed to destroy a unit. */
export const HITS_TO_DESTROY: Record<UnitType, number> = {
  fort: 2,
  tank: 1,
  artillery: 1,
  infantry: 1,
  wall: 1,
};

/** Made-up pencil-themed officers used as default player names. */
export const DEFAULT_NAMES = [
  "General Graphite",
  "Colonel Eraser",
  "Major Smudge",
  "Captain Sharpener",
  "Sergeant Scribble",
  "Commander Crosshatch",
  "Lieutenant Doodle",
  "Marshal Margin",
  "Brigadier Ruler",
  "Corporal Shavings",
] as const;
