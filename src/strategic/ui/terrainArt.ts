import { sv } from "../../ui/dom.ts";
import type { Point, StrategicMap, TerrainFeature } from "../rules/types.ts";
import { SQ_NEAR } from "./camera.ts";

/**
 * Pencil drawings of the Strategic terrain: forests as clusters of little trees, hills as wobbly
 * contour lines. Graphite only (decision 17). Everything is drawn in world units (map squares times
 * SQ_NEAR) and jittered from a hash of the square index, so the map looks hand drawn yet is the same
 * on every render and on both players' phones.
 */

export const INK = "#3b3d40";

/** The mockup's pencil tree: a leafy blob and a trunk, in a 20 x 22 box. */
export const TREE_PATH = "M10 2 C14 2 17 5 16 9 C18 11 16 15 12 14 C11 16 8 16 7 14 C3 15 2 11 4 9 C3 5 6 2 10 2 Z";
export const TRUNK_PATH = "M10 14 L10 20";
const TREE_BOX = { w: 20, h: 22 };

/** A cheap integer mix spread over [0, 1): the same square always gets the same jitter. */
export function hash01(n: number, salt = 0): number {
  let h = Math.imul(n + 1, 374761393) + Math.imul(salt + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Whether a square belongs to a feature: its centre lies inside the ellipse (the rules draw the same line). */
export function inFeature(f: TerrainFeature, x: number, y: number): boolean {
  const dx = (x + 0.5 - f.cx) / f.rx;
  const dy = (y + 0.5 - f.cy) / f.ry;
  return dx * dx + dy * dy <= 1;
}

/** The squares a feature covers, inside the map, in reading order (so lower trees are drawn over upper ones). */
export function featureSquares(f: TerrainFeature, map: Pick<StrategicMap, "w" | "h">): Point[] {
  const out: Point[] = [];
  for (let y = Math.max(0, Math.floor(f.cy - f.ry)); y < Math.min(map.h, Math.ceil(f.cy + f.ry)); y++) {
    for (let x = Math.max(0, Math.floor(f.cx - f.rx)); x < Math.min(map.w, Math.ceil(f.cx + f.rx)); x++) {
      if (inFeature(f, x, y)) out.push({ x, y });
    }
  }
  return out;
}

/** Every square of every feature on the map, by index (y * w + x). */
export function terrainSquares(map: Pick<StrategicMap, "w" | "h" | "terrain">): Set<number> {
  const out = new Set<number>();
  for (const f of map.terrain) for (const p of featureSquares(f, map)) out.add(p.y * map.w + p.x);
  return out;
}

/** The tree drawing as a symbol, so a forest of a hundred trees is one path in memory. */
export function treeSymbol(id: string): SVGSymbolElement {
  return sv(
    "symbol",
    { id, viewBox: `0 0 ${TREE_BOX.w} ${TREE_BOX.h}`, class: "strategic-tree" },
    sv("path", { d: TREE_PATH, fill: "none", stroke: INK, "stroke-width": 1.3, "stroke-linejoin": "round" }),
    sv("path", { d: TRUNK_PATH, fill: "none", stroke: INK, "stroke-width": 1.3, "stroke-linecap": "round" }),
  );
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** One tree per square, each nudged and sized a little differently so the forest does not look stamped. */
export function drawForest(parent: Element, f: TerrainFeature, map: Pick<StrategicMap, "w" | "h">, treeId: string): void {
  const g = sv("g", { class: "strategic-forest" });
  for (const p of featureSquares(f, map)) {
    const i = p.y * map.w + p.x;
    const w = (0.66 + 0.26 * hash01(i, 1)) * SQ_NEAR;
    const h = (w * TREE_BOX.h) / TREE_BOX.w;
    const x = (p.x + 0.5) * SQ_NEAR - w / 2 + (hash01(i, 2) - 0.5) * 0.3 * SQ_NEAR;
    const y = (p.y + 0.55) * SQ_NEAR - h / 2 + (hash01(i, 3) - 0.5) * 0.3 * SQ_NEAR;
    g.append(sv("use", { href: `#${treeId}`, x: round1(x), y: round1(y), width: round1(w), height: round1(h) }));
  }
  parent.append(g);
}

/** A closed, slightly wobbly ellipse through hashed sample points, as smooth cubic curves (Catmull-Rom). */
function wobblyEllipse(cx: number, cy: number, rx: number, ry: number, seed: number): string {
  const n = 14;
  const pts: Point[] = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const r = 1 + (hash01(seed, k) - 0.5) * 0.12;
    pts.push({ x: cx + rx * r * Math.cos(a), y: cy + ry * r * Math.sin(a) });
  }
  const at = (k: number): Point => pts[(k + n) % n]!;
  let d = `M${round1(at(0).x)} ${round1(at(0).y)}`;
  for (let k = 0; k < n; k++) {
    const p0 = at(k - 1);
    const p1 = at(k);
    const p2 = at(k + 1);
    const p3 = at(k + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${round1(c1.x)} ${round1(c1.y)} ${round1(c2.x)} ${round1(c2.y)} ${round1(p2.x)} ${round1(p2.y)}`;
  }
  return d + "Z";
}

/** Three contour lines, each smaller and fainter, with the summit a little off centre like a real hill. */
export function drawHill(parent: Element, f: TerrainFeature, map: Pick<StrategicMap, "w">): void {
  const seed = Math.round(f.cy) * map.w + Math.round(f.cx);
  const g = sv("g", { class: "strategic-hill" });
  const rings: { k: number; width: number; opacity: number }[] = [
    { k: 0.9, width: 1.4, opacity: 1 },
    { k: 0.62, width: 1.1, opacity: 0.8 },
    { k: 0.34, width: 0.9, opacity: 0.7 },
  ];
  const lean = { x: (hash01(seed, 101) - 0.5) * 0.3, y: (hash01(seed, 102) - 0.5) * 0.3 };
  rings.forEach((ring, i) => {
    const cx = (f.cx + lean.x * f.rx * (1 - ring.k)) * SQ_NEAR;
    const cy = (f.cy + lean.y * f.ry * (1 - ring.k)) * SQ_NEAR;
    g.append(
      sv("path", {
        d: wobblyEllipse(cx, cy, f.rx * ring.k * SQ_NEAR, f.ry * ring.k * SQ_NEAR, seed * 4 + i),
        fill: "none",
        stroke: INK,
        "stroke-width": ring.width,
        opacity: ring.opacity,
        "stroke-linejoin": "round",
      }),
    );
  });
  parent.append(g);
}

/** Every feature on the map. The caller clips the result to explored ground so fog hides what is not yet known. */
export function drawTerrain(parent: Element, map: Pick<StrategicMap, "w" | "h" | "terrain">, treeId: string): void {
  for (const f of map.terrain) {
    if (f.kind === "forest") drawForest(parent, f, map, treeId);
    else drawHill(parent, f, map);
  }
}
