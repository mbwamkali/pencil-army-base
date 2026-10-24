import type { Game, PlayerIndex } from "../../rules/game.ts";
import { rectOf, type Rect, type Unit } from "../../rules/units.ts";
import { DIRECTIONS, centreOf, footprintAt, insideMap, isFree, key, reachable, ringAround, squareDistance } from "./board.ts";
import { BASE_GRID, DAMAGE, SPAWN_FROM_TURN, SPAWN_PER_TURN, hpLeft, isAlive } from "./constants.ts";
import { damageInPlace } from "./damage.ts";
import { decodeExplored, knownUnits, noteWhatIsSeen, squaresOfRect, unitSeen, visibleSquares } from "./fog.ts";
import { isBlocked, mapOf, squareIndex } from "./maps.ts";
import type { Point, StrategicMap, StrategicState } from "./types.ts";
import { turnNumber } from "./view.ts";

/**
 * What happens on its own at the start of a Strategic turn: the player's infantry fight and walk
 * without orders, and the fort sends out fresh infantry. Everything here is deterministic (ties go
 * to the first unit, square or direction in order), so a saved game replays exactly.
 */

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

/** How far ahead an infantry plans its walk, in squares. Past that it just heads the right way. */
const PATH_STEPS = 30;

/** Both players' units together, which is how the board helpers want them. */
const allUnits = (game: Game): Unit[] => [...game.players[0].units, ...game.players[1].units];

const square = (p: Point): Rect => ({ x: p.x, y: p.y, w: 1, h: 1 });

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * True when the owner's base sits in the left half of the map, so the enemy half is the right one.
 * Read from the owner's own base, which they know: no rule here may steer by the enemy base, whose
 * spot is random and hidden until its fort is found, or a player could read it off their own units.
 */
function ownSideIsLeft(s: StrategicState, owner: PlayerIndex, map: StrategicMap): boolean {
  return s.bases[owner].x + BASE_GRID.w / 2 < map.w / 2;
}

/**
 * The middle of the enemy's half of the map, as a 2 x 2 block centred on it (the half's middle
 * falls between squares, and a block keeps it the same for both sides): where an infantry heads
 * once the whole enemy half is explored and the enemy fort still has not been seen.
 */
function enemyHalfCentre(s: StrategicState, owner: PlayerIndex, map: StrategicMap): Rect {
  const cx = Math.floor(ownSideIsLeft(s, owner, map) ? (3 * map.w) / 4 : map.w / 4);
  const cy = Math.floor(map.h / 2);
  return { x: cx - 1, y: cy - 1, w: 2, h: 2 };
}

/**
 * Which enemy an infantry hits when several are in reach: a fighting unit before a wall, then the
 * one with the fewest hit points left, then the first in unit order (candidates keep their order).
 */
export function chooseMeleeTarget(candidates: readonly Unit[]): Unit | undefined {
  // Lower ranks first; a wall ranks behind every fighting unit (nothing has 100 hit points).
  const rank = (u: Unit): number => (u.type === "wall" ? 100 : 0) + hpLeft(u);
  let best: Unit | undefined;
  for (const u of candidates) if (!best || rank(u) < rank(best)) best = u;
  return best;
}

/**
 * The squares the living units stand on (all but `walker`), marked by square index. A walk plan
 * looks up a square here instead of checking every unit on the map for every square it tries, which
 * on a large map late in a game made tapping Start freeze for seconds.
 */
function occupancy(map: StrategicMap, units: readonly Unit[], walker: Unit): Uint8Array {
  const taken = new Uint8Array(map.w * map.h);
  for (const u of units) if (u !== walker && isAlive(u)) for (const i of squaresOfRect(rectOf(u), map)) taken[i] = 1;
  return taken;
}

