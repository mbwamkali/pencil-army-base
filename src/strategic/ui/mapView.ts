import { SHOT_RADIUS } from "../../rules/constants.ts";
import type { PlayerIndex } from "../../rules/game.ts";
import { sizeOf, type Rect } from "../../rules/units.ts";
import { SHIELD_PATH, drawShotImage, drawUnit } from "../../ui/board.ts";
import { el, sv } from "../../ui/dom.ts";
import { SHAKE_RADIUS } from "../rules/constants.ts";
import type { DrawnUnit, MapShot, Point, ReplayMark, StrategicMap, StrategicView } from "../rules/types.ts";
import {
  BASE_SIZE,
  SCALE_MAX,
  SQ_NEAR,
  ZOOM_STEP,
  baseCamera,
  centreCamera,
  clampCamera,
  easeInOut,
  fitCamera,
  inViewport,
  isWholeCamera,
  lerpCamera,
  panCamera,
  pinchCamera,
  toMap,
  viewBoxOf,
  viewportRect,
  zoomAbout,
  type Camera,
  type Pinch,
} from "./camera.ts";
import { INK, drawTerrain, terrainSquares, treeSymbol } from "./terrainArt.ts";

export * from "./camera.ts";

/**
 * The Strategic map: one SVG whose viewBox follows the camera, plus an HTML mini-map over its
 * bottom-left corner. Everything is drawn once from a StrategicView; panning and zooming only move
 * the viewBox and the mini-map's viewport rectangle, so a big map stays smooth on a phone. The turn
 * screen draws its selection, reach and aim marks into `overlay`, which it clears and refills as the
 * player taps, without touching the rest. The handover replay draws its tracks, shots and fights
 * there too, slides the units that moved and pans to where each step happened.
 *
 * World units are map squares times SQ_NEAR, so unit art and stroke widths look right at scale 1.
 */

export interface MapViewOptions {
  view: StrategicView;
  /** Viewport size in stage px (744 x 412 in the turn screen). */
  width: number;
  height: number;
  /** Where to start (clamped here, so it may be anything). */
  camera: Camera;
  /** Called after every camera change (pan, zoom, mini-map tap, setCamera) so the app can remember it. */
  onCamera?: (c: Camera) => void;
  /**
   * A tap (pointer down and up moving less than 10 px, not a pinch) in fractional map squares.
   * Return true when the tap did something (picked a unit, moved it, set an aim, fired): such a
   * tap never starts a double tap, so two quick taps on an aim fire the shell instead of zooming.
   */
  onTap?: (p: Point) => boolean | void;
  /** The mini-map in the corner; on by default. The results screen, which shows the whole map anyway, turns it off. */
  minimap?: boolean;
  /** The players' names, by player index. When given (the results screen) bases and halves are labelled by name instead of "Your" and "Enemy". */
  names?: [string, string];
  /**
   * Where units went (the results screen): dotted lines through footprint centres in map squares,
   * drawn between the shot marks and the units, ink for the viewer's side and red for the other.
   */
  tracks?: readonly { owner: PlayerIndex; points: readonly Point[] }[];
  /**
   * Stage px along the view's bottom edge that something drawn over the map covers (the replay's
   * controls pill). The whole-map fit and every pan and zoom limit keep the map's last row reachable
   * above it. 0 by default.
   */
  bottomInset?: number;
}

/** A shot as a replay marks it: where it landed and, when the viewer could see the shooter, where it came from. */
export type ShotMark = Pick<Extract<ReplayMark, { kind: "shot" }>, "shotId" | "weapon" | "x" | "y" | "from">;

export interface MapView {
  /** Positioned box of width x height; holds the svg and the mini-map. */
  root: HTMLElement;
  /** data-testid="strategic-map" */
  svg: SVGSVGElement;
  /**
   * Temporary marks in world units (map squares times SQ_NEAR), above the units and below the
   * mini-map. Nothing in it catches pointer events, so taps still reach the svg's handler.
   */
  overlay: SVGGElement;
  camera(): Camera;
  /** Clamps, then updates the viewBox (no rebuild). */
  setCamera(c: Camera): void;
  /** Whole map in view. */
  fitWhole(): void;
  /** SQ_NEAR px per square, centred on the viewer's base. */
  focusBase(): void;
  /** True when the camera is at (or within 1% of) the whole-map fit. */
  isWhole(): boolean;
  /** Pans to a map point at the current scale (clamped); onCamera fires. */
  centreOn(p: Point): void;
  /** Fills whole squares (top-left corners) in the overlay: the squares a unit can reach, say. */
  markSquares(points: readonly Point[], cls: string): SVGPathElement;
  /**
   * A dashed rounded outline `pad` squares outside a footprint, in the overlay. The corners are
   * rounded by `pad`, so with pad = ARTILLERY_MIN_RANGE it traces exactly the "too close" line.
   */
  markRect(rect: Rect, cls: string, pad?: number): SVGRectElement;
  /** An artillery aim in the overlay: a crosshair, a solid ring where the shell hits and a dashed ring of how far it may drift. */
  /** Draws the aim cross with the shake circle (`shake` squares, the minimum by default). */
  markAim(p: Point, shake?: number): SVGGElement;
  clearOverlay(): void;
  /** The unit whose footprint holds a map point: the viewer's living units first, then enemies in sight. */
  unitAt(p: Point): DrawnUnit | null;
  /**
   * A replay track in the overlay: a dotted line through map points with a small arrowhead at its
   * end, ink for the viewer's own units and red for the enemy's. It stops at the edge of the unit
   * standing at its end, so the arrow points at the unit instead of hiding on its drawing.
   */
  markTrack(points: readonly Point[], owner: PlayerIndex): SVGGElement;
  /** A replay shot in the overlay: a ring where it landed and, when the shooter was in sight, a thin line from it. */
  markShot(mark: ShotMark): SVGGElement;
  /** A fight in the overlay: a small star of four short strokes. */
  markClash(at: Point): SVGGElement;
  /** A new infantry in the overlay: a small ring around its square. */
  markSpawn(at: Point): SVGCircleElement;
  /**
   * Slides a drawn living unit (own or enemy) from `from` to where it is drawn, `to` (top-left
   * squares), over `ms`. Does nothing when the unit is not drawn or ms is 0.
   */
  slideUnit(unitId: string, owner: PlayerIndex, from: Point, to: Point, ms: number): void;
  /** Whether a map point lies in the middle of the view, `margin` of the view kept clear on each side. */
  inView(p: Point, margin?: number): boolean;
  /** Pans to a map point at the current scale, eased over `ms` (0: at once), clamped; a finger on the map stops it. */
  panTo(p: Point, ms: number): void;
}

