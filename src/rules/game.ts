import { AI_NAME, chooseEasyShot } from "./ai.ts";
import { computerBase } from "./maps.ts";
import { ARMY, DEFAULT_NAMES, SHOT_RADIUS, UNIT_TYPES, type UnitType } from "./constants.ts";
import { POINTS, modeOf, type Mode, type ModeId } from "./modes.ts";
import { placementProblem, type PlacementProblem } from "./placement.ts";
import { Rng } from "./rng.ts";
import { resolveShot, type ShotResult } from "./shots.ts";
import { ARMY_SLOTS, armySlots, isFighting, typeOfId, unitState, type Unit } from "./units.ts";

export type PlayerIndex = 0 | 1;
export type Phase = "build" | "handoff" | "turn" | "over";

export interface PlayerState {
  name: string;
  /** Units placed on this player's own base. */
  units: Unit[];
  /** Shots this player has fired at the enemy base, in order. */
  shots: ShotResult[];
}

/** The whole game as plain data, so it saves to the browser and replays exactly. */
export interface Game {
  version: 1;
  /** Which game mode this is (army, board size and how it ends). Saves from before modes were all Battle. */
  mode: ModeId;
  seed: number;
  rngState: number;
  phase: Phase;
  players: [PlayerState, PlayerState];
  /** Who is building (phase "build"). */
  building: PlayerIndex;
  /** Who shoots (phases "turn" and "over"). */
  current: PlayerIndex;
  firstShooter: PlayerIndex;
  /** Number of the current turn, starting at 1. */
  turn: number;
  shotFired: boolean;
  /** Set during the black handoff screen: who to pass to and what starts when they tap Start. */
  handoff: { to: PlayerIndex; then: "build" | "turn" } | null;
  /** Set when the game is over; null in a finished Score attack means a tie. */
  winner: PlayerIndex | null;
  /** The player the computer plays in a single player game (always player 2), or absent for two players. */
  ai?: PlayerIndex;
}

export type Failure =
  | PlacementProblem
  | "wrong_phase"
  | "unknown_unit"
  | "army_incomplete"
  | "shot_already_fired"
  | "shot_not_fired";

export type Outcome<T = object> = ({ ok: true; game: Game } & T) | { ok: false; reason: Failure };

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

function fail<T>(reason: Failure): Outcome<T> {
  return { ok: false, reason };
}

function clone(game: Game): Game {
  return structuredClone(game);
}

export function createGame(opts: { seed: number; names?: [string?, string?]; mode?: ModeId; vsComputer?: boolean }): Game {
  const rng = new Rng(opts.seed);
  const [a, b] = rng.shuffle(DEFAULT_NAMES);
  const ai = opts.vsComputer ? { ai: 1 as PlayerIndex } : {};
  const firstShooter: PlayerIndex = rng.next() < 0.5 ? 0 : 1;
  const custom = (n?: string) => (n && n.trim() ? n.trim() : undefined);
  return {
    version: 1,
    mode: opts.mode ?? "battle",
    seed: opts.seed,
    rngState: rng.state,
    phase: "build",
    players: [
      { name: custom(opts.names?.[0]) ?? (a as string), units: [], shots: [] },
      { name: opts.vsComputer ? AI_NAME : (custom(opts.names?.[1]) ?? (b as string)), units: [], shots: [] },
    ],
    building: 0,
    current: firstShooter,
    firstShooter,
    turn: 1,
    shotFired: false,
    handoff: null,
    winner: null,
    ...ai,
  };
}

/** Two different pencil names to start the setup screen with. `random` returns a number from 0 up to (not including) 1. */
export function randomDefaultNames(random: () => number): [string, string] {
  const first = DEFAULT_NAMES[Math.floor(random() * DEFAULT_NAMES.length)] as string;
  return [first, nextDefaultName(first, first, random)];
}

/** Another pencil name that is neither the current one nor the other player's. */
export function nextDefaultName(current: string, other: string, random: () => number): string {
  const choices = DEFAULT_NAMES.filter((n) => n !== current && n !== other);
  return choices[Math.floor(random() * choices.length)] as string;
}

export function setName(game: Game, player: PlayerIndex, name: string): Game {
  const g = clone(game);
  const fallback = DEFAULT_NAMES.find((n) => !g.players.some((p, i) => i !== player && p.name === n));
  g.players[player].name = name.trim() || (fallback as string);
  return g;
}

