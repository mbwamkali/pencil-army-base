import { ARMY, GRID_H, GRID_W, type UnitType } from "./constants.ts";

export const MODE_IDS = ["skirmish", "battle", "siege", "score"] as const;
export type ModeId = (typeof MODE_IDS)[number];

/**
 * How a game ends.
 * - all: destroy every fighting unit (everything but walls).
 * - core: destroy the fort and every tank and artillery; infantry are optional.
 * - score: each player fires a fixed number of shots and the higher score wins.
 */
export type WinRule = "all" | "core" | "score";

export interface Grid {
  w: number;
  h: number;
}

export interface Mode {
  id: ModeId;
  name: string;
  blurb: string;
  army: Record<UnitType, number>;
  grid: Grid;
  win: WinRule;
  /** Score attack only: shots each player fires. */
  shotsEach?: number;
}

export const FULL_GRID: Grid = { w: GRID_W, h: GRID_H };

/** The default mode when a player does not pick one. */
export const DEFAULT_MODE: ModeId = "skirmish";

export const MODES: Record<ModeId, Mode> = {
  skirmish: {
    id: "skirmish",
    name: "Skirmish",
    blurb: "Small army on a small board. Destroy the fort, tank and artillery.",
    army: { fort: 1, tank: 1, artillery: 1, infantry: 2, wall: 2 },
    grid: { w: 12, h: 6 },
    win: "core",
  },
  battle: {
    id: "battle",
    name: "Battle",
    blurb: "Full army. Destroy the fort, every tank and every artillery. Infantry are optional.",
    army: ARMY,
    grid: FULL_GRID,
    win: "core",
  },
  siege: {
    id: "siege",
    name: "Siege",
    blurb: "Full army. Destroy the fort, tanks and artillery. Infantry only score points.",
    army: ARMY,
    grid: FULL_GRID,
    win: "core",
  },
  score: {
    id: "score",
    name: "Score attack",
    blurb: "Full army. 20 shots each. The most points wins.",
    army: ARMY,
    grid: FULL_GRID,
    win: "score",
    shotsEach: 20,
  },
};

/** Points for each hit on a unit. Walls score nothing; a fort scores on both of its hits. */
export const POINTS: Record<UnitType, number> = { infantry: 1, tank: 3, artillery: 3, fort: 5, wall: 0 };

/** Games saved before modes existed were all Battle. */
export function modeOf(id: ModeId | undefined): Mode {
  return MODES[id ?? "battle"] ?? MODES.battle;
}

/** Fighting units in an army: everything except walls. */
export function fightingCount(mode: Mode): number {
  return mode.army.fort + mode.army.tank + mode.army.artillery + mode.army.infantry;
}