/**
 * The square an infantry steps to on its way to a goal (a square, or a unit's footprint): the first
 * step of the shortest walk over free squares to anywhere touching the goal, planning `maxSteps`
 * ahead. With no such walk it takes the free neighbour that gets it closest as the crow flies, and
 * null when nothing helps or it is already there. Terrain and every living unit in `units` are in
 * the way (the automatic infantry pass only the units their owner knows of: knownUnits).
 */
export function nextStepToward(map: StrategicMap, units: readonly Unit[], unit: Unit, goal: Rect, maxSteps = PATH_STEPS): Point | null {
  const start = { x: unit.x, y: unit.y };
  const arrived = (p: Point) => squareDistance(square(p), goal) <= 1;
  if (arrived(start)) return null;
  const taken = occupancy(map, units, unit);
  const free = (p: Point) => insideMap(map, square(p)) && !isBlocked(map, p.x, p.y) && taken[squareIndex(map, p.x, p.y)] === 0;
  const seen = new Set([key(start)]);
  let frontier: { at: Point; first: Point | null }[] = [{ at: start, first: null }];
  for (let step = 0; step < maxSteps && frontier.length > 0; step++) {
    const next: typeof frontier = [];
    for (const { at, first } of frontier) {
      for (const d of DIRECTIONS) {
        const to = { x: at.x + d.x, y: at.y + d.y };
        const k = key(to);
        if (seen.has(k)) continue;
        seen.add(k);
        if (!free(to)) continue;
        if (arrived(to)) return first ?? to;
        next.push({ at: to, first: first ?? to });
      }
    }
    frontier = next;
  }
  // No way through that it can see: edge toward the goal anyway, if any step helps at all.
  const target = centreOf(goal);
  const closeness = (p: Point) => distance(centreOf(square(p)), target);
  let best: Point | null = null;
  let bestD = closeness(start);
  for (const d of DIRECTIONS) {
    const to = { x: start.x + d.x, y: start.y + d.y };
    if (!free(to)) continue;
    const dd = closeness(to);
    if (dd < bestD) {
      best = to;
      bestD = dd;
    }
  }
  return best;
}

/**
 * Move one of the owner's units to a new top-left square, noting the move. Changes the game in
 * place: the start of a turn works on its own copy (beginStrategicTurn, infantryStep), and copying
 * the whole game again for every step was what made tapping Start slow late in a long game.
 */
function moveTo(g: Game, owner: PlayerIndex, unitId: string, to: Point): void {
  const u = g.players[owner].units.find((v) => v.id === unitId);
  if (!u) return;
  const from = { x: u.x, y: u.y };
  u.x = to.x;
  u.y = to.y;
  g.strategic?.events.push({ kind: "move", turn: g.turn, player: owner, unitId, type: u.type, from, to: { ...to }, riders: [] });
}

/**
 * Hand-to-hand: the infantry hurts the target for DAMAGE.infantry. The melee event is noted before
 * the damage lands so that a fort's fall (which ends the game) comes after the blow that caused it.
 * Changes the game in place, like moveTo.
 */
function melee(g: Game, owner: PlayerIndex, unitId: string, targetId: string): void {
  const enemy = other(owner);
  const target = g.players[enemy].units.find((u) => u.id === targetId);
  if (!target) return;
  const before = hpLeft(target);
  const damage = Math.min(before, DAMAGE.infantry);
  g.strategic?.events.push({
    kind: "melee",
    turn: g.turn,
    player: owner,
    unitId,
    targetId,
    targetType: target.type,
    damage,
    destroyed: before <= DAMAGE.infantry,
  });
  damageInPlace(g, enemy, targetId, DAMAGE.infantry, owner);
}

/**
 * Close in on an enemy two squares away: take the free neighbouring square that brings the infantry
 * nearest (only if one does), then attack when that makes them touch. Changes the game in place;
 * false when the infantry found no better square and did nothing.
 */
