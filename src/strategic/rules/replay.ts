import type { UnitType } from "../../rules/constants.ts";
import type { Game, PlayerIndex } from "../../rules/game.ts";
import { rectOf, sizeOf, type Unit } from "../../rules/units.ts";
import { DIRECTIONS, centreOf, footprintAt } from "./board.ts";
import { BASE_GRID, HP, hpLeft } from "./constants.ts";
import { unitSeen, visibleSquares } from "./fog.ts";
import { isBlocked, mapOf, squareIndex } from "./maps.ts";
import type { MapShot, Point, Replay, ReplayMark, ReplayStep, StrategicEvent, StrategicMap, StrategicState, StrategicView } from "./types.ts";
import { drawnUnit, revealView, shotForViewer, strategicView, turnNumber } from "./view.ts";

/**
 * Replays: the past rebuilt from the armies as they started and the events since. The handover
 * replay shows a player what their own units saw of the enemy's turn and of their own infantry's
 * start of turn; the match replay shows the whole game with the fog lifted for the results screen.
 * Everything here is pure data for the screens, and the handover replay passes every enemy unit,
 * track and shot through the same fog rules as the turn screen.
 */

/** Both armies at one moment: player 1's units and player 2's. */
export type Armies = [Unit[], Unit[]];

type Move = ReplayStep["moves"][number];

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

/** Tracks are sampled this often along the straight line, in squares, when cut to what the viewer saw. */
const TRACK_SAMPLE = 0.1;

/** A track cut down to less than this is not worth drawing. */
const MIN_TRACK = 0.3;

const findUnit = (units: readonly Unit[], id: string): Unit | undefined => units.find((u) => u.id === id);

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The middle of a unit's footprint if its top-left square were at `at`. */
function centreAt(u: Pick<Unit, "type" | "upright">, at: Point): Point {
  return centreOf(footprintAt(u, at.x, at.y));
}

/** The top-left corner a unit would have if its footprint's middle were at `centre` (fractional for a cut track). */
function topLeftAt(u: Pick<Unit, "type" | "upright">, centre: Point): Point {
  const { w, h } = sizeOf(u.type, u.upright);
  return { x: centre.x - w / 2, y: centre.y - h / 2 };
}

/** The game's shots by id, so a shot event can find what it did. */
const shotsById = (s: StrategicState): Map<number, MapShot> => new Map(s.shots.map((shot) => [shot.id, shot]));

/** Hurt a rebuilt unit by the damage an event recorded; hits never pass the unit's hit points, as in applyDamage. */
function hurt(units: Unit[], unitId: string, damage: number): void {
  const u = findUnit(units, unitId);
  if (u) u.hits = Math.min(HP[u.type], u.hits + damage);
}

/**
 * Plays one event onto rebuilt armies, in place: a move sets the mover and its riders down where they
 * went, a shot or a blow adds the damage it recorded, a spawn adds the new infantry. A fallen fort
 * changes nothing more (its damage came with the shot or blow before it).
 */
function applyEvent(armies: Armies, e: StrategicEvent, shots: ReadonlyMap<number, MapShot>): void {
  if (e.kind === "move") {
    for (const { unitId, to } of [e, ...(e.riderMoves ?? [])]) {
      const u = findUnit(armies[e.player], unitId);
      if (u) {
        u.x = to.x;
        u.y = to.y;
      }
    }
  } else if (e.kind === "shot") {
    for (const h of shots.get(e.shotId)?.hits ?? []) hurt(armies[h.owner], h.unitId, h.damage);
  } else if (e.kind === "melee") {
    hurt(armies[other(e.player)], e.targetId, e.damage);
  } else if (e.kind === "spawn") {
    armies[e.player].push({ id: e.unitId, type: "infantry", x: e.at.x, y: e.at.y, upright: false, hits: 0 });
  }
}

/** The highest shot id among the first `count` events (0 before any shot): shot ids rise with the events. */
function lastShotIn(events: readonly StrategicEvent[], count: number): number {
  let last = 0;
  for (const e of events.slice(0, count)) if (e.kind === "shot") last = Math.max(last, e.shotId);
  return last;
}

