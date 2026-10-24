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

/**
 * A hand-made, point-symmetric map. It lists no base spots: each player's base lands at a random
 * spot in their own half, drawn by a rule (validBaseSpots in setup.ts).
 */
export interface StrategicMap {
  id: string;
  name: string;
  size: MapSize;
  /** Map size in squares. */
  w: number;
  h: number;
  terrain: TerrainFeature[];
}

/** An enemy unit as one player saw it: where it was and what state it was in on a given turn. */
export interface SeenUnit {
  id: string;
  type: UnitType;
  x: number;
  y: number;
  upright: boolean;
  state: UnitState;
  /** Hit points it had left when seen (missing in saves from the first test build). */
  hp?: number;
  /** Game turn (Game.turn) it was last seen on. */
  turn: number;
}

/** What fired a shot on the map. Infantry fight hand to hand, which is not a shot. */
export type Weapon = "shell" | "tank";

/** One unit a shot hurt. Shells hurt whatever is under them, so the owner is recorded too. */
export interface ShotHitRecord {
  unitId: string;
  owner: PlayerIndex;
  type: UnitType;
  damage: number;
  destroyed: boolean;
  /**
   * True when the shooter could vouch for this hit as the shot fell: their own units always, an
   * enemy only when one of their units had it in sight. A shell reveals nothing, so the shooter's
   * view of their own shot keeps only these hits (the victim sees every hit on their own units).
   */
  seen: boolean;
}

/** A shot fired on the map: where it was aimed, where it landed and what it did. */
export interface MapShot {
  /** Sequence number, from 1, across both players. */
  id: number;
  by: PlayerIndex;
  weapon: Weapon;
  /** The unit that fired. */
  unitId: string;
  /** Where the player aimed, in fractional map squares. */
  aim: Point;
  /** Where it landed, in fractional map squares (a shell drifts from the aim by up to shakeRadius of its range). */
  x: number;
  y: number;
  turn: number;
  /**
   * miss: nothing under it; wall: a standing wall took the whole blow; hit: units took damage;
   * unknown: only in a view, for a blind shell whose landing the shooter could not see.
   */
  outcome: "miss" | "wall" | "hit" | "unknown";
  hits: ShotHitRecord[];
  /** True when the shooter could see the landing square as it fired (a tank shot always; a shell only when a unit was watching). */
  revealed: boolean;
}

/** Where one truck rider was lifted from and set down (top-left squares). */
export interface RiderMove {
  unitId: string;
  from: Point;
  to: Point;
}

/** Everything that happens on the map, in order, so the handover replay can rebuild any moment. */
export type StrategicEvent =
  | {
      kind: "move";
      turn: number;
      player: PlayerIndex;
      unitId: string;
      type: UnitType;
      from: Point;
      to: Point;
      riders: string[];
      /** Where each rider went, in the same order as riders. Missing in saves from the stage 2 test build. */
      riderMoves?: RiderMove[];
    }
  | { kind: "shot"; turn: number; player: PlayerIndex; shotId: number }
  | { kind: "melee"; turn: number; player: PlayerIndex; unitId: string; targetId: string; targetType: UnitType; damage: number; destroyed: boolean }
  | { kind: "spawn"; turn: number; player: PlayerIndex; unitId: string; at: Point }
  | { kind: "fort-destroyed"; turn: number; player: PlayerIndex; by: PlayerIndex };

/** What a unit has used this turn. A unit with no entry has used nothing. */
export interface OrderState {
  moved: boolean;
  fired: boolean;
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
  /** The current player's units' orders this turn, by unit id. Cleared when a turn begins. */
  orders: Record<string, OrderState>;
  /** The Game.turn whose start-of-turn automatic actions (infantry, fort spawn) have already run. */
  autoDoneTurn: number;
  shots: MapShot[];
  events: StrategicEvent[];
  /** The number the next spawned infantry gets, per player ("infantry-3" after a two-infantry army). */
  nextInfantry: [number, number];
  /** The id the next shot gets. */
  nextShot: number;
  /**
   * Both armies as they stood on the map before turn 1's automatic phase, so any moment can be
   * rebuilt from the events. Missing in stage 2 saves: no replays and no tracks for those games.
   */
  start?: [Unit[], Unit[]];
}

