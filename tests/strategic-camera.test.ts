import { describe, expect, it } from "vitest";
import type { StrategicMap } from "../src/strategic/rules/types.ts";
import {
  BASE_SIZE,
  SCALE_MAX,
  SQ_NEAR,
  ZOOM_STEP,
  baseCamera,
  cameraHolding,
  centreCamera,
  clampCamera,
  easeInOut,
  fitCamera,
  fitScale,
  inViewport,
  isWholeCamera,
  lerpCamera,
  panCamera,
  pinchCamera,
  toMap,
  toScreen,
  viewBoxOf,
  viewportRect,
  zoomAbout,
  type Camera,
} from "../src/strategic/ui/camera.ts";

/** A Medium-sized map with no terrain: the camera never looks at terrain. */
const map: StrategicMap = { id: "test-40x20", name: "Test", size: "medium", w: 40, h: 20, terrain: [], baseSpots: [{ x: 2, y: 7 }] };

/** The turn screen's viewport. */
const W = 744;
const H = 412;
/** 744 / 40 = 18.6 px per square: the width is the tight side (412 / 20 would allow 20.6). */
const FIT = W / map.w;

const edges = (c: Camera) => {
  const r = viewportRect(c, W, H);
  return { left: r.x, top: r.y, right: r.x + r.w, bottom: r.y + r.h };
};

describe("fitCamera", () => {
  it("shows the whole map, centred, at min(width / w, height / h) px per square", () => {
    const c = fitCamera(map, W, H);
    expect(c).toEqual({ cx: 20, cy: 10, scale: FIT });
    expect(fitScale(map, W, H)).toBe(18.6);
    // Nothing of the map is cut off on either axis.
    const e = edges(c);
    expect(e.left).toBeCloseTo(0, 9);
    expect(e.right).toBeCloseTo(map.w, 9);
    expect(e.top).toBeLessThanOrEqual(0);
    expect(e.bottom).toBeGreaterThanOrEqual(map.h);
  });

  it("gives a viewBox as wide as the map in world units (squares times SQ_NEAR)", () => {
    const [x, , w, h] = viewBoxOf(fitCamera(map, W, H), W, H).split(" ").map(Number);
    expect(x).toBe(0);
    expect(w).toBe(map.w * SQ_NEAR);
    expect(h).toBeCloseTo((H / FIT) * SQ_NEAR, 2);
  });

  it("fits the tight side on a tall viewport too", () => {
    expect(fitCamera(map, 400, 100).scale).toBe(5);
    expect(fitCamera(map, 100, 400).scale).toBe(2.5);
  });
});

describe("baseCamera", () => {
  it("is SQ_NEAR px per square on the centre of the base, pushed in from the map edge", () => {
    const c = baseCamera(map, { x: 2, y: 7 }, W, H);
    expect(c.scale).toBe(SQ_NEAR);
    // Base centre is (8, 10): the row fits, but x 8 would show paper left of the map, so the view starts at x 0.
    expect(c.cy).toBe(7 + BASE_SIZE.h / 2);
    expect(edges(c).left).toBeCloseTo(0, 9);
    expect(c.cx).toBeCloseTo(W / SQ_NEAR / 2, 9);
  });

  it("gives player 2 the same view turned half a circle", () => {
    const c1 = baseCamera(map, { x: 2, y: 7 }, W, H);
    const c2 = baseCamera(map, { x: map.w - BASE_SIZE.w - 2, y: map.h - BASE_SIZE.h - 7 }, W, H);
    expect(c2.scale).toBe(SQ_NEAR);
    expect(c2.cx).toBeCloseTo(map.w - c1.cx, 9);
    expect(c2.cy).toBeCloseTo(map.h - c1.cy, 9);
    expect(edges(c2).right).toBeCloseTo(map.w, 9);
  });

  it("stays centred on a base in the middle of the map", () => {
    const c = baseCamera(map, { x: 14, y: 7 }, W, H);
    expect(c).toEqual({ cx: 20, cy: 10, scale: SQ_NEAR });
  });
});

