import { SHOT_RADIUS } from "../../rules/constants.ts";
import { sizeOf, type Rect } from "../../rules/units.ts";
import { SHIELD_PATH, drawShotImage, drawUnit } from "../../ui/board.ts";
import { el, sv } from "../../ui/dom.ts";
import { SHAKE_RADIUS } from "../rules/constants.ts";
import type { DrawnUnit, MapShot, Point, StrategicMap, StrategicView } from "../rules/types.ts";
import {
  BASE_SIZE,
  SCALE_MAX,
  SQ_NEAR,
  ZOOM_STEP,
  baseCamera,
  centreCamera,
  clampCamera,
  fitCamera,
  isWholeCamera,
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
 * player taps, without touching the rest.
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
}

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

export function createMapView(opts: MapViewOptions): MapView {
  const { view, width, height } = opts;
  const map = view.map;
  const S = SQ_NEAR;
  const W = map.w * S;
  const H = map.h * S;
  const uid = `strategic-${++viewCount}`;
  const ids = { hatch: `${uid}-hatch`, clip: `${uid}-explored`, tree: `${uid}-tree`, miniClip: `${uid}-mini-explored` };
  const who = labelsFor(view, opts.names);
  let cam = clampCamera(opts.camera, map, width, height);

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
    cam = clampCamera(c, map, width, height);
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

  const focusBase = (): void => setCam(baseCamera(map, view.base, width, height));

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
      setCam(pinchCamera(cam, pinch, now, map, width, height));
      pinch = now;
    } else if (drag) {
      if (Math.hypot(e.clientX - drag.client.x, e.clientY - drag.client.y) > TAP_SLOP) drag.moved = true;
      setCam(panCamera(cam, { x: p.x - drag.from.x, y: p.y - drag.from.y }, map, width, height));
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
      else setCam(zoomAbout(cam, at, ZOOM_STEP, map, width, height));
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
      const p = local(e);
      setCam(zoomAbout(cam, toMap(cam, p, width, height), Math.exp(-e.deltaY * 0.002), map, width, height));
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

  return {
    root,
    svg,
    overlay,
    camera: () => cam,
    setCamera: setCam,
    fitWhole: () => setCam(fitCamera(map, width, height)),
    focusBase,
    isWhole: () => isWholeCamera(cam, map, width, height),
    centreOn: (p) => setCam(centreCamera(cam, p, map, width, height)),
    markSquares,
    markRect,
    markAim,
    clearOverlay: () => overlay.replaceChildren(),
    unitAt: (p) => unitAtPoint(view, p),
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

/** Hit point badges for every damaged unit that has more than one hit point, above the units so no neighbour covers them. */
function badgesGroup(view: StrategicView, S: number): SVGGElement {
  const g = sv("g", { class: "strategic-badges" });
  for (const u of [...view.units, ...view.enemies]) if (u.state === "damaged" && u.maxHp > 1) g.append(hpBadge(u, S));
  return g;
}

/** "2/3" in a small paper pill tucked into the footprint's bottom-right corner, 11 world units of text. */
function hpBadge(u: DrawnUnit, S: number): SVGGElement {
  const r = footprintOf(u);
  const text = `${u.hp}/${u.maxHp}`;
  const h = 14;
  const w = 6 * text.length + 8;
  const right = (r.x + r.w) * S + 2;
  const bottom = (r.y + r.h) * S + 2;
  return sv(
    "g",
    { class: "strategic-hp", "data-hp-for": u.id, opacity: inkOf(u) },
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