/**
 * Both armies after the first `eventCount` events (0 is the start, before turn 1's automatic phase).
 * Null for a game saved before the starting armies were recorded.
 */
export function armiesAt(game: Game, eventCount: number): Armies | null {
  const s = game.strategic;
  if (!s?.start) return null;
  const armies = structuredClone(s.start);
  const shots = shotsById(s);
  for (const e of s.events.slice(0, Math.max(0, eventCount))) applyEvent(armies, e, shots);
  return armies;
}

/** Where one unit went over the whole game. */
export interface UnitTrack {
  unitId: string;
  owner: PlayerIndex;
  type: UnitType;
  /** Footprint centres from where it started through each of its moves, in order. */
  points: Point[];
}

/**
 * Every unit that ever moved (riders included) and the footprint centres it passed through, from its
 * starting square (or the square it was sent out on) through each move. Player 1's units first, each
 * side in unit order. Empty for a game saved before the starting armies were recorded.
 */
export function unitTracks(game: Game): UnitTrack[] {
  const s = game.strategic;
  if (!s?.start) return [];
  const armies = structuredClone(s.start);
  const shots = shotsById(s);
  const tracks = new Map<string, UnitTrack>();
  const note = (owner: PlayerIndex, unitId: string, to: Point) => {
    const u = findUnit(armies[owner], unitId);
    if (!u) return;
    const k = `${owner}:${unitId}`;
    const track = tracks.get(k) ?? { unitId, owner, type: u.type, points: [centreAt(u, u)] };
    track.points.push(centreAt(u, to));
    tracks.set(k, track);
  };
  for (const e of s.events) {
    if (e.kind === "move") {
      note(e.player, e.unitId, e.to);
      for (const r of e.riderMoves ?? []) note(e.player, r.unitId, r.to);
    }
    applyEvent(armies, e, shots);
  }
  return ([0, 1] as PlayerIndex[]).flatMap((owner) =>
    armies[owner].map((u) => tracks.get(`${owner}:${u.id}`)).filter((t): t is UnitTrack => t !== undefined),
  );
}

// ---------------------------------------------------------------------------------------------
// The handover replay
// ---------------------------------------------------------------------------------------------

/**
 * True when a point lies in a square the viewer can see, counting a point on the line between two
 * squares as in both. The middle of a 2x2 footprint sits on such a corner, so this is true exactly
 * when the unit standing there is seen.
 */
export function pointInSight(p: Point, visible: ReadonlySet<number>, map: Pick<StrategicMap, "w" | "h">): boolean {
  const around = (v: number) => (Number.isInteger(v) ? [v - 1, v] : [Math.floor(v)]);
  return around(p.x).some((x) =>
    around(p.y).some((y) => x >= 0 && y >= 0 && x < map.w && y < map.h && visible.has(squareIndex(map, x, y))),
  );
}

/**
 * The part of a straight move the viewer saw: the line between the two footprint centres, sampled
 * every tenth of a square and cut to the longest stretch in sight that runs from the end the viewer
 * could see (the new place when both were). Null when that stretch is under 0.3 squares. Returns the
 * stretch's two ends, from old place toward new.
 */
export function clipTrack(
  from: Point,
  to: Point,
  anchor: "from" | "to",
  visible: ReadonlySet<number>,
  map: Pick<StrategicMap, "w" | "h">,
): [Point, Point] | null {
  const n = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / TRACK_SAMPLE - 1e-9));
  const samples = Array.from({ length: n + 1 }, (_, k) => ({ x: from.x + ((to.x - from.x) * k) / n, y: from.y + ((to.y - from.y) * k) / n }));
  if (anchor === "to") samples.reverse();
  let kept = 0;
  while (kept < samples.length && pointInSight(samples[kept] as Point, visible, map)) kept += 1;
  if (kept < 2) return null;
  const near = samples[0] as Point;
  const far = samples[kept - 1] as Point;
  if (Math.hypot(far.x - near.x, far.y - near.y) < MIN_TRACK - 1e-9) return null;
  return anchor === "to" ? [far, near] : [near, far];
}