describe("clampCamera", () => {
  it("keeps the scale between the whole-map fit and SCALE_MAX", () => {
    expect(clampCamera({ cx: 20, cy: 10, scale: 1 }, map, W, H).scale).toBe(FIT);
    expect(clampCamera({ cx: 20, cy: 10, scale: 1000 }, map, W, H).scale).toBe(SCALE_MAX);
    expect(SCALE_MAX).toBe(76);
    expect(clampCamera({ cx: 20, cy: 10, scale: 30 }, map, W, H).scale).toBe(30);
  });

  it("keeps the viewport inside the map at every scale", () => {
    const centres = [
      { cx: -50, cy: -50 },
      { cx: 0, cy: 0 },
      { cx: 3, cy: 19 },
      { cx: 20, cy: 10 },
      { cx: 39, cy: 1 },
      { cx: 100, cy: 100 },
    ];
    for (const scale of [FIT, 20, 25, 30, SQ_NEAR, 50, 60, SCALE_MAX]) {
      for (const centre of centres) {
        const c = clampCamera({ ...centre, scale }, map, W, H);
        const e = edges(c);
        expect(e.left, `scale ${scale} centre ${centre.cx},${centre.cy}`).toBeGreaterThanOrEqual(-1e-9);
        expect(e.right, `scale ${scale}`).toBeLessThanOrEqual(map.w + 1e-9);
        if (H / scale <= map.h) {
          expect(e.top, `scale ${scale}`).toBeGreaterThanOrEqual(-1e-9);
          expect(e.bottom, `scale ${scale}`).toBeLessThanOrEqual(map.h + 1e-9);
        }
      }
    }
  });

  it("leaves a camera alone when it is already inside", () => {
    const c: Camera = { cx: 20, cy: 10, scale: 30 };
    expect(clampCamera(c, map, W, H)).toEqual(c);
  });

  it("centres the map along an axis it cannot fill", () => {
    // At the fit scale the view is taller than the map: the map sits in the middle whatever was asked.
    expect(clampCamera({ cx: 20, cy: 0, scale: FIT }, map, W, H).cy).toBe(10);
    expect(clampCamera({ cx: 20, cy: 20, scale: FIT }, map, W, H).cy).toBe(10);
    // Just zoomed in enough to fill the height, the centre can move again.
    const tight = H / map.h;
    expect(clampCamera({ cx: 20, cy: 0, scale: tight + 1 }, map, W, H).cy).toBeGreaterThan(9);
    expect(clampCamera({ cx: 20, cy: 0, scale: tight + 1 }, map, W, H).cy).toBeLessThan(10);
  });

  it("prefers the fit over SCALE_MAX on a map smaller than the viewport", () => {
    const tiny = { ...map, w: 4, h: 2 };
    const c = clampCamera({ cx: 2, cy: 1, scale: 10 }, tiny, W, H);
    expect(c.scale).toBe(fitScale(tiny, W, H));
    expect(c.scale).toBeGreaterThan(SCALE_MAX);
  });
});

describe("toMap and toScreen", () => {
  const c: Camera = { cx: 12.5, cy: 8, scale: 30 };

  it("put the camera centre in the middle of the view", () => {
    expect(toMap(c, { x: W / 2, y: H / 2 }, W, H)).toEqual({ x: 12.5, y: 8 });
    expect(toScreen(c, { x: 12.5, y: 8 }, W, H)).toEqual({ x: W / 2, y: H / 2 });
  });

  it("are inverses", () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 100, y: 300 },
      { x: W, y: H },
    ]) {
      const back = toScreen(c, toMap(c, p, W, H), W, H);
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it("move one square per `scale` px", () => {
    expect(toMap(c, { x: W / 2 + 60, y: H / 2 - 30 }, W, H)).toEqual({ x: 14.5, y: 7 });
  });
});