/** Place a unit from the tray, or move one that is already placed. */
export function placeUnit(
  game: Game,
  player: PlayerIndex,
  id: string,
  x: number,
  y: number,
  upright = false,
): Outcome {
  if (game.phase !== "build" || game.building !== player) return fail("wrong_phase");
  const type = typeOfId(id);
  const mode = modeOf(game.mode);
  if (!type || !armySlots(mode.army).some((s) => s.id === id)) return fail("unknown_unit");
  const others = game.players[player].units.filter((u) => u.id !== id);
  const problem = placementProblem(others, { type, x, y, upright }, mode.grid);
  if (problem) return fail(problem);
  const g = clone(game);
  g.players[player].units = [...others, { id, type, x, y, upright, hits: 0 }];
  return { ok: true, game: g };
}

export function removeUnit(game: Game, player: PlayerIndex, id: string): Outcome {
  if (game.phase !== "build" || game.building !== player) return fail("wrong_phase");
  const g = clone(game);
  g.players[player].units = g.players[player].units.filter((u) => u.id !== id);
  return { ok: true, game: g };
}

/** Clear all: takes every placed unit off the player's base so they can start over. */
export function clearUnits(game: Game, player: PlayerIndex): Outcome {
  if (game.phase !== "build" || game.building !== player) return fail("wrong_phase");
  const g = clone(game);
  g.players[player].units = [];
  return { ok: true, game: g };
}

export function isArmyComplete(units: readonly Unit[], mode: Mode = modeOf("battle")): boolean {
  return armySlots(mode.army).every((s) => units.some((u) => u.id === s.id));
}

/** The player taps Done. Only works once every unit is placed. */
export function finishBuild(game: Game, player: PlayerIndex): Outcome {
  if (game.phase !== "build" || game.building !== player) return fail("wrong_phase");
  if (!isArmyComplete(game.players[player].units, modeOf(game.mode))) return fail("army_incomplete");
  const g = clone(game);
  if (g.ai !== undefined) {
    // Single player: the computer builds its base at once and play starts with no handoff screen.
    const rng = new Rng(g.rngState);
    g.players[g.ai].units = computerBase(rng, modeOf(g.mode));
    g.rngState = rng.state;
    g.phase = "turn";
    g.current = g.firstShooter;
    g.shotFired = false;
    return { ok: true, game: g };
  }
  g.phase = "handoff";
  g.handoff = player === 0 ? { to: 1, then: "build" } : { to: g.firstShooter, then: "turn" };
  return { ok: true, game: g };
}

/** The player the black screen is waiting for taps Start. */
export function confirmHandoff(game: Game): Outcome {
  if (game.phase !== "handoff" || !game.handoff) return fail("wrong_phase");
  const g = clone(game);
  const { to, then } = game.handoff;
  g.handoff = null;
  g.phase = then;
  if (then === "build") g.building = to;
  else {
    g.current = to;
    g.shotFired = false;
  }
  return { ok: true, game: g };
}

/** Fire the turn's single shot at the enemy base, exactly where aimed (grid squares). */
export function fire(game: Game, x: number, y: number): Outcome<{ result: ShotResult }> {
  if (game.phase !== "turn") return fail("wrong_phase");
  if (game.shotFired) return fail("shot_already_fired");
  const g = clone(game);
  const shooter = g.players[g.current];
  const defender = g.players[other(g.current)];
  const mode = modeOf(g.mode);
  const { units, result } = resolveShot(defender.units, x, y, g.turn, mode.grid);
  defender.units = units;
  shooter.shots.push(result);
  g.shotFired = true;
  if (mode.win === "all" && unitsLeft(defender.units).total === 0) {
    g.phase = "over";
    g.winner = g.current;
  } else if (mode.win === "core" && coreDestroyed(defender.units)) {
    g.phase = "over";
    g.winner = g.current;
  } else if (mode.win === "score") {
    // Both players fire the same number of shots, so the game can only end once the round is complete.
    const roundDone = g.players[0].shots.length === g.players[1].shots.length;
    const limitReached = g.players[0].shots.length >= (mode.shotsEach ?? Infinity);
    const armyGone = unitsLeft(g.players[0].units).total === 0 || unitsLeft(g.players[1].units).total === 0;
    if (roundDone && (limitReached || armyGone)) {
      const a = scoreOf(g.players[0]);
      const b = scoreOf(g.players[1]);
      g.phase = "over";
      g.winner = a === b ? null : a > b ? 0 : 1;
    }
  }
  return { ok: true, game: g, result };
}