/** "tank-2" reads "tank 2"; there is only one fort, so it is just "fort". */
const nameOf = (unitId: string, type: UnitType): string => (type === "fort" ? "fort" : unitId.replace("-", " "));

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The fort's hit points after a blow, the one number worth a line ("3 of 6 left"). Other units show
 * theirs on the map's badge, which keeps the list's lines short.
 */
function fortLeft(units: readonly Unit[], unitId: string): string {
  const fort = findUnit(units, unitId);
  return `${fort ? hpLeft(fort) : 0} of ${HP.fort} left`;
}

/** What a blow or a shot did to one of the viewer's units: "destroyed your tank 1", "hit your fort: 3 of 6 left". */
function hurtYour(hit: { unitId: string; type: UnitType; destroyed: boolean }, own: readonly Unit[]): string {
  const name = nameOf(hit.unitId, hit.type);
  // A wall breaks at the first blow; it is "hit", the way a wall stopping a shell is its job.
  if (hit.type === "wall") return `hit your ${name}`;
  if (hit.destroyed) return `destroyed your ${name}`;
  return hit.type === "fort" ? `hit your fort: ${fortLeft(own, hit.unitId)}` : `hit your ${name}`;
}

/** An enemy shot from the viewer's side, its hits already cut to the viewer's units (shotForViewer). */
function shotText(seen: MapShot, shooterSeen: boolean, own: readonly Unit[]): string {
  const hits = seen.hits;
  const [first] = hits;
  if (seen.weapon === "tank") return first ? `${shooterSeen ? "Enemy tank" : "A tank shot"} ${hurtYour(first, own)}` : "A tank shot landed near your units";
  if (!first) return "A shell landed near your units";
  if (seen.outcome === "wall") return hits.length === 1 ? `Your ${nameOf(first.unitId, first.type)} stopped a shell` : `${hits.length} of your walls stopped a shell`;
  if (hits.length === 1) return `A shell ${hurtYour(first, own)}`;
  return `A shell hit ${hits.length} of your units`;
}

/** What the viewer's infantry did to an enemy unit: "Infantry 3 destroyed an enemy tank". */
function ownMeleeText(e: Extract<StrategicEvent, { kind: "melee" }>, enemyAfter: readonly Unit[]): string {
  const who = capitalised(nameOf(e.unitId, "infantry"));
  const target = e.targetType === "fort" ? "the enemy fort" : `an enemy ${e.targetType}`;
  if (e.destroyed) return `${who} destroyed ${target}`;
  return e.targetType === "fort" ? `${who} hit ${target}: ${fortLeft(enemyAfter, e.targetId)}` : `${who} hit ${target}`;
}

/** One unit's move as the viewer saw it: its cut track (if long enough), its move for the slide, and the end in sight. */
interface SeenMove {
  track: [Point, Point] | null;
  move: Move;
  /** The middle of the footprint at the end the viewer could see, for the camera when the track was too short to draw. */
  seenAt: Point;
  verb: "moved" | "came out of the fog" | "went into the fog";
}

/**
 * How the viewer saw an enemy unit move, or null when it was out of sight at both its old and its
 * new place. The slide runs between the ends of the cut track, never from or to a square in the fog.
 */
function seeEnemyMove(u: Unit, owner: PlayerIndex, from: Point, to: Point, visible: ReadonlySet<number>, map: StrategicMap): SeenMove | null {
  const atFrom = unitSeen({ ...u, ...from }, visible, map);
  const atTo = unitSeen({ ...u, ...to }, visible, map);
  if (!atFrom && !atTo) return null;
  const a = centreAt(u, from);
  const b = centreAt(u, to);
  const seenAt = atTo ? b : a;
  const track = clipTrack(a, b, atTo ? "to" : "from", visible, map);
  const [start, end] = track ?? [seenAt, seenAt];
  const move = { unitId: u.id, owner, from: topLeftAt(u, start), to: topLeftAt(u, end) };
  return { track, move, seenAt, verb: !atFrom ? "came out of the fog" : !atTo ? "went into the fog" : "moved" };
}

