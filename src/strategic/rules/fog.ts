import type { Game, PlayerIndex } from "../../rules/game.ts";
import { rectOf, type Rect, type Unit } from "../../rules/units.ts";
import { SIGHT, hpLeft, isAlive, stateOf } from "./constants.ts";
import { mapOf, squareIndex } from "./maps.ts";
import type { SeenUnit, StrategicMap } from "./types.ts";

type Size = Pick<StrategicMap, "w" | "h">;

/** Square indexes (y * w + x) of every map square inside a rectangle, clipped to the map. */
export function squaresOfRect(rect: Rect, map: Size): number[] {
  const out: number[] = [];
  for (let y = Math.max(0, rect.y); y < Math.min(map.h, rect.y + rect.h); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(map.w, rect.x + rect.w); x++) out.push(squareIndex(map, x, y));
  }
  return out;
}

/** Distance from a point to the nearest point of a rectangle; 0 inside it. */
export function distanceToRect(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/**
 * Every square at least one of these units can see right now. Destroyed units see nothing.
 * A square is in sight when its centre is within SIGHT[type] of the unit's footprint, so sight
 * reaches the same number of squares out from every side. Terrain does not block sight yet.
 */
export function visibleSquares(units: readonly Unit[], map: Size): Set<number> {
  const seen = new Set<number>();
  for (const u of units) {
    if (!isAlive(u)) continue;
    const r = rectOf(u);
    const reach = SIGHT[u.type];
    // Only squares inside the footprint grown by the reach can be close enough; test just those.
    const grown = { x: Math.floor(r.x - reach), y: Math.floor(r.y - reach), w: r.w + 2 * Math.ceil(reach), h: r.h + 2 * Math.ceil(reach) };
    for (const i of squaresOfRect(grown, map)) {
      const x = i % map.w;
      const y = Math.floor(i / map.w);
      if (distanceToRect(x + 0.5, y + 0.5, r) <= reach) seen.add(i);
    }
  }
  return seen;
}

/** True when any square of the unit's footprint is in the visible set. */
export function unitSeen(unit: Pick<Unit, "type" | "x" | "y" | "upright">, visible: ReadonlySet<number>, map: Size): boolean {
  return squaresOfRect(rectOf(unit), map).some((i) => visible.has(i));
}

/**
 * Explored squares packed as a hex string: 4 squares per character, square i in character
 * floor(i / 4), bit i % 4 (least significant first). Short enough to live in the saved game.
 */
export function encodeExplored(set: ReadonlySet<number>, map: Size): string {
  const total = map.w * map.h;
  const nibbles = new Array<number>(Math.ceil(total / 4)).fill(0);
  for (const i of set) {
    if (i < 0 || i >= total || !Number.isInteger(i)) continue;
    const k = Math.floor(i / 4);
    nibbles[k] = (nibbles[k] as number) | (1 << i % 4);
  }
  return nibbles.map((n) => n.toString(16)).join("");
}

/**
 * The reverse of encodeExplored. A short, long or garbled string decodes to whatever bits it
 * does have, so a damaged save still loads instead of crashing.
 */
export function decodeExplored(text: string, map: Size): Set<number> {
  const total = map.w * map.h;
  const out = new Set<number>();
  const chars = typeof text === "string" ? text : "";
  for (let k = 0; k < chars.length && k * 4 < total; k++) {
    const n = parseInt(chars[k] as string, 16);
    if (Number.isNaN(n)) continue;
    for (let bit = 0; bit < 4; bit++) {
      const i = k * 4 + bit;
      if (i < total && (n & (1 << bit)) !== 0) out.add(i);
    }
  }
  return out;
}

/** An enemy unit as it stands right now, stamped with the turn it was seen on. */
export function seenNow(u: Unit, turn: number): SeenUnit {
  return { id: u.id, type: u.type, x: u.x, y: u.y, upright: u.upright, state: stateOf(u), hp: hpLeft(u), turn };
}

/**
 * The latest sighting of each enemy unit: every enemy inside the visible squares replaces its old
 * record (or is added); the rest keep whatever was last seen of them.
 */
export function noteSightings(
  previous: readonly SeenUnit[],
  enemies: readonly Unit[],
  visible: ReadonlySet<number>,
  map: Size,
  turn: number,
): SeenUnit[] {
  const fresh = enemies.filter((u) => unitSeen(u, visible, map)).map((u) => seenNow(u, turn));
  const ids = new Set(fresh.map((s) => s.id));
  return [...previous.filter((s) => !ids.has(s.id)), ...fresh];
}

/**
 * What the viewer learns from where their units stand right now: the squares in sight join their
 * explored set, and every enemy unit in sight is noted as last seen this turn. Returns a new game.
 */
export function lookAround(game: Game, viewer: PlayerIndex): Game {
  const g = structuredClone(game);
  const s = g.strategic;
  if (!s) return g;
  const map = mapOf(s.map);
  const visible = visibleSquares(g.players[viewer].units, map);
  const explored = decodeExplored(s.explored[viewer], map);
  for (const i of visible) explored.add(i);
  s.explored[viewer] = encodeExplored(explored, map);
  const enemy: PlayerIndex = viewer === 0 ? 1 : 0;
  s.lastSeen[viewer] = noteSightings(s.lastSeen[viewer], g.players[enemy].units, visible, map, g.turn);
  return g;
}
