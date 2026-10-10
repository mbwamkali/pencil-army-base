import { decodeLayout } from "./code.ts";
import { randomUnits } from "./layout.ts";
import { MODES, type Grid, type Mode } from "./modes.ts";
import { placementProblem } from "./placement.ts";
import type { Rng } from "./rng.ts";
import { rectOf, type Unit } from "./units.ts";

/**
 * Bases the computer can use, as layout codes made with Copy layout.
 * To add one: build a base, copy its code from the Menu and add it here. Any mode works;
 * a Battle code also serves Score attack because both use the same army and board.
 */
export const SAVED_MAPS: readonly string[] = [
  // Skirmish, from Jared (2026-10-10).
  "PAB1-WvVn4q1quIhwLs4",
  "PAB1-WuhrzIxeop1zZ0o",
  // Battle (also used in Score attack), from Jared (2026-10-10).
  "PAB1-W8XSdSYY5APNpKGjIdJogGqMh56e",
  "PAB1-W8nSwt8rzwPzpKGjIdJ82kjwgecd",
];

/** The four ways a base can face: as saved, mirrored left to right, upside down, or both. */
export const FLIPS = [
  { x: false, y: false },
  { x: true, y: false },
  { x: false, y: true },
  { x: true, y: true },
] as const;

export type Flip = (typeof FLIPS)[number];

/** Mirrors a base across the board. Walls stay against the fort, so the result is always legal. */
export function flipUnits(units: readonly Unit[], grid: Grid, flip: Flip): Unit[] {
  return units.map((u) => {
    const r = rectOf(u);
    return { ...u, x: flip.x ? grid.w - r.x - r.w : u.x, y: flip.y ? grid.h - r.y - r.h : u.y };
  });
}

const sameShape = (a: Mode, b: Mode) =>
  a.grid.w === b.grid.w && a.grid.h === b.grid.h && (Object.keys(a.army) as (keyof Mode["army"])[]).every((t) => a.army[t] === b.army[t]);

/** Every saved base that fits this mode. Codes that don't decode are skipped, never fatal. */
export function mapsFor(mode: Mode, codes: readonly string[] = SAVED_MAPS): Unit[][] {
  return codes.flatMap((code) => {
    const d = decodeLayout(code);
    return d.ok && sameShape(MODES[d.mode], mode) ? [d.units] : [];
  });
}

/**
 * The computer's base: a saved map that fits the mode, turned one of four ways at random.
 * With no saved map for the mode it quietly builds a random base instead.
 */
export function computerBase(rng: Rng, mode: Mode, codes: readonly string[] = SAVED_MAPS): Unit[] {
  const maps = mapsFor(mode, codes);
  if (maps.length === 0) return randomUnits(rng, mode);
  const units = flipUnits(rng.pick(maps), mode.grid, rng.pick(FLIPS));
  const legal = units.every((u, i) => !placementProblem(units.slice(0, i), u, mode.grid));
  return legal ? units : randomUnits(rng, mode);
}