/** One event as the viewer saw it, before it is folded into a step. */
interface Seen {
  part: "enemy" | "own";
  /** Events in the same group (consecutive infantry moves of one side) share a step. */
  group: "enemy-infantry" | "own-infantry" | null;
  marks: ReplayMark[];
  moves: Move[];
  /** Points for the camera when the step draws no marks. */
  spots: Point[];
  /** The step's shot as the viewer sees it. */
  shot: MapShot | null;
  fight: boolean;
  /** The line for the list, from the armies just after the event (hit points left). */
  text(after: Armies): string;
  /** The line when several events of this group share one step. */
  groupText?: (count: number) => string;
}

/** The fixed facts every judgement needs. */
interface Lens {
  viewer: PlayerIndex;
  map: StrategicMap;
  explored: ReadonlySet<number>;
  shots: ReadonlyMap<number, MapShot>;
  /** The viewer has found the enemy base (the turn screen shows it), so where the enemy fort stands is no secret. */
  baseKnown: boolean;
}

/** An enemy move (a tank, the truck and its riders, or an infantry's walk) as the viewer saw it. */
function seeEnemyMoveEvent(e: Extract<StrategicEvent, { kind: "move" }>, armies: Armies, visible: ReadonlySet<number>, lens: Lens): Seen | null {
  const enemy = e.player;
  const theirs = armies[enemy];
  const mover = findUnit(theirs, e.unitId);
  if (!mover) return null;
  const main = seeEnemyMove(mover, enemy, e.from, e.to, visible, lens.map);
  const riders = (e.riderMoves ?? [])
    .map((r) => {
      const rider = findUnit(theirs, r.unitId);
      return rider ? seeEnemyMove(rider, enemy, r.from, r.to, visible, lens.map) : null;
    })
    .filter((r): r is SeenMove => r !== null);
  const shown = [...(main ? [main] : []), ...riders];
  if (shown.length === 0) return null;
  const infantryWalk = e.type === "infantry" && e.riders.length === 0;
  const line = (): string => {
    if (main && riders.length > 0) return `Enemy ${e.type} moved with ${riders.length} infantry`;
    if (main) return `Enemy ${e.type} ${main.verb}`;
    return riders.length === 1 ? `Enemy infantry ${(riders[0] as SeenMove).verb}` : `Enemy infantry moved (${riders.length})`;
  };
  return {
    part: "enemy",
    group: infantryWalk ? "enemy-infantry" : null,
    marks: shown.flatMap((m) => (m.track ? [{ kind: "track" as const, owner: enemy, points: [...m.track] }] : [])),
    moves: shown.map((m) => m.move),
    spots: shown.map((m) => m.seenAt),
    shot: null,
    fight: false,
    text: line,
    groupText: (count) => `Enemy infantry moved (${count})`,
  };
}

/** An enemy shot, shown when it hurt the viewer or fell on ground they know (exactly the turn screen's rule). */
function seeEnemyShot(e: Extract<StrategicEvent, { kind: "shot" }>, armies: Armies, visible: ReadonlySet<number>, lens: Lens): Seen | null {
  const shot = lens.shots.get(e.shotId);
  const seen = shot && shotForViewer(shot, lens.viewer, lens.explored, lens.map);
  if (!shot || !seen) return null;
  const shooter = findUnit(armies[shot.by], shot.unitId);
  const shooterSeen = shooter !== undefined && unitSeen(shooter, visible, lens.map);
  const from = shooter && shooterSeen ? centreOf(rectOf(shooter)) : null;
  return {
    part: "enemy",
    group: null,
    marks: [{ kind: "shot", shotId: shot.id, weapon: shot.weapon, x: shot.x, y: shot.y, from }],
    moves: [],
    spots: [],
    shot: seen,
    fight: false,
    text: (after) => shotText(seen, shooterSeen, after[lens.viewer]),
  };
}

/**
 * An enemy infantry's blow on one of the viewer's units: always shown, since the viewer's unit felt
 * it. The clash is drawn midway when the attacker was in sight, else on the viewer's unit, so an
 * attacker in the fog stays hidden.
 */
