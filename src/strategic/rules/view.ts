import type { Game, PlayerIndex } from "../../rules/game.ts";
import { decodeExplored, seenNow, unitSeen, visibleSquares } from "./fog.ts";
import { mapOf } from "./maps.ts";
import type { StrategicView } from "./types.ts";

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
  const enemies: StrategicView["enemies"] = [];
  for (const u of game.players[viewer === 0 ? 1 : 0].units) {
    if (unitSeen(u, visible, map)) enemies.push({ unit: seenNow(u, game.turn), current: true });
    else {
      const old = lastSeen.find((seen) => seen.id === u.id);
      if (old) enemies.push({ unit: old, current: false });
    }
  }
  return {
    map,
    viewer,
    base: s.bases[viewer],
    units,
    explored,
    visible,
    enemies,
    exploredPercent: exploredPercent(explored, map),
    turnNumber: turnNumber(game, viewer),
  };
}
