import { SHOT_RADIUS } from "../../rules/constants.ts";
import type { Failure, Game, Outcome, PlayerIndex } from "../../rules/game.ts";
import { isStrategic, modeOf } from "../../rules/modes.ts";
import { Rng } from "../../rules/rng.ts";
import { circleHitsRect } from "../../rules/shots.ts";
import { hitRectOf, rectOf, type Unit } from "../../rules/units.ts";
import { centreOf, footprintAt, isFree, key, reachable, ringAround, squareDistance } from "./board.ts";
import {
  ACTIVE_TYPES,
  ARTILLERY_MIN_RANGE,
  BASE_GRID,
  DAMAGE,
  MOVE,
  TANK_RANGE,
  TRUCK_CAPACITY,
  isAlive,
  shakeRadius,
} from "./constants.ts";
import { applyDamage } from "./damage.ts";
import { distanceToRect, lookAround, unitSeen, visibleSquares } from "./fog.ts";
import { mapOf, squareIndex } from "./maps.ts";
import type { MapShot, OrderState, Point, RiderMove, ShotHitRecord, StrategicMap, StrategicState } from "./types.ts";

/**
 * Orders: what the current player tells their tanks, artillery and truck to do. Each unit may use
 * its move and its shot once per turn and acts the moment it is ordered, so every function here
 * takes a game and returns a new one (or a failure reason the screen can explain).
 */

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

const fail = <T>(reason: Failure): Outcome<T> => ({ ok: false, reason });

/** Both players' units together: anything standing on the map blocks movement, whoever owns it. */
const allUnits = (game: Game): Unit[] => [...game.players[0].units, ...game.players[1].units];

/** The Strategic state while a turn is being played, the only time an order may be given. */
function stateInTurn(game: Game): StrategicState | undefined {
  return game.phase === "turn" && isStrategic(modeOf(game.mode)) ? game.strategic : undefined;
}

/** One of the current player's living units, by id. */
function ownUnit(game: Game, unitId: string): Unit | undefined {
  const u = game.players[game.current].units.find((v) => v.id === unitId);
  return u && isAlive(u) ? u : undefined;
}

const orderOf = (s: StrategicState, unitId: string): OrderState => s.orders[unitId] ?? { moved: false, fired: false };

/** The middle of a player's base. Riders and new infantry head for the enemy's; the player never sees it. */
function baseCentre(s: StrategicState, p: PlayerIndex): Point {
  return { x: s.bases[p].x + BASE_GRID.w / 2, y: s.bases[p].y + BASE_GRID.h / 2 };
}

/** The square a point on the map falls in (a point on the far edge counts as the last square). */
export function landingSquare(p: Point, map: Pick<StrategicMap, "w" | "h">): number {
  const x = Math.max(0, Math.min(map.w - 1, Math.floor(p.x)));
  const y = Math.max(0, Math.min(map.h - 1, Math.floor(p.y)));
  return squareIndex(map, x, y);
}

/** Takes the next shot number and notes the shot in the event log, so events read "shot, then fort destroyed". */
function takeShotId(g: Game, by: PlayerIndex): number {
  const s = g.strategic as StrategicState;
  const id = s.nextShot;
  s.nextShot += 1;
  s.events.push({ kind: "shot", turn: g.turn, player: by, shotId: id });
  return id;
}

/** Every top-left square one of the current player's units could move to right now (geometry only, orders aside). */
export function reachableFor(game: Game, unitId: string): Point[] {
  const s = game.strategic;
  const unit = s && ownUnit(game, unitId);
  if (!s || !unit) return [];
  return [...reachable(mapOf(s.map), allUnits(game), unit).values()].map((path) => path.at(-1) as Point);
}

/**
 * The current player's infantry that would climb aboard if this truck moved now: living infantry
 * touching the truck, in unit order, up to its capacity.
 */
export function ridersFor(game: Game, truckId: string): string[] {
  const truck = ownUnit(game, truckId);
  if (!truck || truck.type !== "truck") return [];
  const rect = rectOf(truck);
  return game.players[game.current].units
    .filter((u) => u.type === "infantry" && isAlive(u) && squareDistance(rectOf(u), rect) === 1)
    .slice(0, TRUCK_CAPACITY)
    .map((u) => u.id);
}

/**
 * Riders climb off around the truck's new footprint, nearest the enemy base first, each onto the
 * first square still free. Only a rider's own square counts as free for it: handing out a square
 * another rider is still standing on could leave that rider, should it then find no room, sharing
 * its square with the first. A rider whose best square is the one it stands on, or that finds no
 * free square, stays where it was and is not a rider. Changes the game in place; returns who rode
 * and where each one went, so a replay can move them too.
 */