function seeEnemyMelee(e: Extract<StrategicEvent, { kind: "melee" }>, armies: Armies, visible: ReadonlySet<number>, lens: Lens): Seen | null {
  const target = findUnit(armies[lens.viewer], e.targetId);
  if (!target) return null;
  const attacker = findUnit(armies[e.player], e.unitId);
  const hurtAt = centreOf(rectOf(target));
  const at = attacker && unitSeen(attacker, visible, lens.map) ? midpoint(centreOf(rectOf(attacker)), hurtAt) : hurtAt;
  return {
    part: "enemy",
    group: null,
    marks: [{ kind: "clash", at }],
    moves: [],
    spots: [],
    shot: null,
    fight: false,
    text: (after) => `Enemy infantry ${hurtYour({ unitId: e.targetId, type: e.targetType, destroyed: e.destroyed }, after[lens.viewer])}`,
  };
}

/**
 * The square a newcomer seems to have walked in from when the fort that sent it out is hidden: of
 * the open squares around it that the viewer cannot see, the one furthest from the middle of the map
 * (deeper in the enemy's side, where enemy infantry come from; the first in DIRECTIONS order on a
 * tie). Chosen from what the viewer knows only, so it says nothing about where the fort is. Null when
 * every square around is in sight or terrain, which cannot happen while the fort touching it is
 * hidden.
 */
export function fogSquareBeside(at: Point, visible: ReadonlySet<number>, map: StrategicMap): Point | null {
  const middle = { x: map.w / 2, y: map.h / 2 };
  let best: Point | null = null;
  let bestD = -1;
  for (const d of DIRECTIONS) {
    const p = { x: at.x + d.x, y: at.y + d.y };
    if (p.x < 0 || p.y < 0 || p.x >= map.w || p.y >= map.h) continue;
    if (isBlocked(map, p.x, p.y) || visible.has(squareIndex(map, p.x, p.y))) continue;
    const dist = Math.hypot(p.x + 0.5 - middle.x, p.y + 0.5 - middle.y);
    if (dist > bestD) {
      best = p;
      bestD = dist;
    }
  }
  return best;
}

/**
 * A new enemy infantry on a square the viewer could see. With the fort that sent it out in sight,
 * or already found, it is shown as what it is: "The enemy fort sent out infantry". Otherwise saying
 * so would tell the viewer the hidden fort touches that square, and so would the newcomer simply
 * popping up with no step (every other way onto a watched square has one). So it reads exactly as
 * that infantry walking in from a square in the fog beside it would (fogSquareBeside): "Enemy
 * infantry came out of the fog", with the same short track and slide.
 */
function seeEnemySpawn(e: Extract<StrategicEvent, { kind: "spawn" }>, armies: Armies, visible: ReadonlySet<number>, lens: Lens): Seen | null {
  if (!visible.has(squareIndex(lens.map, e.at.x, e.at.y))) return null;
  const fort = armies[e.player].find((u) => u.type === "fort");
  if (!lens.baseKnown && !(fort && unitSeen(fort, visible, lens.map))) {
    const from = fogSquareBeside(e.at, visible, lens.map);
    if (!from) return null;
    // Judged by the very code a real walk goes through, with the newcomer standing there beforehand.
    const newcomer: Unit = { id: e.unitId, type: "infantry", x: from.x, y: from.y, upright: false, hits: 0 };
    const withNewcomer: Armies = [...armies];
    withNewcomer[e.player] = [...armies[e.player], newcomer];
    const walk: Extract<StrategicEvent, { kind: "move" }> = { kind: "move", turn: e.turn, player: e.player, unitId: e.unitId, type: "infantry", from, to: { ...e.at }, riders: [] };
    return seeEnemyMoveEvent(walk, withNewcomer, visible, lens);
  }
  return {
    part: "enemy",
    group: null,
    marks: [{ kind: "spawn", at: { x: e.at.x + 0.5, y: e.at.y + 0.5 } }],
    moves: [],
    spots: [],
    shot: null,
    fight: false,
    text: () => "The enemy fort sent out infantry",
  };
}

