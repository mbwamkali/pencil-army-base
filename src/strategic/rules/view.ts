import type { Game, PlayerIndex } from "../../rules/game.ts";
import type { Unit } from "../../rules/units.ts";
import { HP, hpLeft, stateOf } from "./constants.ts";
import { decodeExplored, unitSeen, visibleSquares } from "./fog.ts";
import { mapOf } from "./maps.ts";
import type { DrawnUnit, SeenUnit, StrategicView } from "./types.ts";

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
export function exploredPercent(explored: ReadonlySet<number>, map: { w: number; h: number }): number {
  return Math.round((100 * explored.size) / (map.w * map.h));
}

/**
 * Everything one player may see of a Strategic game. Enemy units appear only while one of the
 * viewer's units can see them (current) or as the last sighting the viewer recorded; an enemy unit
 * never seen is left out entirely, so the screens cannot leak it.
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
  const lastSeen = s.lastSeen[viewer];
  const enemy: PlayerIndex = viewer === 0 ? 1 : 0;
  const enemies: DrawnUnit[] = [];
  for (const u of game.players[enemy].units) {
    if (unitSeen(u, visible, map)) enemies.push(drawnUnit(u, enemy));
    else {
      const old = lastSeen.find((seen) => seen.id === u.id);
      if (old) enemies.push(drawnSighting(old, enemy));
    }
  }
  return {
    map,
    viewer,
    base: s.bases[viewer],
    enemyBase: null,
    units: units.map((u) => drawnUnit(u, viewer)),
    enemies,
    explored,
    visible,
    shots: [],
    lastShot: null,
    orders: [],
    report: [],
    exploredPercent: exploredPercent(explored, map),
    turnNumber: turnNumber(game, viewer),
    over: game.phase === "over",
    winner: game.winner,
  };
}