/** A unit as the screens draw it: position, state and hit points, for either side. */
export interface DrawnUnit {
  id: string;
  type: UnitType;
  x: number;
  y: number;
  upright: boolean;
  state: UnitState;
  /** Hit points left and the unit's full hit points (HP in constants.ts). */
  hp: number;
  maxHp: number;
  owner: PlayerIndex;
  /** Own units are always current. An enemy is current while one of the viewer's units can see it; otherwise this is its last-seen mark. */
  current: boolean;
  /** For a last-seen enemy: the Game.turn it was seen on. */
  seenTurn?: number;
}

/** One line of the orders list: an active unit (tank, artillery, truck) of the viewer and what it can still do. */
export interface OrderRow {
  unitId: string;
  type: UnitType;
  moved: boolean;
  fired: boolean;
  /** True while the unit may still move this turn and has somewhere to go. */
  canMove: boolean;
  /** True while the unit may still fire this turn (a tank also needs a target in range). */
  canFire: boolean;
  /** A truck: how many infantry would ride along if it moved now. */
  riders?: number;
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
  /** The enemy base's top-left square, once the viewer has seen the enemy fort; null before that. */
  enemyBase: Point | null;
  /** The viewer's own units, alive and destroyed, in map squares. */
  units: DrawnUnit[];
  /** Enemy units to draw: seen right now (current) or a faded last-seen mark. */
  enemies: DrawnUnit[];
  /** Square indexes (y * map.w + x) the viewer has explored so far. */
  explored: Set<number>;
  /** Square indexes one of the viewer's units can see right now. */
  visible: Set<number>;
  /** Shots the viewer may see: every shot of their own, and enemy shots that landed on explored ground or hurt the viewer's units. */
  shots: MapShot[];
  /** The viewer's latest shot this turn, highlighted on the map; null before they fire. */
  lastShot: MapShot | null;
  /** The viewer's active units and what each may still do this turn (empty when it is not their turn or the game is over). */
  orders: OrderRow[];
  /** Short lines about what happened since the viewer's last turn (losses, hits on the fort, shells nearby, enemies in sight). */
  report: string[];
  /** Share of the map explored, 0 to 100, rounded. */
  exploredPercent: number;
  /** The viewer's own turn count, starting at 1 for their first turn. */
  turnNumber: number;
  /** True once a fort has fallen; winner is who destroyed it. */
  over: boolean;
  winner: PlayerIndex | null;
}

/** Something drawn on the replay map for one step. Points are fractional map squares. */
export type ReplayMark =
  /** Where a unit went: footprint centres, at least two points (an enemy's is cut to what the viewer could see). */
  | { kind: "track"; owner: PlayerIndex; points: Point[] }
  /** A shot's landing point; from is the shooter's footprint centre when the viewer could see the shooter, else null. */
  | { kind: "shot"; shotId: number; weapon: Weapon; x: number; y: number; from: Point | null }
  /** A fight: midway between the two footprint centres, or on the viewer's unit when the attacker was out of sight. */
  | { kind: "clash"; at: Point }
  /** The centre of a new infantry's square. */
  | { kind: "spawn"; at: Point };

/** One step of a replay: what happened, where to look, and the map just after it. */
export interface ReplayStep {
  /** "enemy": the opponent's turn as the viewer saw it. "own": the viewer's own automatic start of turn. "turn": one whole turn in a match replay. */
  part: "enemy" | "own" | "turn";
  /** One short line for the list, at most about 34 characters: "A shell destroyed your tank 1". */
  text: string;
  /** Where the camera should look, a map point. */
  focus: Point;
  /** The map just after this step, as the viewer may see it. */
  frame: StrategicView;
  marks: ReplayMark[];
  /**
   * Units that moved in this step (top-left squares), for the slide animation. An enemy unit's slide
   * is cut like its track to what the viewer saw, so its ends may be fractional but never lie in the fog.
   */
  moves: { unitId: string; owner: PlayerIndex; from: Point; to: Point }[];
  /** Match replay only: the Game.turn this step shows and who played it. */
  turn?: number;
  player?: PlayerIndex;
}

/** A replay: the map before it starts and the steps to play, in order. */
export interface Replay {
  /** The map before the first step. */
  before: StrategicView;
  steps: ReplayStep[];
  /** True when the replay is worth opening: the enemy did something the viewer saw, or the viewer's infantry fought. */
  open: boolean;
}