/** The viewer's own start of turn: their infantry marching and fighting and the fort's new infantry, all shown. */
function seeOwnEvent(e: StrategicEvent, armies: Armies, lens: Lens): Seen | null {
  const viewer = lens.viewer;
  const base = { part: "own" as const, group: null, marks: [] as ReplayMark[], moves: [] as Move[], spots: [] as Point[], shot: null, fight: false };
  if (e.kind === "move") {
    const u = findUnit(armies[viewer], e.unitId);
    if (!u) return null;
    const points = [centreAt(u, e.from), centreAt(u, e.to)];
    const marching = e.type === "infantry";
    return {
      ...base,
      group: marching ? "own-infantry" : null,
      marks: [{ kind: "track", owner: viewer, points }],
      moves: [{ unitId: u.id, owner: viewer, from: { ...e.from }, to: { ...e.to } }],
      text: () => (marching ? "Your infantry marched" : `Your ${e.type} moved`),
      groupText: (count) => `Your infantry marched (${count})`,
    };
  }
  if (e.kind === "melee") {
    const attacker = findUnit(armies[viewer], e.unitId);
    const target = findUnit(armies[other(viewer)], e.targetId);
    if (!attacker || !target) return null;
    const at = midpoint(centreOf(rectOf(attacker)), centreOf(rectOf(target)));
    return { ...base, fight: true, marks: [{ kind: "clash", at }], text: (after) => ownMeleeText(e, after[other(viewer)]) };
  }
  if (e.kind === "spawn") {
    return { ...base, marks: [{ kind: "spawn", at: { x: e.at.x + 0.5, y: e.at.y + 0.5 } }], text: () => `Your fort sent out ${nameOf(e.unitId, "infantry")}` };
  }
  return null;
}

/** One event of the replay's window as the viewer saw it, judged with the armies just before it; null when they saw nothing. */
function judge(e: StrategicEvent, armies: Armies, lens: Lens, game: Game): Seen | null {
  const viewer = lens.viewer;
  if (e.player === viewer && e.turn === game.turn) return seeOwnEvent(e, armies, lens);
  if (e.player !== other(viewer) || e.turn !== game.turn - 1) return null;
  const visible = visibleSquares(armies[viewer], lens.map);
  if (e.kind === "move") return seeEnemyMoveEvent(e, armies, visible, lens);
  if (e.kind === "shot") return seeEnemyShot(e, armies, visible, lens);
  if (e.kind === "melee") return seeEnemyMelee(e, armies, visible, lens);
  if (e.kind === "spawn") return seeEnemySpawn(e, armies, visible, lens);
  return null;
}