describe("zoomAbout", () => {
  it("keeps the map point under the finger where it was", () => {
    const before: Camera = { cx: 20, cy: 10, scale: 30 };
    const at = { x: 24, y: 12 };
    const after = zoomAbout(before, at, ZOOM_STEP, map, W, H);
    expect(after.scale).toBeCloseTo(48, 9);
    const was = toScreen(before, at, W, H);
    const now = toScreen(after, at, W, H);
    expect(now.x).toBeCloseTo(was.x, 9);
    expect(now.y).toBeCloseTo(was.y, 9);
    // The camera moved towards the finger.
    expect(after.cx).toBeGreaterThan(20);
    expect(after.cy).toBeGreaterThan(10);
  });

  it("zooming out again about the same point gives the camera back", () => {
    const before: Camera = { cx: 20, cy: 10, scale: 30 };
    const at = { x: 17, y: 6 };
    const there = zoomAbout(zoomAbout(before, at, 1.5, map, W, H), at, 1 / 1.5, map, W, H);
    expect(there.cx).toBeCloseTo(before.cx, 9);
    expect(there.cy).toBeCloseTo(before.cy, 9);
    expect(there.scale).toBeCloseTo(before.scale, 9);
  });

  it("still clamps: zooming out at the left edge keeps the map covering the view", () => {
    const before = baseCamera(map, { x: 2, y: 7 }, W, H); // the view's left edge is the map's left edge
    const at = { x: 0.2, y: 10 };
    // Zoomed out to 26.6 px per square the view is 15.5 squares tall, so the map still fills it on both axes.
    const c = zoomAbout(before, at, 0.7, map, W, H);
    expect(c.scale).toBeCloseTo(26.6, 9);
    expect(edges(c).left).toBeCloseTo(0, 9);
    expect(edges(c).top).toBeGreaterThanOrEqual(0);
    // Holding that square exactly in place would have shown paper past the edge, so it slid a little left.
    expect(toScreen(c, at, W, H).x).toBeLessThan(toScreen(before, at, W, H).x);
  });

  it("stops at SCALE_MAX and at the fit", () => {
    expect(zoomAbout({ cx: 20, cy: 10, scale: 70 }, { x: 20, y: 10 }, 2, map, W, H).scale).toBe(SCALE_MAX);
    expect(zoomAbout({ cx: 20, cy: 10, scale: 20 }, { x: 20, y: 10 }, 0.1, map, W, H).scale).toBe(FIT);
  });

  it("keeps the finger point fixed even when the zoom hits SCALE_MAX", () => {
    // A pinch that asks for x3 from SQ_NEAR is cut to 76: the square under the fingers must not drift.
    const before: Camera = { cx: 10, cy: 10, scale: SQ_NEAR };
    const at = { x: 11.5, y: 9.2 };
    const after = zoomAbout(before, at, 3, map, W, H);
    expect(after.scale).toBe(SCALE_MAX);
    const was = toScreen(before, at, W, H);
    const now = toScreen(after, at, W, H);
    expect(now.x).toBeCloseTo(was.x, 9);
    expect(now.y).toBeCloseTo(was.y, 9);
  });
});

describe("cameraHolding", () => {
  it("puts the map point under the given screen point, as a pinch midpoint drifts", () => {
    const at = { x: 22, y: 9 };
    const px = { x: 500, y: 120 };
    const c = cameraHolding(at, px, 40, map, W, H);
    expect(c.scale).toBe(40);
    const s = toScreen(c, at, W, H);
    expect(s.x).toBeCloseTo(px.x, 9);
    expect(s.y).toBeCloseTo(px.y, 9);
  });
});

describe("panCamera", () => {
  it("moves the map one square per `scale` px, the opposite way to the finger", () => {
    const c: Camera = { cx: 20, cy: 10, scale: 30 };
    expect(panCamera(c, { x: 60, y: -30 }, map, W, H)).toEqual({ cx: 18, cy: 11, scale: 30 });
  });

  it("follows the finger back the moment it turns round at a map edge", () => {
    // The turn opens with the map's left edge against the view's left edge. Pulling the map rightwards
    // asks for paper past the edge, so step after step nothing moves...
    let c = baseCamera(map, { x: 2, y: 7 }, W, H);
    const start = c;
    for (let i = 0; i < 10; i++) c = panCamera(c, { x: 10, y: 0 }, map, W, H);
    expect(c).toEqual(start);
    // ...and the first step back moves the map at once, by that step, not after 100 px of dead travel.
    const back = panCamera(c, { x: -10, y: 0 }, map, W, H);
    expect(back.cx).toBeCloseTo(start.cx + 10 / SQ_NEAR, 9);
    expect(back.cy).toBe(start.cy);
  });

  it("applied step by step matches one move from start to end while nothing is clamped", () => {
    const c0: Camera = { cx: 20, cy: 10, scale: 30 };
    const steps = [
      { x: 12, y: -5 },
      { x: 20, y: 4 },
      { x: -7, y: 9 },
    ];
    const whole = steps.reduce((a, d) => ({ x: a.x + d.x, y: a.y + d.y }), { x: 0, y: 0 });
    const stepwise = steps.reduce((c, d) => panCamera(c, d, map, W, H), c0);
    const once = panCamera(c0, whole, map, W, H);
    expect(stepwise.cx).toBeCloseTo(once.cx, 9);
    expect(stepwise.cy).toBeCloseTo(once.cy, 9);
  });
});