function closeIn(g: Game, owner: PlayerIndex, unit: Unit, target: Unit): boolean {
  const s = g.strategic;
  if (!s) return false;
  const map = mapOf(s.map);
  const targetRect = rectOf(target);
  let best: Point | null = null;
  let bestD = squareDistance(rectOf(unit), targetRect);
  for (const path of reachable(map, allUnits(g), unit, 1).values()) {
    const p = path.at(-1);
    if (!p) continue;
    const d = squareDistance(footprintAt(unit, p.x, p.y), targetRect);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  if (!best) return false;
  moveTo(g, owner, unit.id, best);
  if (bestD === 1) melee(g, owner, unit.id, target.id);
  return true;
}

/**
 * Where an infantry with no enemy in reach heads: the enemy fort once its owner has seen it; else
 * the nearest unexplored open square on the enemy's side of the map (terrain is left out: infantry
 * see only one square and could never uncover the middle of a forest); else the middle of the
 * enemy half. Never the hidden enemy base: walking toward it would give its spot away.
 */
function goalOf(game: Game, s: StrategicState, owner: PlayerIndex, unit: Unit, visible: ReadonlySet<number>): Rect {
  const map = mapOf(s.map);
  const fort = game.players[other(owner)].units.find((u) => u.type === "fort");
  if (fort && (s.lastSeen[owner].some((seen) => seen.id === fort.id) || unitSeen(fort, visible, map))) return rectOf(fort);
  const explored = decodeExplored(s.explored[owner], map);
  for (const i of visible) explored.add(i);
  const from = centreOf(rectOf(unit));
  const left = ownSideIsLeft(s, owner, map);
  const enemyHalf = (x: number) => (x >= map.w / 2) === left;
  let best: Point | null = null;
  let bestD = Infinity;
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      if (!enemyHalf(x) || explored.has(squareIndex(map, x, y)) || isBlocked(map, x, y)) continue;
      const d = distance(centreOf(square({ x, y })), from);
      if (d < bestD) {
        best = { x, y };
        bestD = d;
      }
    }
  }
  return best ? square(best) : enemyHalfCentre(s, owner, map);
}

/**
 * One infantry acts, in place on a game the caller owns: it hits an enemy it is touching, closes in
 * on one its side can see two squares away, or walks toward the enemy fort or the nearest unexplored
 * ground on the enemy's side. It never steps onto terrain or another unit. The walk is planned round
 * only the units its owner knows of (knownUnits): a route bending round an enemy in the fog would
 * give that enemy away. The step itself is safe, since an infantry sees every square it touches.
 * False when the unit did nothing.
 */
function actInfantry(g: Game, owner: PlayerIndex, unitId: string): boolean {
  const s = g.strategic;
  const unit = g.players[owner].units.find((u) => u.id === unitId);
  if (!s || !unit || unit.type !== "infantry" || !isAlive(unit)) return false;
  const map = mapOf(s.map);
  const foes = g.players[other(owner)].units.filter((u) => isAlive(u));
  const rect = rectOf(unit);
  const touching = chooseMeleeTarget(foes.filter((f) => squareDistance(rect, rectOf(f)) === 1));
  if (touching) {
    melee(g, owner, unit.id, touching.id);
    return true;
  }
  const visible = visibleSquares(g.players[owner].units, map);
  const near = chooseMeleeTarget(foes.filter((f) => squareDistance(rect, rectOf(f)) <= 2 && unitSeen(f, visible, map)));
  if (near) return closeIn(g, owner, unit, near);
  if (waitingForLift(g, owner, rect)) return false;
  const step = nextStepToward(map, knownUnits(g, owner, visible), unit, goalOf(g, s, owner, unit, visible));
  if (!step) return false;
  moveTo(g, owner, unit.id, step);
  return true;
}

/**
 * One infantry acts at the start of its owner's turn (actInfantry). Returns a new game, or the same
 * game when the unit does nothing.
 */