/** The middle of the box around a step's marks (a shot counts by its landing point), else of its fallback spots. */
function focusOf(marks: readonly ReplayMark[], spots: readonly Point[], fallback: Point): Point {
  const points = marks.flatMap((m) => (m.kind === "track" ? m.points : m.kind === "shot" ? [{ x: m.x, y: m.y }] : [m.at]));
  const all = points.length > 0 ? points : spots;
  if (all.length === 0) return fallback;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/**
 * The map at one moment of a handover replay, as the viewer may see it: their own units as rebuilt,
 * only the enemy units in sight at that moment (no last-seen marks), what is in sight then, and the
 * live turn screen's explored ground, enemy base and shots up to the last shot played so far.
 */
function replayFrame(live: StrategicView, armies: Armies, lastShotId: number, lastShot: MapShot | null): StrategicView {
  const { viewer, map } = live;
  const enemy = other(viewer);
  const visible = visibleSquares(armies[viewer], map);
  return {
    map,
    viewer,
    base: live.base,
    enemyBase: live.enemyBase,
    units: armies[viewer].map((u) => drawnUnit(u, viewer)),
    enemies: armies[enemy].filter((u) => unitSeen(u, visible, map)).map((u) => drawnUnit(u, enemy)),
    explored: new Set(live.explored),
    visible,
    shots: live.shots.filter((shot) => shot.id <= lastShotId),
    lastShot,
    orders: [],
    report: [],
    exploredPercent: live.exploredPercent,
    turnNumber: live.turnNumber,
    over: false,
    winner: null,
  };
}

/** A step being gathered: one shown event, or a run of grouped ones. */
interface Pending {
  seen: Seen;
  texts: string[];
  marks: ReplayMark[];
  moves: Move[];
  spots: Point[];
  frame: StrategicView;
}

function finishStep(p: Pending, fallback: Point): ReplayStep {
  const { seen } = p;
  const text = p.texts.length > 1 && seen.groupText ? seen.groupText(p.texts.length) : (p.texts[0] as string);
  return { part: seen.part, text, focus: focusOf(p.marks, p.spots, fallback), frame: p.frame, marks: p.marks, moves: p.moves };
}

/**
 * What the viewer missed since their last turn, as far as their own units could see it: the enemy's
 * last turn (moves in sight, shots that hurt them or fell on ground they know, blows on their units,
 * new infantry in sight, as sent out by a fort they can see or have found, else as walking in out of
 * the fog), then their own automatic start of turn. Each event is judged with the armies as they
 * stood just before it, so a unit destroyed part way through stops seeing from then on. Closed (no
 * steps) for an old save without starting armies,
 * outside a turn, when it is not the viewer's turn, or once the viewer has given an order. `open`
 * says whether it is worth showing: the enemy did something the viewer saw, or the viewer's infantry
 * fought (marching and new infantry alone happen every turn and never open it).
 */
export function replayFor(game: Game, viewer: PlayerIndex = game.current): Replay {
  const s = game.strategic;
  if (!s) throw new Error("Strategic game has not been set up yet");
  const live = strategicView(game, viewer);
  const liveArmies: Armies = [game.players[0].units, game.players[1].units];
  const closed = (): Replay => ({ before: replayFrame(live, liveArmies, Infinity, null), steps: [], open: false });
  if (!s.start || game.phase !== "turn" || game.current !== viewer || Object.keys(s.orders).length > 0) return closed();
  const first = s.events.findIndex((e) => e.turn >= game.turn - 1);
  const armies = first < 0 ? null : armiesAt(game, first);
  if (!armies) return closed();
  const lens: Lens = { viewer, map: live.map, explored: live.explored, shots: shotsById(s), baseKnown: live.enemyBase !== null };
  const fallback = centreOf({ ...live.base, ...BASE_GRID });
  let lastShotId = lastShotIn(s.events, first);
  let before: StrategicView | null = null;
  let pending: Pending | null = null;
  let fought = false;
  const steps: ReplayStep[] = [];
  for (const e of s.events.slice(first)) {
    const seen = judge(e, armies, lens, game);
    if (seen && !before) before = replayFrame(live, armies, lastShotId, null);
    applyEvent(armies, e, lens.shots);
    if (e.kind === "shot") lastShotId = Math.max(lastShotId, e.shotId);
    if (!seen) continue;
    const frame = replayFrame(live, armies, lastShotId, seen.shot);
    const text = seen.text(armies);
    if (pending && seen.group !== null && pending.seen.group === seen.group) {
      pending.texts.push(text);
      pending.marks.push(...seen.marks);
      pending.moves.push(...seen.moves);
      pending.spots.push(...seen.spots);
      pending.frame = frame;
    } else {
      if (pending) steps.push(finishStep(pending, fallback));
      pending = { seen, texts: [text], marks: [...seen.marks], moves: [...seen.moves], spots: [...seen.spots], frame };
    }
    fought ||= seen.fight;
  }
  if (pending) steps.push(finishStep(pending, fallback));
  const open = fought || steps.some((st) => st.part === "enemy");
  return { before: before ?? replayFrame(live, armies, lastShotId, null), steps, open };
}

// ---------------------------------------------------------------------------------------------
// The match replay
// ---------------------------------------------------------------------------------------------

/**
 * The whole map at the end of one Game.turn with the fog lifted, seen from player 1's side like the
 * results screen (revealView): both armies, every square explored, every shot so far with what it
 * really did.
 */
function matchFrame(game: Game, s: StrategicState, armies: Armies, turn: number, lastShotId: number, over: boolean): StrategicView {
  const map = mapOf(s.map);
  return {
    map,
    viewer: 0,
    base: s.bases[0],
    enemyBase: s.bases[1],
    units: armies[0].map((u) => drawnUnit(u, 0)),
    enemies: armies[1].map((u) => drawnUnit(u, 1)),
    explored: new Set(Array.from({ length: map.w * map.h }, (_, i) => i)),
    visible: new Set(),
    shots: s.shots.filter((shot) => shot.id <= lastShotId).map((shot) => ({ ...shot, revealed: true })),
    lastShot: null,
    orders: [],
    report: [],
    exploredPercent: 100,
    turnNumber: turnNumber({ turn, firstShooter: game.firstShooter }, 0),
    over,
    winner: over ? game.winner : null,
  };
}

/** Who played a Game.turn: player 1 always goes first, so odd turns are the first shooter's. */
const playerOfTurn = (game: Pick<Game, "firstShooter">, turn: number): PlayerIndex => (turn % 2 === 1 ? game.firstShooter : other(game.firstShooter));

/** Marks and moves for one event of a match replay, nothing hidden: full tracks, and shots with a line from the shooter. */
function matchMarks(e: StrategicEvent, armies: Armies, shots: ReadonlyMap<number, MapShot>): { marks: ReplayMark[]; moves: Move[] } {
  if (e.kind === "move") {
    const parts = [{ unitId: e.unitId, from: e.from, to: e.to }, ...(e.riderMoves ?? [])];
    const out = { marks: [] as ReplayMark[], moves: [] as Move[] };
    for (const part of parts) {
      const u = findUnit(armies[e.player], part.unitId);
      if (!u) continue;
      out.marks.push({ kind: "track", owner: e.player, points: [centreAt(u, part.from), centreAt(u, part.to)] });
      out.moves.push({ unitId: part.unitId, owner: e.player, from: { ...part.from }, to: { ...part.to } });
    }
    return out;
  }
  const shot = e.kind === "shot" ? shots.get(e.shotId) : undefined;
  if (!shot) return { marks: [], moves: [] };
  const shooter = findUnit(armies[shot.by], shot.unitId);
  const from = shooter ? centreOf(rectOf(shooter)) : null;
  return { marks: [{ kind: "shot", shotId: shot.id, weapon: shot.weapon, x: shot.x, y: shot.y, from }], moves: [] };
}

/**
 * The whole match for the results screen, turn by turn with the fog lifted: one step per Game.turn,
 * each showing every move (full tracks) and every shot of that turn and the map after it. Over is
 * set only on the last step. Empty for a game saved before the starting armies were recorded.
 */
export function matchReplay(game: Game): Replay {
  const s = game.strategic;
  if (!s) throw new Error("Strategic game has not been set up yet");
  if (!s.start) return { before: revealView(game), steps: [], open: false };
  const map = mapOf(s.map);
  const armies = structuredClone(s.start);
  const shots = shotsById(s);
  // On the handoff screen the turn counter has already moved on to a turn nobody has played yet.
  const last = game.phase === "handoff" ? game.turn - 1 : game.turn;
  const before = matchFrame(game, s, armies, 1, 0, false);
  const steps: ReplayStep[] = [];
  let next = 0;
  let lastShotId = 0;
  for (let turn = 1; turn <= last; turn++) {
    const marks: ReplayMark[] = [];
    const moves: Move[] = [];
    for (; next < s.events.length && (s.events[next] as StrategicEvent).turn <= turn; next++) {
      const e = s.events[next] as StrategicEvent;
      const seen = matchMarks(e, armies, shots);
      marks.push(...seen.marks);
      moves.push(...seen.moves);
      applyEvent(armies, e, shots);
      if (e.kind === "shot") lastShotId = Math.max(lastShotId, e.shotId);
    }
    const player = playerOfTurn(game, turn);
    const over = turn === last && game.phase === "over";
    steps.push({
      part: "turn",
      text: `Turn ${turnNumber({ turn, firstShooter: game.firstShooter }, player)} · ${game.players[player].name}`,
      focus: focusOf(marks, [], { x: map.w / 2, y: map.h / 2 }),
      frame: matchFrame(game, s, armies, turn, lastShotId, over),
      marks,
      moves,
      turn,
      player,
    });
  }
  return { before, steps, open: steps.length > 0 };
}
