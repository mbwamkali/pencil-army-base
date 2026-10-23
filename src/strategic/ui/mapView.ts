import { unitState } from "../../rules/units.ts";
import { drawUnit } from "../../ui/board.ts";
import { el, sv } from "../../ui/dom.ts";
import type { Point, StrategicMap, StrategicView } from "../rules/types.ts";
import {
  BASE_SIZE,
  SCALE_MAX,
  SQ_NEAR,
  ZOOM_STEP,
  baseCamera,
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
 * the viewBox and the mini-map's viewport rectangle, so a big map stays smooth on a phone.
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
  /** A tap (pointer down and up moving less than 10 px, not a pinch) in fractional map squares. */
  onTap?: (p: Point) => void;
}

export interface MapView {
  /** Positioned box of width x height; holds the svg and the mini-map. */
  root: HTMLElement;
  /** data-testid="strategic-map" */
  svg: SVGSVGElement;
  camera(): Camera;
  /** Clamps, then updates the viewBox (no rebuild). */
  setCamera(c: Camera): void;
  /** Whole map in view. */
  fitWhole(): void;
  /** SQ_NEAR px per square, centred on the viewer's base. */
  focusBase(): void;
  /** True when the camera is at (or within 1% of) the whole-map fit. */
  isWhole(): boolean;
}

/** Pencil look: the same tones as style.css, set as attributes so the map looks right before any CSS lands. */
const PAPER = "#faf9f4";
const UNEXPLORED = "#ece6d6";
const HATCH = "#d8d0bd";
const GRID = "#b9cadb";
const BLUE = "#2f5fa7";
const INK_SOFT = "#6b6d70";
/** What shows past the map's edge when the whole map letterboxes: the desk under the paper. */
const DESK = "#e6e2d8";

/** A press that moves less than this many screen pixels and lifts within TAP_MS is a tap, not a pan. */
const TAP_SLOP = 10;
const TAP_MS = 300;
/** Two taps this close together (time and stage px) zoom in a step. */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 30;
/** Mini-map box: as wide as it can be within these limits while keeping the map's aspect. */
const MINI_MAX = { w: 128, h: 72 };

let viewCount = 0;

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

export function createMapView(opts: MapViewOptions): MapView {
  const { view, width, height } = opts;
  const map = view.map;
  const S = SQ_NEAR;
  const W = map.w * S;
  const H = map.h * S;
  const uid = `strategic-${++viewCount}`;
  const ids = { hatch: `${uid}-hatch`, clip: `${uid}-explored`, tree: `${uid}-tree`, miniClip: `${uid}-mini-explored` };
  let cam = clampCamera(opts.camera, map, width, height);

  const explored = squaresPath(view.explored, map.w, S);
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
    halfLabels(view, W),
    sv("rect", { width: W, height: H, fill: "none", stroke: INK, "stroke-width": 2, class: "strategic-frame" }),
    // 5. the viewer's own base.
    baseGroup(view.base, S),
    // 6. units: own, then enemy sightings.
    unitsGroup(view, S),
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
    sv("rect", {
      x: view.base.x,
      y: view.base.y,
      width: BASE_SIZE.w,
      height: BASE_SIZE.h,
      fill: "none",
      stroke: INK,
      "stroke-width": 1,
      "vector-effect": "non-scaling-stroke",
      class: "strategic-mini-base",
    }),
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
    mini,
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
  let lastTap: { t: number; p: Point } | null = null;

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
    lastTap = { t: e.timeStamp, p };
    opts.onTap?.(at);
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

  return {
    root,
    svg,
    camera: () => cam,
    setCamera: setCam,
    fitWhole: () => setCam(fitCamera(map, width, height)),
    focusBase,
    isWhole: () => isWholeCamera(cam, map, width, height),
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

/**
 * "Your half" / "Enemy half" at the top, as on the mockup, with a hint under the enemy label until the
 * first enemy square is explored. A paper-coloured halo keeps the text readable over the hatching.
 */
function halfLabels(view: StrategicView, W: number): SVGGElement {
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
    label(ownLeft ? W / 4 : (3 * W) / 4, 30, 24, "Your half", "strategic-half-label"),
    label(enemyX, 30, 24, "Enemy half", "strategic-half-label"),
    enemyExplored ? null : label(enemyX, 54, 18, "Blank paper, explore to draw it in", "strategic-half-hint"),
  );
}

/** The viewer's own base: a dashed rounded rectangle with a small label above it. */
function baseGroup(base: Point, S: number): SVGGElement {
  return sv(
    "g",
    { class: "strategic-base" },
    sv("rect", {
      x: base.x * S,
      y: base.y * S,
      width: BASE_SIZE.w * S,
      height: BASE_SIZE.h * S,
      rx: 6,
      fill: "none",
      stroke: INK,
      "stroke-width": 1.6,
      "stroke-dasharray": "7 4",
      class: "strategic-base-rect",
    }),
    sv("text", { x: base.x * S + 4, y: base.y * S - 6, "font-size": 16, fill: INK, class: "strategic-base-label" }, "Your base"),
  );
}

/** Own units at full strength of ink; enemy sightings fade when they are no longer in sight. */
function unitsGroup(view: StrategicView, S: number): SVGGElement {
  const own = sv("g", { class: "strategic-units" });
  for (const u of view.units) drawUnit(own, { ...u, state: unitState(u), mirror: view.viewer === 1 }, S);
  const enemies = sv("g", { class: "strategic-enemies" });
  for (const { unit, current } of view.enemies) {
    const g = drawUnit(enemies, { ...unit, mirror: view.viewer !== 1 }, S, { opacity: current ? 1 : 0.45 });
    g.setAttribute("data-seen", current ? "current" : "last");
  }
  return sv("g", { class: "strategic-armies" }, own, enemies);
}