export function infantryStep(game: Game, owner: PlayerIndex, unitId: string): Game {
  const g = structuredClone(game);
  return actInfantry(g, owner, unitId) ? g : game;
}

/**
 * True when an infantry stands beside one of its own living trucks: it waits there for a lift
 * instead of marching off, so the truck can be loaded one turn and driven the next. Infantry act
 * before orders, so without this they would always have walked away by the time the truck moves.
 * Fighting comes first: an infantry with an enemy adjacent or within two squares never waits.
 */
export function waitingForLift(game: Game, owner: PlayerIndex, rect: Rect): boolean {
  return game.players[owner].units.some((u) => u.type === "truck" && isAlive(u) && squareDistance(rect, rectOf(u)) === 1);
}

/**
 * The fort sends out new infantry at the start of its owner's turn, from their second turn on. Each
 * appears on the free square around the fort nearest the middle of the map (nearest first, then
 * reading order), with the next id in the owner's sequence: the same rule for both sides, and never
 * the enemy base, whose hidden spot the newcomers would otherwise point at. A boxed-in or fallen
 * fort sends nobody. The new infantry act from the next turn. Returns a new game, or the same game
 * when the fort sends nobody.
 */
export function spawnInfantry(game: Game, owner: PlayerIndex): Game {
  const g = structuredClone(game);
  return sendOutInfantry(g, owner) ? g : game;
}

/** spawnInfantry, in place on a game the caller owns (like actInfantry). False when nobody was sent out. */
function sendOutInfantry(g: Game, owner: PlayerIndex): boolean {
  const s = g.strategic;
  const fort = g.players[owner].units.find((u) => u.type === "fort");
  if (!s || !fort || !isAlive(fort) || turnNumber(g, owner) < SPAWN_FROM_TURN) return false;
  const map = mapOf(s.map);
  const target = { x: map.w / 2, y: map.h / 2 };
  const ring = ringAround(rectOf(fort))
    .map((p, order) => ({ p, d: distance(centreOf(square(p)), target), order }))
    .sort((a, b) => a.d - b.d || a.order - b.order)
    .map(({ p }) => p);
  let sent = false;
  for (let n = 0; n < SPAWN_PER_TURN; n++) {
    const spot = ring.find((p) => isFree(map, allUnits(g), square(p)));
    if (!spot) break;
    const id = `infantry-${s.nextInfantry[owner]}`;
    s.nextInfantry[owner] += 1;
    g.players[owner].units.push({ id, type: "infantry", x: spot.x, y: spot.y, upright: false, hits: 0 });
    s.events.push({ kind: "spawn", turn: g.turn, player: owner, unitId: id, at: { ...spot } });
    sent = true;
  }
  return sent;
}

/**
 * The start of a Strategic turn, run once per Game.turn (autoDoneTurn remembers which): last turn's
 * orders are cleared, the player's infantry act one by one in unit order, the fort sends out its
 * new infantry, and the player looks around. An infantry blow that fells the enemy fort ends the
 * game on the spot and nothing more happens. Returns a new game, or the same game when this turn
 * has already begun (or it is not a Strategic turn).
 */
export function beginStrategicTurn(game: Game): Game {
  const s = game.strategic;
  if (!s || game.phase !== "turn" || s.autoDoneTurn === game.turn) return game;
  // One copy for the whole start of turn, changed in place from here on: copying the game (and its
  // ever longer event log) again for every infantry was what made tapping Start slow.
  const g = structuredClone(game);
  if (g.strategic) g.strategic.orders = {};
  const p = g.current;
  const infantry = g.players[p].units.filter((u) => u.type === "infantry" && isAlive(u)).map((u) => u.id);
  for (const id of infantry) {
    actInfantry(g, p, id);
    if (g.phase === "over") return g;
  }
  sendOutInfantry(g, p);
  noteWhatIsSeen(g, p);
  if (g.strategic) g.strategic.autoDoneTurn = g.turn;
  return g;
}
