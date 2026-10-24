import type { Game, PlayerIndex } from "../../rules/game.ts";
import { Rng } from "../../rules/rng.ts";
import { overlapsTerrain } from "./board.ts";
import { BASE_GRID, CENTRE_GAP, STRATEGIC_ARMY } from "./constants.ts";
import { encodeExplored, lookAround, squaresOfRect } from "./fog.ts";
import { NEW_GAME_MAP_IDS, mapOf } from "./maps.ts";
import type { Point, StrategicMap } from "./types.ts";

/**
 * The same spot turned half a circle. Stage 3 placed player 2's base this way, so games saved then
 * have mirrored bases; new games draw each base on its own (validBaseSpots), and the tests use this
 * to check that player 2's spot is not simply player 1's turned round.
 */
export function oppositeSpot(spot: Point, map: Pick<StrategicMap, "w" | "h">): Point {
  return { x: map.w - BASE_GRID.w - spot.x, y: map.h - BASE_GRID.h - spot.y };
}

/** The columns of a player's half of the map: player 1 has the left half, player 2 the right. */
function halfColumns(map: Pick<StrategicMap, "w">, player: PlayerIndex): { from: number; to: number } {
  const half = Math.floor(map.w / 2);
  return player === 0 ? { from: 0, to: half - 1 } : { from: half, to: map.w - 1 };
}

/**
 * Every top-left square where a player's base (BASE_GRID squares) may land, in reading order. The
 * base must lie in the player's own half with CENTRE_GAP clear columns between it and the centre
 * line (so no fort can see the enemy at the start), keep one square from every map edge (so units
 * can walk round it), and have no terrain inside it or touching it (so nothing is boxed in).
 */
export function validBaseSpots(map: StrategicMap, player: PlayerIndex): Point[] {
  const cols = halfColumns(map, player);
  const xFrom = Math.max(1, player === 0 ? cols.from : cols.from + CENTRE_GAP);
  const xTo = Math.min(map.w - 1 - BASE_GRID.w, player === 0 ? cols.to - CENTRE_GAP - BASE_GRID.w + 1 : cols.to - BASE_GRID.w + 1);
  const spots: Point[] = [];
  for (let y = 1; y <= map.h - 1 - BASE_GRID.h; y++) {
    for (let x = xFrom; x <= xTo; x++) {
      // The base and the ring of squares round it must be clear of terrain.
      if (!overlapsTerrain(map, { x: x - 1, y: y - 1, w: BASE_GRID.w + 2, h: BASE_GRID.h + 2 })) spots.push({ x, y });
    }
  }
  return spots;
}

/** The base centred in a player's half: where it goes should a map ever have no valid spot. */
function middleOfHalf(map: StrategicMap, player: PlayerIndex): Point {
  const cols = halfColumns(map, player);
  const x = cols.from + Math.floor((cols.to - cols.from + 1 - BASE_GRID.w) / 2);
  return { x: Math.max(0, x), y: Math.max(0, Math.floor((map.h - BASE_GRID.h) / 2)) };
}

/** One player's base spot, drawn with the game's Rng from the valid spots of their half. */
function drawSpot(rng: Rng, map: StrategicMap, player: PlayerIndex): Point {
  const spots = validBaseSpots(map, player);
  return spots.length > 0 ? rng.pick(spots) : middleOfHalf(map, player);
}

/**
 * Drops both built bases onto a map at the given top-left spots and starts the fog of war: every
 * unit moves from base squares to map squares. Player 2's layout is not flipped: they built it
 * facing left and their base sits in the right half, so it already faces the enemy. Each player
 * starts knowing their whole base plus what their units can see. The armies are copied as they
 * land, so replays can rebuild any later moment. Returns a new game; a game that is already set up
 * comes back unchanged.
 */
export function placeBases(game: Game, mapId: string, bases: [Point, Point]): Game {
  if (game.strategic) return game;
  const g = structuredClone(game);
  const map = mapOf(mapId);
  const spots: [Point, Point] = [{ ...bases[0] }, { ...bases[1] }];
  for (const p of [0, 1] as PlayerIndex[]) {
    const base = spots[p];
    g.players[p].units = g.players[p].units.map((u) => ({ ...u, x: u.x + base.x, y: u.y + base.y }));
  }
  const baseSquares = (base: Point) => encodeExplored(new Set(squaresOfRect({ ...base, ...BASE_GRID }, map)), map);
  g.strategic = {
    map: map.id,
    bases: spots,
    explored: [baseSquares(spots[0]), baseSquares(spots[1])],
    lastSeen: [[], []],
    orders: {},
    autoDoneTurn: 0,
    shots: [],
    events: [],
    nextInfantry: [STRATEGIC_ARMY.infantry + 1, STRATEGIC_ARMY.infantry + 1],
    nextShot: 1,
    // The armies as they stand now, before any turn: every later moment is rebuilt from here and the events.
    start: [structuredClone(g.players[0].units), structuredClone(g.players[1].units)],
  };
  return lookAround(lookAround(g, 0), 1);
}

/**
 * Both bases are built: draw the map and each player's base spot with the game's Rng (in that
 * order: map, player 1's spot, player 2's spot), then drop the bases there. The two spots are drawn
 * independently, each from its own half, so neither player knows where the enemy base is until
 * they find its fort. Returns a new game; a game that is already set up comes back unchanged.
 */
export function startStrategic(game: Game): Game {
  if (game.strategic) return game;
  const rng = new Rng(game.rngState);
  const map = mapOf(rng.pick(NEW_GAME_MAP_IDS));
  const bases: [Point, Point] = [drawSpot(rng, map, 0), drawSpot(rng, map, 1)];
  return placeBases({ ...game, rngState: rng.state }, map.id, bases);
}