describe("pinchCamera", () => {
  const from = { mid: { x: 300, y: 200 }, dist: 100 };

  it("scales with the fingers' distance and keeps the map point under the midpoint", () => {
    const c: Camera = { cx: 20, cy: 10, scale: 30 };
    const at = toMap(c, from.mid, W, H);
    const to = { mid: { x: 340, y: 180 }, dist: 150 };
    const after = pinchCamera(c, from, to, map, W, H);
    expect(after.scale).toBeCloseTo(45, 9);
    const s = toScreen(after, at, W, H);
    expect(s.x).toBeCloseTo(to.mid.x, 9);
    expect(s.y).toBeCloseTo(to.mid.y, 9);
  });

  it("leaves the camera alone when the fingers have not moved", () => {
    const c: Camera = { cx: 20, cy: 10, scale: 30 };
    const same = pinchCamera(c, from, from, map, W, H);
    expect(same.cx).toBeCloseTo(c.cx, 9);
    expect(same.cy).toBeCloseTo(c.cy, 9);
    expect(same.scale).toBe(c.scale);
  });

  it("applied step by step matches one pinch from start to end while nothing is clamped", () => {
    const c0: Camera = { cx: 20, cy: 10, scale: 30 };
    const readings = [from, { mid: { x: 310, y: 205 }, dist: 110 }, { mid: { x: 325, y: 212 }, dist: 125 }, { mid: { x: 330, y: 210 }, dist: 140 }];
    let stepwise = c0;
    for (let i = 1; i < readings.length; i++) stepwise = pinchCamera(stepwise, readings[i - 1]!, readings[i]!, map, W, H);
    const once = pinchCamera(c0, readings[0]!, readings[readings.length - 1]!, map, W, H);
    expect(once.scale).toBeCloseTo(42, 9);
    expect(stepwise.cx).toBeCloseTo(once.cx, 9);
    expect(stepwise.cy).toBeCloseTo(once.cy, 9);
    expect(stepwise.scale).toBeCloseTo(once.scale, 9);
  });

  it("zooms out again the moment the fingers close after spreading past SCALE_MAX", () => {
    // Spreading to x4 asks for 152 px per square and gets 76; closing a tenth then shrinks straight away.
    const spread = { mid: from.mid, dist: 400 };
    const c = pinchCamera({ cx: 20, cy: 10, scale: SQ_NEAR }, from, spread, map, W, H);
    expect(c.scale).toBe(SCALE_MAX);
    const closed = pinchCamera(c, spread, { mid: from.mid, dist: 360 }, map, W, H);
    expect(closed.scale).toBeCloseTo(SCALE_MAX * 0.9, 9);
  });
});

