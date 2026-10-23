import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FOOTPRINT,
  SHOT_ART_SIZE,
  SHOT_RADIUS,
  circleHitsRect,
  hitRectOf,
  rectOf,
  resolveShot,
  type Rect,
  type Unit,
  type UnitType,
} from "../src/rules/index.ts";

/**
 * These tests read the real art files, so they fail if the art is redrawn bigger than the hit areas.
 * Every art file is a 64 x 64 box of straight pencil lines (M/L paths) plus a few circles and ellipses.
 */
const ART = 64;

/** Where the pencil marks of an art file reach, in art units, counting half of each line's width. */
function artExtent(name: string): { box: Rect; radius: number } {
  const svg = readFileSync(new URL(`../public/art/${name}.svg`, import.meta.url), "utf8");
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, radius = 0;
  const mark = (x: number, y: number, rx: number, ry: number) => {
    x0 = Math.min(x0, x - rx);
    y0 = Math.min(y0, y - ry);
    x1 = Math.max(x1, x + rx);
    y1 = Math.max(y1, y + ry);
    radius = Math.max(radius, Math.hypot(x - ART / 2, y - ART / 2) + Math.max(rx, ry));
  };
  const attr = (tag: string, name: string) => Number(tag.match(new RegExp(` ${name}="([-\\d.]+)"`))?.[1] ?? 0);
  for (const [tag] of svg.matchAll(/<path\b[^>]*>/g)) {
    const d = tag.match(/ d="([^"]*)"/)![1]!;
    expect(d, `${name}: only absolute straight lines are measured`).toMatch(/^[ML\d.,\s-]+$/);
    const half = (attr(tag, "stroke-width") || 1) / 2;
    for (const [, x, y] of d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) mark(Number(x), Number(y), half, half);
  }
  for (const [tag] of svg.matchAll(/<(?:circle|ellipse)\b[^>]*>/g)) {
    mark(attr(tag, "cx"), attr(tag, "cy"), attr(tag, "r") || attr(tag, "rx"), attr(tag, "r") || attr(tag, "ry"));
  }
  expect(svg, `${name}: no transforms to account for`).not.toMatch(/transform=/);
  return { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, radius };
}

/**
 * Where a unit's drawing lands on the board, in squares, drawn the way board.ts draws it: a square
 * image as wide as the unit's longest side, centred on its squares, turned a quarter turn
 * anticlockwise when upright, and flipped left to right for player 2's army.
 */
function drawnRect(u: Unit, art: Rect, mirror: boolean): Rect {
  const side = Math.max(FOOTPRINT[u.type].w, FOOTPRINT[u.type].h);
  const s = side / ART;
  // Offsets from the image centre, before turning or flipping.
  let left = (art.x - ART / 2) * s, right = (art.x + art.w - ART / 2) * s;
  let top = (art.y - ART / 2) * s, bottom = (art.y + art.h - ART / 2) * s;
  if (u.upright) [left, right, top, bottom] = [top, bottom, -right, -left];
  if (mirror) [left, right] = [-right, -left];
  const r = rectOf(u);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  return { x: cx + left, y: cy + top, w: right - left, h: bottom - top };
}

const unit = (type: UnitType, upright = false): Unit => ({ id: `${type}-1`, type, x: 5, y: 3, upright, hits: 0 });

/**
 * Every unit drawing a shot can hit: fighting units fresh, the fort also damaged, walls flat and
 * upright, and the Strategic truck fresh and destroyed. The destroyed truck is measured on a fresh
 * unit (a destroyed one takes no hits) so its red cross is known to stay inside the hit area too.
 */
const CASES: { label: string; u: Unit; art: string }[] = [
  { label: "fort", u: unit("fort"), art: "fort" },
  { label: "damaged fort", u: { ...unit("fort"), hits: 1 }, art: "fort-damaged" },
  { label: "tank", u: unit("tank"), art: "tank" },
  { label: "artillery", u: unit("artillery"), art: "artillery" },
  { label: "infantry", u: unit("infantry"), art: "infantry" },
  { label: "wall", u: unit("wall"), art: "wall" },
  { label: "upright wall", u: unit("wall", true), art: "wall" },
  { label: "truck", u: unit("truck"), art: "truck" },
  { label: "destroyed truck", u: unit("truck"), art: "truck-destroyed" },
];

describe("shot drawing", () => {
  for (const name of ["shot-hit", "shot-miss"]) {
    it(`${name} never reaches past the hit circle`, () => {
      const reach = (artExtent(name).radius / ART) * SHOT_ART_SIZE;
      expect(reach).toBeLessThanOrEqual(SHOT_RADIUS);
    });
  }
});

describe("unit hit areas match the drawings", () => {
  // How far the shot's drawing reaches from where it landed: the bigger of the hit and miss smudges.
  const shotReach = Math.max(...["shot-hit", "shot-miss"].map((n) => (artExtent(n).radius / ART) * SHOT_ART_SIZE));

  for (const { label, u, art } of CASES) {
    for (const mirror of [false, true]) {
      const army = mirror ? "player 2" : "player 1";

      it(`a shot whose drawing overlaps the ${label}'s drawing always hits it (${army})`, () => {
        const drawn = drawnRect(u, artExtent(art).box, mirror);
        let overlaps = 0;
        // Shots every 0.05 squares over the whole area around the unit, edges included.
        for (let x = drawn.x - 1.5; x <= drawn.x + drawn.w + 1.5; x += 0.05) {
          for (let y = drawn.y - 1.5; y <= drawn.y + drawn.h + 1.5; y += 0.05) {
            if (!circleHitsRect(x, y, shotReach, drawn)) continue;
            overlaps++;
            const { result } = resolveShot([u], x, y, 1);
            expect(result.hits.map((h) => h.unitId), `shot at (${x.toFixed(2)}, ${y.toFixed(2)})`).toEqual([u.id]);
          }
        }
        expect(overlaps).toBeGreaterThan(100);
      });
    }

    if (u.type === "wall") continue; // walls are hit over their whole squares for now
    it(`the ${label}'s hit area is no more than 0.15 squares bigger than its drawing on any side`, () => {
      const box = artExtent(art).box;
      const plain = drawnRect(u, box, false);
      const flipped = drawnRect(u, box, true);
      // Both armies share one hit area, so it covers the drawing and its mirror image.
      const left = Math.min(plain.x, flipped.x);
      const right = Math.max(plain.x + plain.w, flipped.x + flipped.w);
      const hit = hitRectOf(u);
      expect(left - hit.x).toBeLessThanOrEqual(0.15);
      expect(hit.x + hit.w - right).toBeLessThanOrEqual(0.15);
      expect(plain.y - hit.y).toBeLessThanOrEqual(0.15);
      expect(hit.y + hit.h - (plain.y + plain.h)).toBeLessThanOrEqual(0.15);
    });
  }
});