/** After the shot, the player taps End turn and the phone goes to the black handoff screen. */
export function endTurn(game: Game): Outcome {
  if (game.phase !== "turn") return fail("wrong_phase");
  if (!game.shotFired) return fail("shot_not_fired");
  const g = clone(game);
  g.turn += 1;
  if (g.ai !== undefined) {
    // Single player: nobody needs to look away, so the next turn starts straight away.
    g.current = other(g.current);
    g.shotFired = false;
    return { ok: true, game: g };
  }
  g.phase = "handoff";
  g.handoff = { to: other(g.current), then: "turn" };
  return { ok: true, game: g };
}

/**
 * The computer's whole turn: one shot, then the turn passes back (unless the shot ended the game).
 * It aims using only its own earlier shots, which is what its Enemy base view shows.
 */
export function playComputerTurn(game: Game): Outcome<{ result: ShotResult }> {
  if (game.phase !== "turn" || game.ai === undefined || game.current !== game.ai) return fail("wrong_phase");
  if (game.shotFired) return fail("shot_already_fired");
  const rng = new Rng(game.rngState);
  const aim = chooseEasyShot(game.players[game.ai].shots, modeOf(game.mode).grid, rng);
  const fired = fire({ ...game, rngState: rng.state }, aim.x, aim.y);
  if (!fired.ok) return fired;
  if (fired.game.phase === "over") return fired;
  const ended = endTurn(fired.game);
  return ended.ok ? { ok: true, game: ended.game, result: fired.result } : ended;
}

/** A repeat spot is a new shot centre inside the circle of an earlier miss (the game shows a gentle warning). */
export function isRepeatOfMiss(game: Game, player: PlayerIndex, x: number, y: number): boolean {
  return game.players[player].shots.some(
    (s) => s.outcome === "miss" && Math.hypot(s.x - x, s.y - y) < SHOT_RADIUS,
  );
}

export interface UnitsLeft {
  /** Fighting units left (everything but walls). Starts at 13. */
  total: number;
  /** Per type: how many are left, and for the fort whether it is damaged. */
  byType: Record<"fort" | "tank" | "artillery" | "infantry", number>;
  fortDamaged: boolean;
  wallsLeft: number;
}

export function unitsLeft(units: readonly Unit[]): UnitsLeft {
  const alive = units.filter((u) => unitState(u) !== "destroyed");
  const count = (t: string) => alive.filter((u) => u.type === t).length;
  const fort = alive.find((u) => u.type === "fort");
  return {
    total: alive.filter(isFighting).length,
    byType: { fort: count("fort"), tank: count("tank"), artillery: count("artillery"), infantry: count("infantry") },
    fortDamaged: !!fort && unitState(fort) === "damaged",
    wallsLeft: count("wall"),
  };
}

/** Fort, tanks and artillery still standing: what is left to destroy to win a Skirmish or Battle. */
export function coreLeft(units: readonly Unit[]): number {
  const left = unitsLeft(units).byType;
  return left.fort + left.tank + left.artillery;
}

/** True when the fort and every tank and artillery are destroyed (the win rule for Skirmish and Battle). */
export function coreDestroyed(units: readonly Unit[]): boolean {
  return units.every((u) => !["fort", "tank", "artillery"].includes(u.type) || unitState(u) === "destroyed");
}

/** A player's points: every hit they landed, by unit type. Walls score nothing. */
export function scoreOf(player: PlayerState): number {
  return player.shots.reduce((sum, s) => sum + s.hits.reduce((n, h) => n + POINTS[h.type], 0), 0);
}

/** Hits landed and points earned, by the type of unit hit. A fort scores on both of its hits. */
export function pointsByType(player: PlayerState): Record<UnitType, { hits: number; points: number }> {
  const out = Object.fromEntries(UNIT_TYPES.map((t) => [t, { hits: 0, points: 0 }])) as Record<UnitType, { hits: number; points: number }>;
  for (const s of player.shots) {
    for (const h of s.hits) {
      out[h.type].hits += 1;
      out[h.type].points += POINTS[h.type];
    }
  }
  return out;
}

export const FIGHTING_UNITS = ARMY.fort + ARMY.tank + ARMY.artillery + ARMY.infantry;

/** End-screen stats: a shot is a hit when it destroyed at least one unit. */
export function shotStats(player: PlayerState): { shots: number; hits: number } {
  return { shots: player.shots.length, hits: player.shots.filter((s) => s.destroyed.length > 0).length };
}