describe("centreCamera", () => {
  it("looks straight at the point at the same scale when the map allows", () => {
    const c: Camera = { cx: 8, cy: 10, scale: SQ_NEAR };
    expect(centreCamera(c, { x: 21, y: 9 }, map, W, H)).toEqual({ cx: 21, cy: 9, scale: SQ_NEAR });
  });

  it("stops at the map's edges, so a unit in a corner comes as close to the middle as the paper allows", () => {
    const c: Camera = { cx: 20, cy: 10, scale: SQ_NEAR };
    // 744 / 38 squares wide and 412 / 38 tall: the centre can get no nearer the corner than half of that.
    const corner = centreCamera(c, { x: 1, y: 1 }, map, W, H);
    expect(corner.scale).toBe(SQ_NEAR);
    expect(corner.cx).toBeCloseTo(W / SQ_NEAR / 2, 9);
    expect(corner.cy).toBeCloseTo(H / SQ_NEAR / 2, 9);
    expect(edges(corner).left).toBeCloseTo(0, 9);
    expect(edges(corner).top).toBeCloseTo(0, 9);
    const far = centreCamera(c, { x: 39, y: 19.5 }, map, W, H);
    expect(edges(far).right).toBeCloseTo(map.w, 9);
    expect(edges(far).bottom).toBeCloseTo(map.h, 9);
  });

  it("keeps the whole map centred on an axis the view cannot fill", () => {
    const whole = fitCamera(map, W, H);
    const c = centreCamera(whole, { x: 30, y: 2 }, map, W, H);
    expect(c).toEqual(whole);
  });

  it("never changes the scale, even from an unclamped one", () => {
    const c = centreCamera({ cx: 20, cy: 10, scale: 1000 }, { x: 20, y: 10 }, map, W, H);
    expect(c.scale).toBe(SCALE_MAX);
    expect(centreCamera({ cx: 20, cy: 10, scale: 25 }, { x: 10, y: 10 }, map, W, H).scale).toBe(25);
  });
});

describe("isWholeCamera", () => {
  it("is true at the fit, within 1%, and false once zoomed in", () => {
    expect(isWholeCamera(fitCamera(map, W, H), map, W, H)).toBe(true);
    expect(isWholeCamera({ cx: 20, cy: 10, scale: FIT * 1.009 }, map, W, H)).toBe(true);
    expect(isWholeCamera({ cx: 20, cy: 10, scale: FIT * 1.02 }, map, W, H)).toBe(false);
    expect(isWholeCamera(baseCamera(map, { x: 2, y: 7 }, W, H), map, W, H)).toBe(false);
  });
});

describe("inViewport", () => {
  const c: Camera = { cx: 20, cy: 10, scale: SQ_NEAR };
  // 744 / 38 = 19.58 squares wide, 412 / 38 = 10.84 tall, centred on (20, 10).
  const r = viewportRect(c, W, H);

  it("is true in the middle 70% of the view and false in the outer 15% on each side", () => {
    expect(inViewport(c, { x: 20, y: 10 }, W, H)).toBe(true);
    expect(inViewport(c, { x: r.x + 0.16 * r.w, y: r.y + 0.84 * r.h }, W, H)).toBe(true);
    expect(inViewport(c, { x: r.x + 0.14 * r.w, y: 10 }, W, H)).toBe(false);
    expect(inViewport(c, { x: r.x + 0.86 * r.w, y: 10 }, W, H)).toBe(false);
    expect(inViewport(c, { x: 20, y: r.y + 0.1 * r.h }, W, H)).toBe(false);
    expect(inViewport(c, { x: 20, y: r.y + 0.9 * r.h }, W, H)).toBe(false);
  });

  it("is false outside the view altogether, and the margin can be changed", () => {
    expect(inViewport(c, { x: 2, y: 10 }, W, H)).toBe(false);
    expect(inViewport(c, { x: r.x + 0.05 * r.w, y: 10 }, W, H, 0)).toBe(true);
    expect(inViewport(c, { x: r.x + 0.3 * r.w, y: 10 }, W, H, 0.35)).toBe(false);
  });

  it("follows the zoom: what is near the edge zoomed in is well inside the whole map", () => {
    const p = { x: r.x + 0.05 * r.w, y: 10 };
    expect(inViewport(c, p, W, H)).toBe(false);
    expect(inViewport(fitCamera(map, W, H), p, W, H)).toBe(true);
  });
});

describe("easeInOut", () => {
  it("starts at 0, ends at 1, passes the middle at one half and never overshoots", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
    let last = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeInOut(t);
      expect(v).toBeGreaterThanOrEqual(last - 1e-12);
      expect(v).toBeLessThanOrEqual(1);
      last = v;
    }
  });

  it("starts and stops gently, and clamps times outside 0..1", () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
  });
});

describe("lerpCamera", () => {
  it("moves centre and scale the given fraction of the way", () => {
    const a: Camera = { cx: 10, cy: 5, scale: 20 };
    const b: Camera = { cx: 30, cy: 15, scale: 40 };
    expect(lerpCamera(a, b, 0)).toEqual(a);
    expect(lerpCamera(a, b, 1)).toEqual(b);
    expect(lerpCamera(a, b, 0.25)).toEqual({ cx: 15, cy: 7.5, scale: 25 });
  });
});

