import { FOOTPRINT, GRID_H, GRID_W, type UnitType } from "../rules/constants.ts";
import { rectOf, type UnitState } from "../rules/units.ts";
import { artUrl, unitArt } from "./art.ts";
import { sv } from "./dom.ts";

/** Points per grid square on a full-screen base (grid 20 x 10 = 760 x 380). */
export const SQ = 38;

export interface DrawUnit {
  id: string;
  type: UnitType;
  x: number;
  y: number;
  upright: boolean;
  state: UnitState;
}

export interface DrawShot {
  x: number;
  y: number;
  hit: boolean;
}

let boardCount = 0;

/** A unit's art is square: as wide as the unit's longest side, centred on its footprint. */
export function drawUnit(parent: Element, u: DrawUnit, sq: number, opts: { opacity?: number } = {}): SVGGElement {
  const r = rectOf(u);
  const side = Math.max(FOOTPRINT[u.type].w, FOOTPRINT[u.type].h) * sq;
  const cx = (r.x + r.w / 2) * sq;
  const cy = (r.y + r.h / 2) * sq;
  const g = sv("g", { "data-unit": u.id, "data-state": u.state, opacity: opts.opacity });
  g.append(
    sv("image", {
      href: unitArt(u.type, u.state),
      x: cx - side / 2,
      y: cy - side / 2,
      width: side,
      height: side,
      transform: u.upright ? `rotate(-90 ${cx} ${cy})` : undefined,
    }),
  );
  parent.append(g);
  return g;
}

/** Shot marks come in a 2 x 2 square box; the smudge inside is about 1.75 squares across. */
export function drawShotImage(parent: Element, name: string, x: number, y: number, sq: number): SVGImageElement {
  const side = 2 * sq;
  const img = sv("image", { href: artUrl(name), x: x * sq - side / 2, y: y * sq - side / 2, width: side, height: side });
  parent.append(img);
  return img;
}

export function drawShot(parent: Element, s: DrawShot, sq: number): void {
  drawShotImage(parent, s.hit ? "shot-hit" : "shot-miss", s.x, s.y, sq);
}

export interface Board {
  svg: SVGSVGElement;
  /** Paper, grid, shot marks and units (units on top, so a smudge never hides a crossed-off unit); the magnifier copies this layer. */
  world: SVGGElement;
  units: SVGGElement;
  marks: SVGGElement;
  /** Aim crosshair, drag ghost and other temporary drawing on top. */
  overlay: SVGGElement;
  sq: number;
  worldId: string;
  /** Pointer position in grid squares (fractional), measured on the screen so scaling does not matter. */
  toGrid(e: { clientX: number; clientY: number }): { x: number; y: number };
}

export function createBoard(opts: { sq?: number; tint: "own" | "target"; label?: string; testid?: string }): Board {
  const sq = opts.sq ?? SQ;
  const w = GRID_W * sq;
  const h = GRID_H * sq;
  const worldId = `world-${++boardCount}`;
  const svg = sv("svg", {
    class: `board board-${opts.tint}`,
    width: w,
    height: h,
    viewBox: `0 0 ${w} ${h}`,
    "data-testid": opts.testid,
  });

  const lines: string[] = [];
  for (let i = 1; i < GRID_W; i++) lines.push(`M${i * sq} 0V${h}`);
  for (let j = 1; j < GRID_H; j++) lines.push(`M0 ${j * sq}H${w}`);

  const units = sv("g", { class: "units" });
  const marks = sv("g", { class: "marks" });
  const world = sv(
    "g",
    { id: worldId },
    sv("rect", { width: w, height: h, class: "paper" }),
    sv("path", { d: lines.join(""), class: "gridlines" }),
    marks,
    units,
  );
  if (opts.tint === "target") {
    const wobble = Array.from({ length: GRID_H * 2 + 1 }, (_, i) => `L${3 + (i % 2 ? 4 : 0)} ${(i * h) / (GRID_H * 2)}`).join("");
    world.append(
      sv("path", { d: `M3 0${wobble}`, class: "frontline" }),
      sv("text", { x: 14, y: 18, class: "board-note" }, "front line"),
    );
    if (opts.label) world.append(sv("text", { x: w / 2, y: h - 38, "text-anchor": "middle", class: "board-ghost" }, opts.label));
  }
  world.append(sv("rect", { width: w, height: h, class: "frame" }));

  const overlay = sv("g", { class: "overlay" });
  svg.append(world, overlay);

  return {
    svg,
    world,
    units,
    marks,
    overlay,
    sq,
    worldId,
    toGrid(e) {
      const r = svg.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * GRID_W, y: ((e.clientY - r.top) / r.height) * GRID_H };
    },
  };
}

/** One circle centered on the aim point: a zoomed view of the squares under it, with the shot ring and crosshair on top. */
export function drawMagnifier(board: Board, ax: number, ay: number): void {
  const { sq, overlay } = board;
  const zoom = 1.6;
  const shotRadius = 0.875 * sq * zoom;
  const radius = shotRadius + 8;
  const cx = ax * sq;
  const cy = ay * sq;
  const clipId = `${board.worldId}-lens`;
  overlay.append(
    sv("clipPath", { id: clipId }, sv("circle", { cx, cy, r: radius })),
    sv("circle", { cx, cy, r: radius + 2, class: "lens-rim" }),
    sv(
      "g",
      { "clip-path": `url(#${clipId})` },
      sv("rect", { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2, class: "lens-paper" }),
      sv("use", { href: `#${board.worldId}`, transform: `translate(${cx} ${cy}) scale(${zoom}) translate(${-cx} ${-cy})` }),
      sv("circle", { cx, cy, r: shotRadius, class: "lens-shot" }),
      sv("path", { d: `M${cx - radius} ${cy}H${cx + radius}M${cx} ${cy - radius}V${cy + radius}`, class: "lens-cross" }),
    ),
  );
}
