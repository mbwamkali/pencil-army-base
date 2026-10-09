import { ARMY, DEFAULT_NAMES, SHOT_RADIUS } from "./constants.ts";
import { placementProblem, type PlacementProblem } from "./placement.ts";
import { Rng } from "./rng.ts";
import { resolveShot, type ShotResult } from "./shots.ts";
import { ARMY_SLOTS, isFighting, typeOfId, unitState, type Unit } from "./units.ts";

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
  winner: PlayerIndex | null;
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

export function createGame(opts: { seed: number; names?: [string?, string?] }): Game {
  const rng = new Rng(opts.seed);
  const [a, b] = rng.shuffle(DEFAULT_NAMES);
  const firstShooter: PlayerIndex = rng.next() < 0.5 ? 0 : 1;
  const custom = (n?: string) => (n && n.trim() ? n.trim() : undefined);
  return {
    version: 1,
    seed: opts.seed,
    rngState: rng.state,
    phase: "build",
    players: [
      { name: custom(opts.names?.[0]) ?? (a as string), units: [], shots: [] },
      { name: custom(opts.names?.[1]) ?? (b as string), units: [], shots: [] },
    ],
    building: 0,
    current: firstShooter,
    firstShooter,
    turn: 1,
    shotFired: false,
    handoff: null,
    winner: null,
  };
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
  if (!type) return fail("unknown_unit");
  const others = game.players[player].units.filter((u) => u.id !== id);
  const problem = placementProblem(others, { type, x, y, upright });
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

export function isArmyComplete(units: readonly Unit[]): boolean {
  return ARMY_SLOTS.every((s) => units.some((u) => u.id === s.id));
}

/** The player taps Done. Only works once every unit is placed. */
export function finishBuild(game: Game, player: PlayerIndex): Outcome {
  if (game.phase !== "build" || game.building !== player) return fail("wrong_phase");
  if (!isArmyComplete(game.players[player].units)) return fail("army_incomplete");
  const g = clone(game);
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
  const { units, result } = resolveShot(defender.units, x, y, g.turn);
  defender.units = units;
  shooter.shots.push(result);
  g.shotFired = true;
  if (unitsLeft(defender.units).total === 0) {
    g.phase = "over";
    g.winner = g.current;
  }
  return { ok: true, game: g, result };
}

/** After the shot, the player taps End turn and the phone goes to the black handoff screen. */
export function endTurn(game: Game): Outcome {
  if (game.phase !== "turn") return fail("wrong_phase");
  if (!game.shotFired) return fail("shot_not_fired");
  const g = clone(game);
  g.turn += 1;
  g.phase = "handoff";
  g.handoff = { to: other(g.current), then: "turn" };
  return { ok: true, game: g };
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

export const FIGHTING_UNITS = ARMY.fort + ARMY.tank + ARMY.artillery + ARMY.infantry;

/** End-screen stats: a shot is a hit when it destroyed at least one unit. */
export function shotStats(player: PlayerState): { shots: number; hits: number } {
  return { shots: player.shots.length, hits: player.shots.filter((s) => s.destroyed.length > 0).length };
}