function setDownRiders(g: Game, p: PlayerIndex, truck: Unit, riders: readonly string[]): RiderMove[] {
  const s = g.strategic as StrategicState;
  const map = mapOf(s.map);
  const goal = baseCentre(s, other(p));
  const spots = ringAround(rectOf(truck))
    .map((sq, i) => ({ sq, i, d: Math.hypot(sq.x + 0.5 - goal.x, sq.y + 0.5 - goal.y) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map((c) => c.sq);
  const rode: RiderMove[] = [];
  for (const id of riders) {
    const rider = g.players[p].units.find((u) => u.id === id) as Unit;
    const spot = spots.find((sq) => isFree(map, allUnits(g), footprintAt(rider, sq.x, sq.y), new Set([rider])));
    if (!spot || (spot.x === rider.x && spot.y === rider.y)) continue;
    rode.push({ unitId: id, from: { x: rider.x, y: rider.y }, to: { x: spot.x, y: spot.y } });
    rider.x = spot.x;
    rider.y = spot.y;
  }
  return rode;
}

/**
 * Move a tank or truck to a top-left square it can reach this turn. A truck takes the infantry
 * beside it along. The unit then looks around so new ground appears at once. A unit that has fired
 * stays put for the rest of the turn.
 */
export function moveUnit(game: Game, unitId: string, to: Point): Outcome {
  const s = stateInTurn(game);
  if (!s) return fail("wrong_phase");
  const unit = ownUnit(game, unitId);
  if (!unit || !ACTIVE_TYPES.includes(unit.type) || MOVE[unit.type] <= 0) return fail("unknown_unit");
  const order = orderOf(s, unitId);
  if (order.fired) return fail("already_fired");
  if (order.moved) return fail("already_moved");
  if (!reachable(mapOf(s.map), allUnits(game), unit).has(key(to))) return fail("blocked");
  const riders = unit.type === "truck" ? ridersFor(game, unitId) : [];
  const p = game.current;
  let g = structuredClone(game);
  const mover = g.players[p].units.find((u) => u.id === unitId) as Unit;
  const from = { x: unit.x, y: unit.y };
  mover.x = to.x;
  mover.y = to.y;
  const rode = setDownRiders(g, p, mover, riders);
  g = lookAround(g, p);
  const after = g.strategic as StrategicState;
  after.events.push({
    kind: "move",
    turn: g.turn,
    player: p,
    unitId,
    type: unit.type,
    from,
    to: { x: to.x, y: to.y },
    riders: rode.map((r) => r.unitId),
    riderMoves: rode,
  });
  after.orders[unitId] = { ...order, moved: true };
  return { ok: true, game: g };
}

/** Living enemy units (walls included) within a tank's range that the current player can see right now. */
export function tankTargets(game: Game, unitId: string): string[] {
  const s = game.strategic;
  const tank = s && ownUnit(game, unitId);
  if (!s || !tank || tank.type !== "tank") return [];
  const map = mapOf(s.map);
  const p = game.current;
  const visible = visibleSquares(game.players[p].units, map);
  const rect = rectOf(tank);
  return game.players[other(p)].units
    .filter((u) => isAlive(u) && squareDistance(rect, rectOf(u)) <= TANK_RANGE && unitSeen(u, visible, map))
    .map((u) => u.id);
}

/**
 * A tank fires at one target in range. The shot is aimed at a unit in sight, so it lands square on
 * the target and the tank sees the result. Firing ends the tank's movement for the turn (moving
 * first is fine).
 */
export function fireTank(game: Game, unitId: string, targetId: string): Outcome<{ shot: MapShot }> {
  const s = stateInTurn(game);
  if (!s) return fail("wrong_phase");
  const tank = ownUnit(game, unitId);
  if (!tank || tank.type !== "tank") return fail("unknown_unit");
  if (orderOf(s, unitId).fired) return fail("already_fired");
  if (!tankTargets(game, unitId).includes(targetId)) return fail("no_target");
  const p = game.current;
  const enemy = other(p);
  const target = game.players[enemy].units.find((u) => u.id === targetId) as Unit;
  let g = structuredClone(game);
  const id = takeShotId(g, p);
  const hit = applyDamage(g, enemy, targetId, DAMAGE.tank, p);
  g = hit.game;
  const centre = centreOf(rectOf(target));
  const shot: MapShot = {
    id,
    by: p,
    weapon: "tank",
    unitId,
    aim: centre,
    x: centre.x,
    y: centre.y,
    turn: g.turn,
    outcome: target.type === "wall" ? "wall" : "hit",
    hits: [{ unitId: targetId, owner: enemy, type: target.type, damage: hit.before - hit.after, destroyed: hit.destroyed, seen: true }],
    revealed: true,
  };
  const after = g.strategic as StrategicState;
  after.shots.push(shot);
  after.orders[unitId] = { moved: true, fired: true };
  return { ok: true, game: g, shot };
}

/** Why a shell cannot be aimed at a point: off the paper, or too close to the gun for its minimum range. */
export function aimProblem(game: Game, unitId: string, aim: Point): "too_close" | "off_map" | null {
  const map = mapOf(game.strategic?.map);
  if (aim.x < 0 || aim.x > map.w || aim.y < 0 || aim.y > map.h) return "off_map";
  const gun = game.players[game.current].units.find((u) => u.id === unitId);
  if (gun && distanceToRect(aim.x, aim.y, rectOf(gun)) < ARTILLERY_MIN_RANGE) return "too_close";
  return null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * How far a shell from this gun may drift if aimed at `aim`: the shake grows with the distance from
 * the gun's footprint (shakeRadius). The screens draw this circle around the aim. A missing gun
 * gets the minimum shake.
 */
export function shakeFor(game: Game, unitId: string, aim: Point): number {
  const gun = game.players[game.current].units.find((u) => u.id === unitId);
  return shakeRadius(gun ? distanceToRect(aim.x, aim.y, rectOf(gun)) : 0);
}

/**
 * A shell flies to the aim and drifts: the game's Rng draws u then v, and the landing is a point
 * spread evenly over the shake circle (the square root keeps it from bunching at the centre),
 * clamped onto the paper. The circle grows with the range (shakeRadius), so a shot at something a
 * tank can see lands close and a blind shot across the map is a gamble. It blows up whatever is under it on either side, with the Quick action
 * rule that a standing wall takes the whole blow. Nothing is revealed: the shot joins the record
 * but the shooter's fog stays as it was. Each hit notes whether the shooter could see the unit as
 * the shell fell (the smudge reaches into squares beside the landing one, so a watched landing can
 * still clip a unit in the fog, and a blind landing a unit in sight); the shooter's view keeps only
 * those hits.
 */
export function landShell(game: Game, by: PlayerIndex, unitId: string, aim: Point): { game: Game; shot: MapShot } {
  let g = structuredClone(game);
  const s = g.strategic as StrategicState;
  const map = mapOf(s.map);
  const rng = new Rng(g.rngState);
  const u = rng.next();
  const v = rng.next();
  g.rngState = rng.state;
  const gun = g.players[by].units.find((unit) => unit.id === unitId);
  const shake = shakeRadius(gun ? distanceToRect(aim.x, aim.y, rectOf(gun)) : 0);
  const r = shake * Math.sqrt(u);
  const angle = 2 * Math.PI * v;
  const x = clamp(aim.x + r * Math.cos(angle), 0, map.w);
  const y = clamp(aim.y + r * Math.sin(angle), 0, map.h);
  // What the shooter's units can see as the shell falls, before it changes anything.
  const visible = visibleSquares(g.players[by].units, map);
  const revealed = visible.has(landingSquare({ x, y }, map));
  const touched = ([0, 1] as PlayerIndex[]).flatMap((owner) =>
    g.players[owner].units
      .filter((unit) => isAlive(unit) && circleHitsRect(x, y, SHOT_RADIUS, hitRectOf(unit)))
      .map((unit) => ({ owner, unit, seen: owner === by || unitSeen(unit, visible, map) })),
  );
  const walls = touched.filter((t) => t.unit.type === "wall");
  const struck = walls.length > 0 ? walls : touched;
  const id = takeShotId(g, by);
  const hits: ShotHitRecord[] = [];
  // One unit at a time: a fort may fall part way through, and the rest are still hurt.
  for (const { owner, unit, seen } of struck) {
    const d = applyDamage(g, owner, unit.id, DAMAGE.shell, by);
    g = d.game;
    hits.push({ unitId: unit.id, owner, type: unit.type, damage: d.before - d.after, destroyed: d.destroyed, seen });
  }
  const shot: MapShot = {
    id,
    by,
    weapon: "shell",
    unitId,
    aim: { x: aim.x, y: aim.y },
    x,
    y,
    turn: g.turn,
    outcome: hits.length === 0 ? "miss" : walls.length > 0 ? "wall" : "hit",
    hits,
    revealed,
  };
  (g.strategic as StrategicState).shots.push(shot);
  return { game: g, shot };
}

/** The artillery fires one shell a turn at any point far enough away; it may be aimed into the fog. */
export function fireArtillery(game: Game, unitId: string, aim: Point): Outcome<{ shot: MapShot }> {
  const s = stateInTurn(game);
  if (!s) return fail("wrong_phase");
  const gun = ownUnit(game, unitId);
  if (!gun || gun.type !== "artillery") return fail("unknown_unit");
  const order = orderOf(s, unitId);
  if (order.fired) return fail("already_fired");
  const problem = aimProblem(game, unitId, aim);
  if (problem === "too_close") return fail("too_close");
  if (problem === "off_map") return fail("blocked");
  const { game: g, shot } = landShell(game, game.current, unitId, aim);
  (g.strategic as StrategicState).orders[unitId] = { ...order, fired: true };
  return { ok: true, game: g, shot };
}
