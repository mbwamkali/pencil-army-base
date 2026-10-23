import type { Game, PlayerIndex } from "../../rules/game.ts";
import { Rng } from "../../rules/rng.ts";
import { BASE_GRID, STRATEGIC_ARMY } from "./constants.ts";
import { encodeExplored, lookAround, squaresOfRect } from "./fog.ts";
import { DEFAULT_MAP_ID, mapOf } from "./maps.ts";
import type { Point, StrategicMap } from "./types.ts";

/** Where player 2's base goes for a given player 1 spot: the same spot turned half a circle. */
export function oppositeSpot(spot: Point, map: Pick<StrategicMap, "w" | "h">): Point {
  return { x: map.w - BASE_GRID.w - spot.x, y: map.h - BASE_GRID.h - spot.y };
}

/**
 * Both bases are built: drop them onto the map and start the fog of war. Player 1's spot is drawn
 * with the game's Rng, player 2 gets its opposite, and every unit moves from base squares to map
 * squares. Player 2's layout is not flipped: they built it facing left and their base sits in the
 * right half, so it already faces the enemy. Each player starts knowing their whole base plus what
 * their units can see. Returns a new game; a game that is already set up comes back unchanged.
 */
export function startStrategic(game: Game): Game {
  if (game.strategic) return game;
  const g = structuredClone(game);
  const map = mapOf(DEFAULT_MAP_ID);
  const rng = new Rng(g.rngState);
  const spot = rng.pick(map.baseSpots);
  g.rngState = rng.state;
  const bases: [Point, Point] = [spot, oppositeSpot(spot, map)];
  for (const p of [0, 1] as PlayerIndex[]) {
    const base = bases[p];
    g.players[p].units = g.players[p].units.map((u) => ({ ...u, x: u.x + base.x, y: u.y + base.y }));
  }
  const baseSquares = (base: Point) => encodeExplored(new Set(squaresOfRect({ ...base, ...BASE_GRID }, map)), map);
  g.strategic = {
    map: map.id,
    bases,
    explored: [baseSquares(bases[0]), baseSquares(bases[1])],
    lastSeen: [[], []],
    orders: {},
    autoDoneTurn: 0,
    shots: [],
    events: [],
    nextInfantry: [STRATEGIC_ARMY.infantry + 1, STRATEGIC_ARMY.infantry + 1],
    nextShot: 1,
  };
  return lookAround(lookAround(g, 0), 1);
}