describe("a bottom cover (the replay's controls pill)", () => {
  const COVER = 64;
  /** Where the map's top and bottom edges land on screen, in stage px. */
  const mapEdges = (c: Camera) => ({ top: toScreen(c, { x: 0, y: 0 }, W, H).y, bottom: toScreen(c, { x: 0, y: map.h }, W, H).y });

  it("changes nothing when it is 0", () => {
    const c: Camera = { cx: 3, cy: 19, scale: SQ_NEAR };
    expect(clampCamera(c, map, W, H, 0)).toEqual(clampCamera(c, map, W, H));
    expect(fitCamera(map, W, H, 0)).toEqual(fitCamera(map, W, H));
    expect(baseCamera(map, { x: 2, y: 7 }, W, H, 0)).toEqual(baseCamera(map, { x: 2, y: 7 }, W, H));
  });

  it("fits the whole map above the cover, centred across, with no gap at the top", () => {
    const c = fitCamera(map, W, H, COVER);
    // (412 - 64) / 20 = 17.4 is now tighter than 744 / 40 = 18.6.
    expect(c.scale).toBeCloseTo((H - COVER) / map.h, 9);
    expect(mapEdges(c).top).toBeCloseTo(0, 9);
    expect(mapEdges(c).bottom).toBeCloseTo(H - COVER, 9);
    expect(toScreen(c, { x: map.w / 2, y: 0 }, W, H).x).toBeCloseTo(W / 2, 9);
    expect(clampCamera(c, map, W, H, COVER)).toEqual(c);
    expect(isWholeCamera(c, map, W, H, COVER)).toBe(true);
    // The clamp would not zoom out to it without the cover: the map is never smaller than the view needs.
    expect(clampCamera(c, map, W, H).scale).toBeCloseTo(FIT, 9);
  });

  it("lets the map rise until its last row sits just above the cover, at any zoom, and no further", () => {
    for (const scale of [fitScale(map, W, H, COVER), FIT, 25, SQ_NEAR, SCALE_MAX]) {
      const low = mapEdges(clampCamera({ cx: 20, cy: 99, scale }, map, W, H, COVER));
      expect(low.bottom).toBeCloseTo(H - COVER, 6);
      expect(low.top).toBeLessThanOrEqual(1e-6);
      const high = mapEdges(clampCamera({ cx: 20, cy: -99, scale }, map, W, H, COVER));
      expect(high.top).toBeCloseTo(0, 6);
    }
  });

  it("holds for a drag, a pinch, a zoom and a centring alike", () => {
    const c = baseCamera(map, { x: 26, y: 7 }, W, H, COVER);
    expect(mapEdges(panCamera(c, { x: 0, y: -2000 }, map, W, H, COVER)).bottom).toBeCloseTo(H - COVER, 6);
    expect(mapEdges(centreCamera(c, { x: 20, y: 30 }, map, W, H, COVER)).bottom).toBeCloseTo(H - COVER, 6);
    expect(mapEdges(zoomAbout(c, { x: 20, y: 19.9 }, 1.2, map, W, H, COVER)).bottom).toBeGreaterThanOrEqual(H - COVER - 1e-6);
    const pinched = pinchCamera(c, { mid: { x: 300, y: 400 }, dist: 100 }, { mid: { x: 300, y: -400 }, dist: 100 }, map, W, H, COVER);
    expect(mapEdges(pinched).bottom).toBeCloseTo(H - COVER, 6);
    // Without the cover the same drag stops with the map's bottom at the view's bottom.
    expect(mapEdges(panCamera(c, { x: 0, y: -2000 }, map, W, H)).bottom).toBeCloseTo(H, 6);
  });

  it("centres the base in the part above the cover", () => {
    const c = baseCamera(map, { x: 2, y: 7 }, W, H, COVER);
    expect(c.scale).toBe(SQ_NEAR);
    expect(toScreen(c, { x: 8, y: 10 }, W, H).y).toBeCloseTo((H - COVER) / 2, 9);
  });
});