/** Pencil look: the same tones as style.css, set as attributes so the map looks right before any CSS lands. */
const PAPER = "#faf9f4";
const UNEXPLORED = "#ece6d6";
const HATCH = "#d8d0bd";
const GRID = "#b9cadb";
const BLUE = "#2f5fa7";
const RED = "#b23a2e";
const INK_SOFT = "#6b6d70";
/** What shows past the map's edge when the whole map letterboxes: the desk under the paper. */
const DESK = "#e6e2d8";

/**
 * Default colours for the turn screen's overlay marks, keyed by class, so the marks read right
 * before any CSS lands. style.css may override any of them: a stylesheet beats an attribute.
 */
const MARK_STROKE: Record<string, string> = {
  "strategic-target": RED,
  "strategic-minrange": RED,
  "strategic-selected": BLUE,
};
const MARK_FILL: Record<string, string> = {
  "strategic-reach": "rgba(47, 95, 167, 0.18)",
};

/** A replay track's arrowhead: arm length and half-angle, in world units and radians. */
const ARROW_LEN = 11;
const ARROW_SPREAD = 0.5;
/** How far outside the unit at its end a replay track stops, in squares, so the arrow tip just touches the drawing's box. */
const TRACK_GAP = 0.05;

/** A press that moves less than this many screen pixels and lifts within TAP_MS is a tap, not a pan. */
const TAP_SLOP = 10;
const TAP_MS = 300;
/** Two taps this close together (time and stage px) zoom in a step. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;
/** Mini-map box: as wide as it can be within these limits while keeping the map's aspect. */
const MINI_MAX = { w: 128, h: 72 };
/** How faint an enemy drawn where it was last seen is, next to one in sight now. */
const LAST_SEEN_OPACITY = 0.45;
/** A blind shell's mark: the shooter knows where it landed, not what it did, so the mark is lighter. */
const UNKNOWN_OPACITY = 0.7;

let viewCount = 0;

/**
 * The last tap that did nothing, for double-tap zoom. It lives outside the view because the turn
 * screen rebuilds the whole map view after most taps, and a double tap must survive that rebuild.
 * Only one map view is ever live, so the memory is shared safely.
 */
let lastTap: { t: number; p: Point } | null = null;

/** One path of filled squares (as `unit`-sized rects, neighbours along a row merged) for a set of square indexes. */
export function squaresPath(squares: Iterable<number>, w: number, unit: number): string {
  const sorted = [...squares].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let k = 0; k < sorted.length; k++) {
    const start = sorted[k]!;
    let end = start;
    while (k + 1 < sorted.length && sorted[k + 1] === end + 1 && (end + 1) % w !== 0) end = sorted[++k]!;
    const n = end - start + 1;
    parts.push(`M${(start % w) * unit} ${Math.floor(start / w) * unit}h${n * unit}v${unit}h${-n * unit}z`);
  }
  return parts.join("");
}

/** A drawn unit's footprint in map squares. */
export function footprintOf(u: Pick<DrawnUnit, "type" | "x" | "y" | "upright">): Rect {
  const { w, h } = sizeOf(u.type, u.upright);
  return { x: u.x, y: u.y, w, h };
}

