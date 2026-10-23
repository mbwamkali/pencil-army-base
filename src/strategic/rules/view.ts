import type { Game, PlayerIndex } from "../../rules/game.ts";
import type { Unit } from "../../rules/units.ts";
import { ACTIVE_TYPES, HP, MOVE, hpLeft, isAlive, stateOf } from "./constants.ts";
import { decodeExplored, unitSeen, visibleSquares } from "./fog.ts";
import { mapOf } from "./maps.ts";
import { landingSquare, reachableFor, ridersFor, tankTargets } from "./orders.ts";
import type { DrawnUnit, MapShot, OrderRow, SeenUnit, StrategicEvent, StrategicMap, StrategicState, StrategicView } from "./types.ts";

type Size = Pick<StrategicMap, "w" | "h">;

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

/** A unit as the screens draw it. */
export function drawnUnit(u: Unit, owner: PlayerIndex): DrawnUnit {
  return { id: u.id, type: u.type, x: u.x, y: u.y, upright: u.upright, state: stateOf(u), hp: hpLeft(u), maxHp: HP[u.type], owner, current: true };
}

/** A last sighting as the screens draw it: faded, where it was when seen. */
export function drawnSighting(s: SeenUnit, owner: PlayerIndex): DrawnUnit {
  const hp = s.hp ?? (s.state === "destroyed" ? 0 : HP[s.type]);
  return { id: s.id, type: s.type, x: s.x, y: s.y, upright: s.upright, state: s.state, hp, maxHp: HP[s.type], owner, current: false, seenTurn: s.turn };
}

/**
 * The viewer's own turn count. Game.turn counts both players' turns; player 1 always goes first,
 * so turns 1, 3, 5 are theirs and 2, 4, 6 belong to player 2.
 */
export function turnNumber(game: Pick<Game, "turn" | "firstShooter">, viewer: PlayerIndex): number {
  return viewer === game.firstShooter ? Math.ceil(game.turn / 2) : Math.floor(game.turn / 2);
}

/** Share of the map explored, 0 to 100, rounded. */
export function exploredPercent(explored: ReadonlySet<number>, map: Size): number {
  return Math.round((100 * explored.size) / (map.w * map.h));
}

/**
 * A shot as its shooter knows it: only the hits they could vouch for as it fell (their own units,
 * and enemies a unit of theirs was watching), and the outcome those hits add up to. A blind shell
 * that struck nothing in sight is "unknown": they saw neither the landing nor a victim. A watched
 * landing with no hit in sight reads as a miss, whatever the fog hid, so the shooter learns the
 * same from a shell that hit a fogged unit as from one that hit nothing.
 */
export function shooterView(shot: MapShot): MapShot {
  const hits = shot.hits.filter((h) => h.seen);
  const outcome = hits.length > 0 ? (hits.every((h) => h.type === "wall") ? "wall" : "hit") : shot.revealed ? "miss" : "unknown";
  return { ...shot, outcome, hits };
}

/**
 * A shot as one player may see it. Their own shot shows only what they could see of it (shells
 * reveal nothing). An enemy shot shows only when it hurt them or fell on ground they know, and then
 * only the hits on their own units, so it never tells them about enemy units in the fog. Null when
 * the viewer may not see it at all.
 */
export function shotForViewer(shot: MapShot, viewer: PlayerIndex, explored: ReadonlySet<number>, map: Size): MapShot | null {
  if (shot.by === viewer) return shooterView(shot);
  const hits = shot.hits.filter((h) => h.owner === viewer);
  if (hits.length === 0 && !explored.has(landingSquare(shot, map))) return null;
  const outcome = hits.length === 0 ? "miss" : hits.every((h) => h.type === "wall") ? "wall" : "hit";
  return { ...shot, outcome, hits };
}

/** The enemy units the viewer may see: in sight now, or as the viewer last saw them. */
function enemiesFor(game: Game, viewer: PlayerIndex, visible: ReadonlySet<number>, map: StrategicMap): DrawnUnit[] {
  const s = game.strategic as StrategicState;
  const enemy = other(viewer);
  const out: DrawnUnit[] = [];
  for (const u of game.players[enemy].units) {
    if (unitSeen(u, visible, map)) out.push(drawnUnit(u, enemy));
    else {
      const old = s.lastSeen[viewer].find((seen) => seen.id === u.id);
      if (old) out.push(drawnSighting(old, enemy));
    }
  }
  return out;
}

/** The orders list: one row per living active unit of the viewer, with what it may still do. */
function orderRows(game: Game, viewer: PlayerIndex): OrderRow[] {
  const s = game.strategic as StrategicState;
  return game.players[viewer].units
    .filter((u) => ACTIVE_TYPES.includes(u.type) && isAlive(u))
    .map((u) => {
      const { moved, fired } = s.orders[u.id] ?? { moved: false, fired: false };
      const row: OrderRow = {
        unitId: u.id,
        type: u.type,
        moved,
        fired,
        canMove: MOVE[u.type] > 0 && !moved && !fired && reachableFor(game, u.id).length > 0,
        canFire: u.type === "tank" ? !fired && tankTargets(game, u.id).length > 0 : u.type === "artillery" && !fired,
      };
      if (u.type === "truck") row.riders = ridersFor(game, u.id).length;
      return row;
    });
}

/** "tank-2" reads as "tank 2" in the panel. */
const nameOf = (unitId: string): string => unitId.replace("-", " ");

type Melee = Extract<StrategicEvent, { kind: "melee" }>;

