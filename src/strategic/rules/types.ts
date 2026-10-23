import type { UnitType } from "../../rules/constants.ts";
import type { PlayerIndex } from "../../rules/game.ts";
import type { Unit, UnitState } from "../../rules/units.ts";

/**
 * Strategic mode: a big paper map with fog of war. These types are the contract between the
 * rules (src/strategic/rules) and the screens (src/strategic/ui). Everything here is plain data,
 * so a game saves to the browser and replays exactly, like the Quick action modes.
 */

export type TerrainKind = "forest" | "hill";

/**
 * A patch of terrain, drawn as an ellipse in map squares. A square belongs to the feature when
 * its centre is inside the ellipse. Units can never enter it and it never changes.
 */
export interface TerrainFeature {
  kind: TerrainKind;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export type MapSize = "small" | "medium" | "large";

export interface Point {
  x: number;
  y: number;
}

export interface StrategicMap {
  id: string;
  name: string;
  size: MapSize;
  /** Map size in squares. */
  w: number;
  h: number;
  terrain: TerrainFeature[];
  /**
   * Where player 1's base (BASE_GRID squares) may be dropped, as top-left squares. Player 2 gets the
   * same spot turned half a circle (maps are point-symmetric), so both sides are fair.
   */
  baseSpots: Point[];
}

/** An enemy unit as one player saw it: where it was and what state it was in on a given turn. */
export interface SeenUnit {
  id: string;
  type: UnitType;
  x: number;
  y: number;
  upright: boolean;
  state: UnitState;
  /** Game turn (Game.turn) it was last seen on. */
  turn: number;
}

/** Strategic data kept on the Game once both bases are built (Game.strategic). */
export interface StrategicState {
  /** Which map (StrategicMap.id). */
  map: string;
  /** Top-left square of each player's base on the map. */
  bases: [Point, Point];
  /** Squares each player has explored, packed by encodeExplored in fog.ts. */
  explored: [string, string];
  /** Enemy units each player has seen, latest sighting per unit id. */
  lastSeen: [SeenUnit[], SeenUnit[]];
}

/**
 * What one player may see of the map on their turn. Built by strategicView and the only thing the
 * screens draw from, so an enemy unit the viewer has never seen can never leak onto the screen.
 */
export interface StrategicView {
  map: StrategicMap;
  viewer: PlayerIndex;
  /** The viewer's own base, top-left square. */
  base: Point;
  /** The viewer's own units, in map squares. */
  units: Unit[];
  /** Square indexes (y * map.w + x) the viewer has explored so far. */
  explored: Set<number>;
  /** Square indexes one of the viewer's units can see right now. */
  visible: Set<number>;
  /** Enemy units to draw: seen right now (current) or a faded "last seen" mark. */
  enemies: { unit: SeenUnit; current: boolean }[];
  /** Share of the map explored, 0 to 100, rounded. */
  exploredPercent: number;
  /** The viewer's own turn count, starting at 1 for their first turn. */
  turnNumber: number;
}