/** Whether a unit's footprint holds a map point. */
function holds(u: Pick<DrawnUnit, "type" | "x" | "y" | "upright">, p: Point): boolean {
  const r = footprintOf(u);
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

/** The unit under a map point: the viewer's living units first, then enemies in sight, by footprint. */
export function unitAtPoint(view: Pick<StrategicView, "units" | "enemies">, p: Point): DrawnUnit | null {
  const sq = { x: Math.floor(p.x), y: Math.floor(p.y) };
  return (
    view.units.find((u) => u.state !== "destroyed" && holds(u, sq)) ??
    view.enemies.find((u) => u.current && u.state !== "destroyed" && holds(u, sq)) ??
    null
  );
}

/** A polyline through map points as an SVG path in world units. */
export function trackPath(points: readonly Point[], unit: number): string {
  return points.map((p, k) => `${k === 0 ? "M" : "L"}${round2(p.x * unit)} ${round2(p.y * unit)}`).join("");
}

/**
 * The polyline cut where it last enters `rect` (grown by `pad`) on its way to the end, which lies
 * inside it: the track then stops at the edge of the unit standing at its end. Unchanged when the end
 * is outside the rect; null when the whole line lies inside it (a short move of a big unit).
 */
export function trimTrack(points: readonly Point[], rect: Rect, pad: number): Point[] | null {
  const r = { x0: rect.x - pad, y0: rect.y - pad, x1: rect.x + rect.w + pad, y1: rect.y + rect.h + pad };
  const inside = (p: Point): boolean => p.x > r.x0 && p.x < r.x1 && p.y > r.y0 && p.y < r.y1;
  const end = points[points.length - 1];
  if (!end || !inside(end)) return [...points];
  for (let k = points.length - 2; k >= 0; k--) {
    const a = points[k]!;
    if (inside(a)) continue;
    // The segment a -> b crosses into the rect: the latest entry time over both axes is where it gets in.
    const b = points[k + 1]!;
    const enter = (p0: number, p1: number, lo: number, hi: number): number => {
      if (p0 === p1) return 0;
      return Math.min((lo - p0) / (p1 - p0), (hi - p0) / (p1 - p0));
    };
    const t = Math.max(0, Math.min(1, Math.max(enter(a.x, b.x, r.x0, r.x1), enter(a.y, b.y, r.y0, r.y1))));
    return [...points.slice(0, k + 1), { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }];
  }
  return null;
}

/**
 * For a track that lies wholly inside the unit at its end: a tiny stretch ending on the edge of the
 * rect (grown by `pad`), on the line from the track's first point to its last, so an arrowhead there
 * points at the unit from the side it came from. Null when the track has no length.
 */
export function edgeArrow(points: readonly Point[], rect: Rect, pad: number): [Point, Point] | null {
  const start = points[0];
  const end = points[points.length - 1];
  if (!start || !end) return null;
  const d = Math.hypot(end.x - start.x, end.y - start.y);
  if (d < 1e-9) return null;
  const ux = (end.x - start.x) / d;
  const uy = (end.y - start.y) / d;
  // Walking back from the end along the track, how far until each pair of sides is crossed.
  const back = (e: number, u: number, lo: number, hi: number): number => (u > 0 ? (e - lo) / u : u < 0 ? (e - hi) / u : Infinity);
  const t = Math.min(back(end.x, ux, rect.x - pad, rect.x + rect.w + pad), back(end.y, uy, rect.y - pad, rect.y + rect.h + pad));
  const tip = { x: end.x - t * ux, y: end.y - t * uy };
  return [{ x: tip.x - 0.1 * ux, y: tip.y - 0.1 * uy }, tip];
}

/** An open arrowhead (two short strokes) at the end of a polyline in world units, pointing along its last stretch. */
export function arrowHeadPath(points: readonly Point[], len = ARROW_LEN, spread = ARROW_SPREAD): string {
  const tip = points[points.length - 1];
  if (!tip) return "";
  // The last point far enough back to give a direction: a sampled track may end in tiny steps.
  let k = points.length - 2;
  while (k > 0 && Math.hypot(tip.x - points[k]!.x, tip.y - points[k]!.y) < 1e-6) k--;
  const from = points[k];
  if (!from || (from.x === tip.x && from.y === tip.y)) return "";
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const arm = (a: number): string => `${round2(tip.x - len * Math.cos(a))} ${round2(tip.y - len * Math.sin(a))}`;
  return `M${arm(angle - spread)}L${round2(tip.x)} ${round2(tip.y)}L${arm(angle + spread)}`;
}

/** Two decimals are plenty in world units, and keep the paths short. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function createMapView(opts: MapViewOptions): MapView {
  const { view, width, height } = opts;
  const map = view.map;
  const S = SQ_NEAR;
  const W = map.w * S;
  const H = map.h * S;
  const uid = `strategic-${++viewCount}`;
  const ids = { hatch: `${uid}-hatch`, clip: `${uid}-explored`, tree: `${uid}-tree`, miniClip: `${uid}-mini-explored` };
  const who = labelsFor(view, opts.names);
  const inset = opts.bottomInset ?? 0;
  let cam = clampCamera(opts.camera, map, width, height, inset);

  const explored = squaresPath(view.explored, map.w, S);
  const { marks, stamps } = shotLayers(view, S);
  const overlay = sv("g", { class: "strategic-overlay", "pointer-events": "none", style: "pointer-events:none" });
  const svg = sv("svg", {
    class: "strategic-svg",
    "data-testid": "strategic-map",
    width,
    height,
    viewBox: viewBoxOf(cam, width, height),
    style: "display:block;touch-action:none",
  });
  svg.append(
    sv(
      "defs",
      {},
      sv(
        "pattern",
        { id: ids.hatch, patternUnits: "userSpaceOnUse", width: 11, height: 11, patternTransform: "rotate(45)" },
        sv("path", { d: "M0 5.5H11", stroke: HATCH, "stroke-width": 1.4, class: "strategic-hatch" }),
      ),
      sv("clipPath", { id: ids.clip }, sv("path", { d: explored })),
      treeSymbol(ids.tree),
    ),
    // 0. the desk, seen past the map's edge when the whole map letterboxes.
    sv("rect", { x: -W, y: -H, width: 3 * W, height: 3 * H, fill: DESK, class: "strategic-desk" }),
    // 1. unexplored paper: darker, hatched.
    sv("rect", { width: W, height: H, fill: UNEXPLORED, class: "strategic-fog" }),
    sv("rect", { width: W, height: H, fill: `url(#${ids.hatch})`, class: "strategic-fog-hatch" }),
    // 2. explored paper, with the grid and terrain clipped to it.
    sv("path", { d: explored, fill: PAPER, class: "strategic-paper" }),
    sv(
      "g",
      { "clip-path": `url(#${ids.clip})`, class: "strategic-explored" },
      sv("path", { d: gridPath(map.w, map.h, S), stroke: GRID, "stroke-width": 1, fill: "none", class: "strategic-grid" }),
      terrainGroup(map, ids.tree),
    ),
    // what the viewer's units can see right now: a faint wash.
    sv("path", { d: squaresPath(view.visible, map.w, S), fill: BLUE, "fill-opacity": 0.06, class: "strategic-visible" }),
    // 3. the centre line, visible even in fog.
    sv("path", {
      d: `M${W / 2} 0V${H}`,
      stroke: INK,
      "stroke-width": 1.6,
      "stroke-dasharray": "0.1 7",
      "stroke-linecap": "round",
      opacity: 0.7,
      fill: "none",
      class: "strategic-centre",
    }),
    halfLabels(view, W, who),
    sv("rect", { width: W, height: H, fill: "none", stroke: INK, "stroke-width": 2, class: "strategic-frame" }),
    // 5. the viewer's own base, and the enemy's once its fort has been seen.
    sv(
      "g",
      { class: "strategic-bases" },
      baseGroup(view.base, S, `${who.own} base`, INK, "strategic-base"),
      view.enemyBase && baseGroup(view.enemyBase, S, `${who.enemy} base`, RED, "strategic-enemy-base"),
    ),
    // 6. shot marks under the units (a smudge never hides a crossed-off unit), then the armies,
    // then shields and hit point badges, which must stay readable over any unit.
    marks,
    tracksGroup(view, opts.tracks ?? [], S),
    unitsGroup(view, S),
    stamps,
    badgesGroup(view, S),
    overlay,
  );

  // 7. the mini-map, an HTML box over the bottom-left corner.
  const miniW = Math.min(MINI_MAX.w, MINI_MAX.h * (map.w / map.h));
  const miniH = miniW / (map.w / map.h);
  const miniView = sv("rect", {
    fill: BLUE,
    "fill-opacity": 0.1,
    stroke: BLUE,
    "stroke-width": 1.5,
    "vector-effect": "non-scaling-stroke",
    class: "strategic-mini-view",
  });
  const miniExplored = squaresPath(view.explored, map.w, 1);
  const miniBase = (base: Point, stroke: string, cls: string): SVGRectElement =>
    sv("rect", {
      x: base.x,
      y: base.y,
      width: BASE_SIZE.w,
      height: BASE_SIZE.h,
      fill: "none",
      stroke,
      "stroke-width": 1,
      "vector-effect": "non-scaling-stroke",
      class: cls,
    });
  const miniSvg = sv(
    "svg",
    { viewBox: `0 0 ${map.w} ${map.h}`, width: miniW, height: miniH, style: "display:block", class: "strategic-mini-svg" },
    sv("clipPath", { id: ids.miniClip }, sv("path", { d: miniExplored })),
    sv("rect", { width: map.w, height: map.h, fill: UNEXPLORED, class: "strategic-mini-fog" }),
    sv("path", { d: miniExplored, fill: PAPER, class: "strategic-mini-paper" }),
    sv("path", {
      d: squaresPath(terrainSquares(map), map.w, 1),
      fill: INK,
      "fill-opacity": 0.22,
      "clip-path": `url(#${ids.miniClip})`,
      class: "strategic-mini-terrain",
    }),
    miniBase(view.base, INK, "strategic-mini-base"),
    view.enemyBase && miniBase(view.enemyBase, RED, "strategic-mini-enemy-base"),
    miniView,
    sv("rect", {
      width: map.w,
      height: map.h,
      fill: "none",
      stroke: INK,
      "stroke-width": 2,
      "vector-effect": "non-scaling-stroke",
      class: "strategic-mini-frame",
    }),
  );
  const mini = el(
    "div",
    {
      class: "strategic-minimap",
      "data-testid": "minimap",
      style: `position:absolute;left:8px;bottom:8px;width:${miniW}px;height:${miniH}px;background:${PAPER};touch-action:none`,
    },
    miniSvg,
  );

  const root = el(
    "div",
    { class: "strategic-map-wrap", style: `position:relative;width:${width}px;height:${height}px;overflow:hidden;touch-action:none` },
    svg,
    opts.minimap !== false && mini,
  );

  /** The only thing a pan or zoom changes: the viewBox, the mini-map's viewport rectangle, and the app's memory. */
  const setCam = (c: Camera): void => {
    cam = clampCamera(c, map, width, height, inset);
    svg.setAttribute("viewBox", viewBoxOf(cam, width, height));
    const r = viewportRect(cam, width, height);
    miniView.setAttribute("x", String(r.x));
    miniView.setAttribute("y", String(r.y));
    miniView.setAttribute("width", String(r.w));
    miniView.setAttribute("height", String(r.h));
    opts.onCamera?.(cam);
  };
  const r0 = viewportRect(cam, width, height);
  for (const [k, v] of Object.entries({ x: r0.x, y: r0.y, width: r0.w, height: r0.h })) miniView.setAttribute(k, String(v));

  const focusBase = (): void => setCam(baseCamera(map, view.base, width, height, inset));

  // An eased pan (the replay moving to the next step) runs one animation frame at a time. A finger,
  // the wheel or the mini-map takes over at once, and a view taken off the page jumps to the end.
  let panFrame = 0;
  const stopPan = (): void => {
    if (panFrame) cancelAnimationFrame(panFrame);
    panFrame = 0;
  };
  const panTo = (p: Point, ms: number): void => {
    stopPan();
    const from = cam;
    const to = centreCamera(cam, p, map, width, height, inset);
    if (ms <= 0 || typeof requestAnimationFrame !== "function") return setCam(to);
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = root.isConnected ? (now - t0) / ms : 1;
      setCam(t >= 1 ? to : lerpCamera(from, to, easeInOut(t)));
      panFrame = t >= 1 ? 0 : requestAnimationFrame(step);
    };
    panFrame = requestAnimationFrame(step);
  };

  /** Pointer position in stage px from the view's top-left: the stage is CSS-scaled, so divide by the on-screen scale. */
  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = svg.getBoundingClientRect();
    const k = r.width / width;
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  // Gestures. Pointers are tracked in a Map so a second finger turns a pan into a pinch and back.
  // A gesture keeps only its last reading (`drag.from`, `pinch`): each move applies the change since
  // then to the current camera, so when the clamp stops the map at an edge or a zoom limit, the map
  // follows the fingers again as soon as they turn round. `drag.client` stays at the press for the tap test.
  const pointers = new Map<number, Point>();
  let drag: { from: Point; client: Point; t: number; moved: boolean; pinched: boolean } | null = null;
  let pinch: Pinch | null = null;

  const twoFingers = (): Pinch => {
    const [a, b] = [...pointers.values()] as [Point, Point];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  };
  const startPinch = (): void => {
    pinch = twoFingers();
    if (drag) drag.pinched = true;
  };
  const startDrag = (e: PointerEvent, p: Point, pinched: boolean): void => {
    drag = { from: p, client: { x: e.clientX, y: e.clientY }, t: e.timeStamp, moved: pinched, pinched };
  };

  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    stopPan();
    svg.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) startDrag(e, p, false);
    else startPinch();
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const now = twoFingers();
      setCam(pinchCamera(cam, pinch, now, map, width, height, inset));
      pinch = now;
    } else if (drag) {
      if (Math.hypot(e.clientX - drag.client.x, e.clientY - drag.client.y) > TAP_SLOP) drag.moved = true;
      setCam(panCamera(cam, { x: p.x - drag.from.x, y: p.y - drag.from.y }, map, width, height, inset));
      drag.from = p;
    }
  });
  const lift = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (pointers.size >= 2) return startPinch();
    if (pointers.size === 1) {
      // The pinch is over but a finger is still down: keep panning with it, and it is no tap.
      pinch = null;
      return startDrag(e, [...pointers.values()][0]!, true);
    }
    const d = drag;
    drag = null;
    pinch = null;
    if (!d || d.moved || d.pinched || e.type === "pointercancel" || e.timeStamp - d.t > TAP_MS) return;
    const at = toMap(cam, p, width, height);
    if (lastTap && e.timeStamp - lastTap.t < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.p.x, p.y - lastTap.p.y) < DOUBLE_TAP_PX) {
      // Double tap: a zoom step in, or back to the base once zoomed all the way in.
      lastTap = null;
      if (cam.scale >= SCALE_MAX - 1e-6) focusBase();
      else setCam(zoomAbout(cam, at, ZOOM_STEP, map, width, height, inset));
      return;
    }
    // A tap the screen used is an order, not the first half of a double tap.
    const used = opts.onTap?.(at) === true;
    lastTap = used ? null : { t: e.timeStamp, p };
  };
  svg.addEventListener("pointerup", lift);
  svg.addEventListener("pointercancel", lift);
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      stopPan();
      const p = local(e);
      setCam(zoomAbout(cam, toMap(cam, p, width, height), Math.exp(-e.deltaY * 0.002), map, width, height, inset));
    },
    { passive: false },
  );

  // A tap (or drag) on the mini-map puts that spot in the middle of the view at the current zoom.
  let miniDown = false;
  const recentre = (e: PointerEvent): void => {
    const r = miniSvg.getBoundingClientRect();
    setCam({ cx: ((e.clientX - r.left) / r.width) * map.w, cy: ((e.clientY - r.top) / r.height) * map.h, scale: cam.scale });
  };
  mini.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    stopPan();
    mini.setPointerCapture(e.pointerId);
    miniDown = true;
    recentre(e);
  });
  mini.addEventListener("pointermove", (e) => miniDown && recentre(e));
  mini.addEventListener("pointerup", () => (miniDown = false));
  mini.addEventListener("pointercancel", () => (miniDown = false));

  // The overlay: marks the turn screen draws while a unit is selected. Each mark gets a default
  // look from its class so it reads right before style.css lands; the stylesheet may override it.
  const markSquares = (points: readonly Point[], cls: string): SVGPathElement => {
    const onMap = points.filter((p) => p.x >= 0 && p.x < map.w && p.y >= 0 && p.y < map.h);
    const path = sv("path", {
      d: squaresPath(
        onMap.map((p) => p.y * map.w + p.x),
        map.w,
        S,
      ),
      class: cls,
      fill: MARK_FILL[cls] ?? "rgba(47, 95, 167, 0.18)",
    });
    overlay.append(path);
    return path;
  };
  const markRect = (rect: Rect, cls: string, pad = 0.08): SVGRectElement => {
    const p = pad * S;
    const mark = sv("rect", {
      x: rect.x * S - p,
      y: rect.y * S - p,
      width: rect.w * S + 2 * p,
      height: rect.h * S + 2 * p,
      rx: Math.max(4, p),
      fill: "none",
      stroke: MARK_STROKE[cls] ?? BLUE,
      "stroke-width": 2,
      "stroke-dasharray": "7 4",
      class: cls,
    });
    overlay.append(mark);
    return mark;
  };
  const markAim = (p: Point, shake: number = SHAKE_RADIUS): SVGGElement => {
    const cx = p.x * S;
    const cy = p.y * S;
    const arm = SHAKE_RADIUS * S + 8;
    const g = sv(
      "g",
      { class: "strategic-aim", "data-aim": `${p.x},${p.y}` },
      sv("circle", { cx, cy, r: shake * S, fill: "none", stroke: RED, "stroke-width": 1.5, "stroke-dasharray": "6 5", opacity: 0.8, class: "strategic-aim-shake" }),
      sv("circle", { cx, cy, r: SHOT_RADIUS * S, fill: "rgba(178, 58, 46, 0.08)", stroke: RED, "stroke-width": 2, class: "strategic-aim-shot" }),
      sv("path", {
        d: `M${cx - arm} ${cy}H${cx + arm}M${cx} ${cy - arm}V${cy + arm}`,
        fill: "none",
        stroke: RED,
        "stroke-width": 2,
        "stroke-linecap": "round",
        class: "strategic-aim-cross",
      }),
    );
    overlay.append(g);
    return g;
  };

  // Replay marks: ink for the viewer's side, red for the other, as on the results screen.
  const tone = (owner: PlayerIndex | undefined): string => (owner === view.viewer ? INK : RED);

  const markTrack = (points: readonly Point[], owner: PlayerIndex): SVGGElement => {
    // The line stops at the edge of the unit it leads to, so the arrow points at the drawing instead
    // of sitting on it. A move too short to leave the unit's own box gets just the arrow, on its edge.
    const at = points[points.length - 1];
    const unit = at ? unitAtPoint(view, at) : null;
    const box = unit ? footprintOf(unit) : null;
    const trimmed = box ? trimTrack(points, box, TRACK_GAP) : [...points];
    const edge = !trimmed && box ? edgeArrow(points, box, TRACK_GAP) : null;
    const line = trimmed ?? edge ?? [...points];
    const world = line.map((p) => ({ x: p.x * S, y: p.y * S }));
    const g = sv(
      "g",
      {
        class: "strategic-replay-track",
        "data-owner": owner === view.viewer ? "own" : "enemy",
        fill: "none",
        stroke: tone(owner),
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
      !edge && sv("path", { d: trackPath(line, S), "stroke-width": 3, "stroke-dasharray": "0.1 8", class: "strategic-replay-track-line" }),
      sv("path", { d: arrowHeadPath(world), "stroke-width": 2.5, class: "strategic-replay-track-arrow" }),
    );
    overlay.append(g);
    return g;
  };

  const markShot = (mark: ShotMark): SVGGElement => {
    const stroke = tone(view.shots.find((s) => s.id === mark.shotId)?.by);
    const cx = mark.x * S;
    const cy = mark.y * S;
    const r = SHOT_RADIUS * S;
    let line: SVGPathElement | null = null;
    if (mark.from) {
      // From the edge of the shooter's drawing to the ring, so neither the gun nor the landing spot is crossed out.
      const shooter = unitAtPoint(view, mark.from);
      const out = shooter ? trimTrack([{ x: mark.x, y: mark.y }, mark.from], footprintOf(shooter), TRACK_GAP) : null;
      const start = out?.[out.length - 1] ?? mark.from;
      const dx = cx - start.x * S;
      const dy = cy - start.y * S;
      const d = Math.hypot(dx, dy);
      if (d > r) {
        const k = (d - r) / d;
        line = sv("path", {
          d: `M${round2(start.x * S)} ${round2(start.y * S)}L${round2(start.x * S + dx * k)} ${round2(start.y * S + dy * k)}`,
          stroke,
          "stroke-width": 1.5,
          "stroke-linecap": "round",
          class: "strategic-replay-shot-line",
        });
      }
    }
    const g = sv(
      "g",
      { class: "strategic-replay-shot", "data-shot": mark.shotId, "data-weapon": mark.weapon, "data-from": mark.from ? "seen" : "hidden" },
      line,
      sv("circle", { cx, cy, r, fill: stroke, "fill-opacity": 0.08, stroke, "stroke-width": 2.5, class: "strategic-replay-shot-ring" }),
    );
    overlay.append(g);
    return g;
  };

  const markClash = (at: Point): SVGGElement => {
    const cx = at.x * S;
    const cy = at.y * S;
    const strokes = [0, 1, 2, 3].map((k) => {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      return `M${round2(cx + 5 * Math.cos(a))} ${round2(cy + 5 * Math.sin(a))}L${round2(cx + 13 * Math.cos(a))} ${round2(cy + 13 * Math.sin(a))}`;
    });
    // A paper halo under the red strokes keeps the star readable over a crossed-out (red) wreck.
    const g = sv(
      "g",
      { class: "strategic-replay-clash", "data-at": `${at.x},${at.y}`, fill: "none", "stroke-linecap": "round" },
      sv("path", { d: strokes.join(""), stroke: PAPER, "stroke-width": 6.5, opacity: 0.9 }),
      sv("path", { d: strokes.join(""), stroke: RED, "stroke-width": 3 }),
    );
    overlay.append(g);
    return g;
  };

  const markSpawn = (at: Point): SVGCircleElement => {
    const owner = unitAtPoint(view, at)?.owner ?? view.viewer;
    const ring = sv("circle", {
      cx: at.x * S,
      cy: at.y * S,
      r: 0.78 * S,
      fill: "none",
      stroke: tone(owner),
      "stroke-width": 2,
      "stroke-dasharray": "5 4",
      class: "strategic-replay-spawn",
      "data-owner": owner === view.viewer ? "own" : "enemy",
    });
    overlay.append(ring);
    return ring;
  };

  const slideUnit = (unitId: string, owner: PlayerIndex, from: Point, to: Point, ms: number): void => {
    const side = owner === view.viewer ? "strategic-units" : "strategic-enemies";
    const layer = svg.querySelector(`.${side}.living`);
    const unit = layer ? [...layer.children].find((c) => c.getAttribute("data-unit") === unitId) : undefined;
    const dx = (from.x - to.x) * S;
    const dy = (from.y - to.y) * S;
    if (!unit || ms <= 0 || (dx === 0 && dy === 0) || typeof requestAnimationFrame !== "function") return;
    // The hit point badge travels with its unit. Both sides use the same ids, so the owner picks it.
    const badge = [...svg.querySelectorAll(".strategic-hp")].find(
      (b) => b.getAttribute("data-hp-for") === unitId && b.getAttribute("data-owner") === (owner === view.viewer ? "own" : "enemy"),
    );
    const moving = [unit, badge].filter((e): e is Element => !!e).map((e) => ({ e, base: e.getAttribute("transform") ?? "" }));
    // The offset goes in front of a mirrored unit's own transform, so the drawing still faces the right way.
    const put = (left: number): void => {
      for (const { e, base } of moving) {
        const t = `${left > 0 ? `translate(${round2(dx * left)} ${round2(dy * left)}) ` : ""}${base}`.trim();
        if (t) e.setAttribute("transform", t);
        else e.removeAttribute("transform");
      }
    };
    put(1);
    const t0 = performance.now();
    const step = (now: number): void => {
      const t = root.isConnected ? (now - t0) / ms : 1;
      put(t >= 1 ? 0 : 1 - easeInOut(t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  return {
    root,
    svg,
    overlay,
    camera: () => cam,
    setCamera: setCam,
    fitWhole: () => setCam(fitCamera(map, width, height, inset)),
    focusBase,
    isWhole: () => isWholeCamera(cam, map, width, height, inset),
    centreOn: (p) => setCam(centreCamera(cam, p, map, width, height, inset)),
    markSquares,
    markRect,
    markAim,
    clearOverlay: () => overlay.replaceChildren(),
    unitAt: (p) => unitAtPoint(view, p),
    markTrack,
    markShot,
    markClash,
    markSpawn,
    slideUnit,
    inView: (p, margin) => inViewport(cam, p, width, height, margin),
    panTo,
  };
}

/** Every inner grid line of the map as one path, in world units. */
function gridPath(w: number, h: number, unit: number): string {
  const lines: string[] = [];
  for (let i = 1; i < w; i++) lines.push(`M${i * unit} 0V${h * unit}`);
  for (let j = 1; j < h; j++) lines.push(`M0 ${j * unit}H${w * unit}`);
  return lines.join("");
}

function terrainGroup(map: StrategicMap, treeId: string): SVGGElement {
  const g = sv("g", { class: "strategic-terrain" });
  drawTerrain(g, map, treeId);
  return g;
}

/** "Your" and "Enemy" on the turn screen; the players' names on the results screen, where both sides look on. */
function labelsFor(view: Pick<StrategicView, "viewer">, names?: [string, string]): { own: string; enemy: string } {
  if (!names) return { own: "Your", enemy: "Enemy" };
  return { own: `${names[view.viewer]}'s`, enemy: `${names[view.viewer === 0 ? 1 : 0]}'s` };
}

/**
 * "Your half" / "Enemy half" at the top, as on the mockup, with a hint under the enemy label until the
 * first enemy square is explored. A paper-coloured halo keeps the text readable over the hatching.
 */
function halfLabels(view: StrategicView, W: number, who: { own: string; enemy: string }): SVGGElement {
  const { map } = view;
  const ownLeft = view.base.x + BASE_SIZE.w / 2 < map.w / 2;
  const halo = { stroke: UNEXPLORED, "stroke-width": 5, "paint-order": "stroke", "stroke-linejoin": "round" };
  const label = (x: number, y: number, size: number, text: string, cls: string): SVGTextElement =>
    sv("text", { x, y, "text-anchor": "middle", "font-size": size, fill: INK_SOFT, class: cls, ...halo }, text);
  const enemyX = ownLeft ? (3 * W) / 4 : W / 4;
  const enemyExplored = [...view.explored].some((i) => (i % map.w < map.w / 2) !== ownLeft);
  return sv(
    "g",
    { class: "strategic-labels" },
    label(ownLeft ? W / 4 : (3 * W) / 4, 30, 24, `${who.own} half`, "strategic-half-label"),
    label(enemyX, 30, 24, `${who.enemy} half`, "strategic-half-label"),
    enemyExplored ? null : label(enemyX, 54, 18, "Blank paper, explore to draw it in", "strategic-half-hint"),
  );
}

/** A base: a dashed rounded rectangle with a small label above it. Ink for the viewer's own, red for the enemy's. */
function baseGroup(base: Point, S: number, text: string, stroke: string, cls: string): SVGGElement {
  return sv(
    "g",
    { class: cls },
    sv("rect", {
      x: base.x * S,
      y: base.y * S,
      width: BASE_SIZE.w * S,
      height: BASE_SIZE.h * S,
      rx: 6,
      fill: "none",
      stroke,
      "stroke-width": 1.6,
      "stroke-dasharray": "7 4",
      class: `${cls}-rect`,
    }),
    sv("text", { x: base.x * S + 4, y: base.y * S - 6, "font-size": 16, fill: stroke, class: `${cls}-label` }, text),
  );
}

/** How strongly a unit is drawn: enemies out of sight are a faded last-seen mark. */
const inkOf = (u: DrawnUnit): number => (u.current ? 1 : LAST_SEEN_OPACITY);

/**
 * Both armies. Wrecks go underneath so a living unit that stands on one (destroyed units never
 * block) is drawn whole. Each side keeps its class on both layers, so ".strategic-units [data-unit]"
 * is every own unit, living or not, and ".strategic-enemies [data-unit]" every enemy sighting.
 */
function unitsGroup(view: StrategicView, S: number): SVGGElement {
  const side = (units: readonly DrawnUnit[], cls: string, owner: "own" | "enemy", living: boolean): SVGGElement => {
    const g = sv("g", { class: `${cls} ${living ? "living" : "destroyed"}` });
    for (const u of units) {
      if ((u.state === "destroyed") === living) continue;
      const drawn = drawUnit(g, { ...u, mirror: (view.viewer === 1) === (owner === "own") }, S, { opacity: inkOf(u) });
      drawn.setAttribute("data-owner", owner);
      if (owner === "enemy") drawn.setAttribute("data-seen", u.current ? "current" : "last");
    }
    return g;
  };
  return sv(
    "g",
    { class: "strategic-armies" },
    sv("g", { class: "strategic-wrecks" }, side(view.units, "strategic-units", "own", false), side(view.enemies, "strategic-enemies", "enemy", false)),
    side(view.units, "strategic-units", "own", true),
    side(view.enemies, "strategic-enemies", "enemy", true),
  );
}

/**
 * Where units went, on the results screen: one thin dotted line per unit that moved, under the units
 * so no drawing is crossed out by its own trail. Ink for the viewer's side, red for the other.
 */
function tracksGroup(view: StrategicView, tracks: NonNullable<MapViewOptions["tracks"]>, S: number): SVGGElement {
  const g = sv("g", { class: "strategic-tracks", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" });
  for (const t of tracks) {
    if (t.points.length < 2) continue;
    const own = t.owner === view.viewer;
    g.append(
      sv("path", {
        d: trackPath(t.points, S),
        stroke: own ? INK : RED,
        "stroke-width": 2,
        "stroke-dasharray": "0.1 6",
        opacity: 0.85,
        class: "strategic-track",
        "data-owner": own ? "own" : "enemy",
      }),
    );
  }
  return g;
}

/** Hit point badges for every damaged unit that has more than one hit point, above the units so no neighbour covers them. */
function badgesGroup(view: StrategicView, S: number): SVGGElement {
  const g = sv("g", { class: "strategic-badges" });
  for (const u of [...view.units, ...view.enemies]) if (u.state === "damaged" && u.maxHp > 1) g.append(hpBadge(u, S, u.owner === view.viewer));
  return g;
}

/** "2/3" in a small paper pill tucked into the footprint's bottom-right corner, 11 world units of text. */
function hpBadge(u: DrawnUnit, S: number, own: boolean): SVGGElement {
  const r = footprintOf(u);
  const text = `${u.hp}/${u.maxHp}`;
  const h = 14;
  const w = 6 * text.length + 8;
  const right = (r.x + r.w) * S + 2;
  const bottom = (r.y + r.h) * S + 2;
  return sv(
    "g",
    { class: "strategic-hp", "data-hp-for": u.id, "data-owner": own ? "own" : "enemy", opacity: inkOf(u) },
    sv("rect", { x: right - w, y: bottom - h, width: w, height: h, rx: h / 2, fill: PAPER, stroke: INK, "stroke-width": 1 }),
    sv(
      "text",
      { x: right - w / 2, y: bottom - h / 2 + 0.5, "font-size": 11, "text-anchor": "middle", "dominant-baseline": "central", fill: INK },
      text,
    ),
  );
}

/**
 * Shot marks as on a Quick action board: the smudge art under the units (`marks`), and above them
 * (`stamps`) the shield for a shot a wall took, so the crossed-off wall never hides it. A blind
 * shell's mark is lighter: the shooter saw it land but not what it did. The viewer's latest shot
 * this turn gets the pulsing ring.
 */
function shotLayers(view: StrategicView, S: number): { marks: SVGGElement; stamps: SVGGElement } {
  const marks = sv("g", { class: "strategic-shots" });
  const stamps = sv("g", { class: "strategic-stamps" });
  for (const shot of view.shots) {
    const img = drawShotImage(marks, shot.outcome === "hit" || shot.outcome === "wall" ? "shot-hit" : "shot-miss", shot.x, shot.y, S);
    img.setAttribute("class", "strategic-shot");
    img.setAttribute("data-shot", String(shot.id));
    img.setAttribute("data-outcome", shot.outcome);
    img.setAttribute("data-weapon", shot.weapon);
    if (shot.outcome === "unknown") img.setAttribute("opacity", String(UNKNOWN_OPACITY));
    if (shot.outcome === "wall") stamps.append(shield(shot, S));
  }
  if (view.lastShot) {
    marks.append(sv("circle", { cx: view.lastShot.x * S, cy: view.lastShot.y * S, r: SHOT_RADIUS * S, class: "last-shot" }));
  }
  return { marks, stamps };
}

/** The shield on a wall-blocked shot, the same size and class as on a Quick action board. */
function shield(at: Pick<MapShot, "x" | "y">, S: number): SVGPathElement {
  const side = 0.8 * S;
  const k = side / 24;
  return sv("path", {
    d: SHIELD_PATH,
    class: "mark-shield",
    "data-mark": "blocked",
    transform: `translate(${at.x * S - side / 2} ${at.y * S - side / 2}) scale(${k})`,
  });
}