/** One line for what the viewer's infantry did this turn, however many of them fought. */
function meleeLine(fights: readonly Melee[]): string {
  const destroyed = fights.filter((f) => f.destroyed).length;
  if (fights.length === 1) {
    const f = fights[0] as Melee;
    return `Your infantry ${f.destroyed ? "destroyed" : "hit"} an enemy ${f.targetType}`;
  }
  if (destroyed === fights.length) return `Your infantry destroyed ${fights.length} enemy units`;
  if (destroyed === 0) return `Your infantry hit ${fights.length} enemy units`;
  return `Your infantry hit ${fights.length} enemy units (${destroyed} destroyed)`;
}

/**
 * What happened since the viewer's previous turn: the enemy's last turn and this turn's automatic
 * phase, read from the events and shots stamped later than two turns ago. At most four short lines,
 * worst news first, for the narrow panel.
 */
function reportLines(game: Game, viewer: PlayerIndex, enemies: readonly DrawnUnit[], explored: ReadonlySet<number>, map: StrategicMap): string[] {
  const s = game.strategic as StrategicState;
  const since = game.turn - 2;
  const events = s.events.filter((e) => e.turn > since);
  const shots = s.shots.filter((shot) => shot.turn > since);
  const myHits = shots.flatMap((shot) => shot.hits.filter((h) => h.owner === viewer));
  const enemyMelee = events.filter((e): e is Melee => e.kind === "melee" && e.player !== viewer);
  const lines: string[] = [];
  const lost = [...myHits.filter((h) => h.destroyed).map((h) => h.unitId), ...enemyMelee.filter((e) => e.destroyed).map((e) => e.targetId)];
  if (lost.length > 0) lines.push(`Lost: ${lost.map(nameOf).join(", ")}`);
  const fort = game.players[viewer].units.find((u) => u.type === "fort");
  const fortHurt = myHits.some((h) => h.type === "fort" && h.damage > 0) || enemyMelee.some((e) => e.targetType === "fort");
  if (fort && fortHurt && isAlive(fort)) lines.push(`Fort hit: ${hpLeft(fort)} of ${HP.fort} left`);
  const fights = events.filter((e): e is Melee => e.kind === "melee" && e.player === viewer);
  if (fights.length > 0) lines.push(meleeLine(fights));
  const spawned = events.filter((e) => e.kind === "spawn" && e.player === viewer);
  if (spawned.length === 1) lines.push(`The fort sent out ${nameOf((spawned[0] as { unitId: string }).unitId)}`);
  else if (spawned.length > 1) lines.push(`The fort sent out ${spawned.length} infantry`);
  const near = shots.filter(
    (shot) => shot.by !== viewer && shot.weapon === "shell" && !shot.hits.some((h) => h.owner === viewer) && explored.has(landingSquare(shot, map)),
  ).length;
  if (near === 1) lines.push("A shell landed near you");
  else if (near > 1) lines.push(`${near} shells landed near you`);
  const inSight = enemies.filter((e) => e.current && e.state !== "destroyed");
  if (inSight.length === 1) lines.push(`Enemy ${(inSight[0] as DrawnUnit).type} in sight`);
  else if (inSight.length > 1) lines.push(`${inSight.length} enemy units in sight`);
  return lines.slice(0, 4);
}

/**
 * Everything one player may see of a Strategic game. Enemy units appear only while one of the
 * viewer's units can see them (current) or as the last sighting the viewer recorded, and shots are
 * filtered the same way, so the screens cannot leak what the fog hides.
 */
export function strategicView(game: Game, viewer: PlayerIndex): StrategicView {
  const s = game.strategic;
  if (!s) throw new Error("Strategic game has not been set up yet");
  const map = mapOf(s.map);
  const units = game.players[viewer].units;
  const visible = visibleSquares(units, map);
  // What is in sight now counts as explored even before the turn's end-of-turn look around.
  const explored = decodeExplored(s.explored[viewer], map);
  for (const i of visible) explored.add(i);
  const enemies = enemiesFor(game, viewer, visible, map);
  const shots = s.shots.map((shot) => shotForViewer(shot, viewer, explored, map)).filter((shot): shot is MapShot => shot !== null);
  const myTurn = game.phase === "turn" && game.current === viewer;
  return {
    map,
    viewer,
    base: s.bases[viewer],
    enemyBase: enemies.some((e) => e.type === "fort") ? s.bases[other(viewer)] : null,
    units: units.map((u) => drawnUnit(u, viewer)),
    enemies,
    explored,
    visible,
    shots,
    lastShot: shots.filter((shot) => shot.by === viewer && shot.turn === game.turn).at(-1) ?? null,
    orders: myTurn ? orderRows(game, viewer) : [],
    report: reportLines(game, viewer, enemies, explored, map),
    exploredPercent: exploredPercent(explored, map),
    turnNumber: turnNumber(game, viewer),
    over: game.phase === "over",
    winner: game.winner,
  };
}

/**
 * The whole map with nothing hidden, for the results screen once a fort has fallen: both armies,
 * every square explored and every shot with what it really did. Never shown before the game is over.
 */
export function revealView(game: Game): StrategicView {
  const s = game.strategic;
  if (!s) throw new Error("Strategic game has not been set up yet");
  const map = mapOf(s.map);
  return {
    map,
    viewer: 0,
    base: s.bases[0],
    enemyBase: s.bases[1],
    units: game.players[0].units.map((u) => drawnUnit(u, 0)),
    enemies: game.players[1].units.map((u) => drawnUnit(u, 1)),
    explored: new Set(Array.from({ length: map.w * map.h }, (_, i) => i)),
    visible: new Set(),
    shots: s.shots.map((shot) => ({ ...shot, revealed: true })),
    lastShot: null,
    orders: [],
    report: [],
    exploredPercent: 100,
    turnNumber: turnNumber(game, 0),
    over: game.phase === "over",
    winner: game.winner,
  };
}
