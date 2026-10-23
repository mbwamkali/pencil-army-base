import { describe, expect, it } from "vitest";
import type { DrawnUnit, Point, ReplayMark, ReplayStep, StrategicMap, StrategicView } from "../src/strategic/rules/types.ts";
import { SQ_NEAR, baseCamera, centreCamera, fitCamera, toScreen, type Camera } from "../src/strategic/ui/camera.ts";
import { arrowHeadPath, edgeArrow, trackPath, trimTrack } from "../src/strategic/ui/mapView.ts";
import {
  CONTROLS_SPACE,
  STEP_MS,
  afterTick,
  chipText,
  clearViewCentre,
  counterText,
  inClearView,
  mergeMoves,
  pressPlay,
  replayStartCamera,
  scrollToShow,
  slideStart,
  stepMs,
} from "../src/strategic/ui/replayScreen.ts";

/** A Medium-sized map with no terrain. */
const map: StrategicMap = { id: "test-40x20", name: "Test", size: "medium", w: 40, h: 20, terrain: [], baseSpots: [{ x: 2, y: 7 }] };
const W = 744;
const H = 412;

const unit = (id: string, owner: 0 | 1, x: number, y: number, over: Partial<DrawnUnit> = {}): DrawnUnit => {
  const type = id.replace(/-\d+$/, "") as DrawnUnit["type"];
  return { id, type, x, y, upright: false, state: "normal", hp: 1, maxHp: 1, owner, current: true, ...over };
};

/** A replay frame for viewer 0 with the given enemies drawn (in sight). */
const frame = (enemies: DrawnUnit[], units: DrawnUnit[] = []): StrategicView => ({
  map,
  viewer: 0,
  base: { x: 2, y: 7 },
  enemyBase: null,
  units,
  enemies,
  explored: new Set(),
  visible: new Set(),
  shots: [],
  lastShot: null,
  orders: [],
  report: [],
  exploredPercent: 20,
  turnNumber: 3,
  over: false,
  winner: null,
});

describe("playback timing and labels", () => {
  it("shows an enemy step about 1.4 s, an own step 1.0 s and a match turn 0.7 s", () => {
    expect(stepMs("handover", "enemy")).toBe(1400);
    expect(stepMs("handover", "own")).toBe(1000);
    expect(stepMs("match", "turn")).toBe(700);
    // A match replay paces every step the same, whatever part it is tagged with.
    expect(stepMs("match", "enemy")).toBe(STEP_MS.turn);
  });

  it("counts steps from 1, in a match replay too, so it never contradicts the chip's per-player turn", () => {
    expect(counterText(1, 5)).toBe("Step 2 of 5");
    // Game.turn 7 is Ana's 4th turn: the chip says "Turn 4 · Ana", so the counter must not say "Turn 7".
    expect(counterText(6, 31)).toBe("Step 7 of 31");
    expect(counterText(6, 31)).not.toMatch(/^Turn/);
    expect(counterText(0, 0)).toBe("Step 0 of 0");
  });

  it("names whose turn a step comes from on the chip", () => {
    expect(chipText("handover", { part: "enemy", text: "A shell destroyed your tank 1" }, "Colonel Eraser")).toBe("Colonel Eraser's turn");
    expect(chipText("handover", { part: "own", text: "Your infantry marched" }, "Colonel Eraser")).toBe("Start of your turn");
    expect(chipText("match", { part: "turn", text: "Turn 7 · Ben" }, "Ben")).toBe("Turn 7 · Ben");
    expect(chipText("handover", undefined, "Ben")).toBe("While you were away");
  });
});

describe("afterTick", () => {
  it("moves on one step while playing", () => {
    expect(afterTick({ index: 0, playing: true }, 5)).toEqual({ index: 1, playing: true });
    expect(afterTick({ index: 3, playing: true }, 5)).toEqual({ index: 4, playing: true });
  });

  it("stops on the last step and never closes or wraps", () => {
    expect(afterTick({ index: 4, playing: true }, 5)).toEqual({ index: 4, playing: false });
    expect(afterTick({ index: 0, playing: true }, 1)).toEqual({ index: 0, playing: false });
  });

  it("does nothing while paused", () => {
    expect(afterTick({ index: 2, playing: false }, 5)).toEqual({ index: 2, playing: false });
  });
});

describe("pressPlay", () => {
  it("pauses while playing and plays on from the same step when paused", () => {
    expect(pressPlay({ index: 2, playing: true }, 5)).toEqual({ index: 2, playing: false });
    expect(pressPlay({ index: 2, playing: false }, 5)).toEqual({ index: 2, playing: true });
  });

  it("starts again from step 1 when pressed on the last step", () => {
    expect(pressPlay({ index: 4, playing: false }, 5)).toEqual({ index: 0, playing: true });
  });

  it("cannot play an empty replay", () => {
    expect(pressPlay({ index: 0, playing: false }, 0)).toEqual({ index: 0, playing: false });
  });
});

describe("where the replay looks", () => {
  const c: Camera = { cx: 20, cy: 10, scale: SQ_NEAR };

  it("counts only the map above the controls pill as the view", () => {
    const clearH = H - CONTROLS_SPACE;
    const at = (px: number, py: number): Point => ({ x: c.cx + (px - W / 2) / c.scale, y: c.cy + (py - H / 2) / c.scale });
    expect(inClearView(c, at(W / 2, clearH / 2), W, H)).toBe(true);
    expect(inClearView(c, at(W / 2, 0.84 * clearH), W, H)).toBe(true);
    // In the middle 70% of the whole view, but low enough that marks around it would sit under the pill.
    expect(inClearView(c, at(W / 2, 0.84 * H), W, H)).toBe(false);
    expect(inClearView(c, at(0.1 * W, clearH / 2), W, H)).toBe(false);
    expect(inClearView(c, at(0.9 * W, clearH / 2), W, H)).toBe(false);
    expect(inClearView(c, at(W / 2, 0.1 * clearH), W, H)).toBe(false);
  });

  it("centres the camera so the point lands in the middle of the map above the pill", () => {
    const p = { x: 22, y: 9 };
    const cam = { ...c, cx: p.x, cy: clearViewCentre(c, p).y };
    const s = toScreen(cam, p, W, H);
    expect(s.x).toBeCloseTo(W / 2, 9);
    expect(s.y).toBeCloseTo((H - CONTROLS_SPACE) / 2, 9);
    expect(inClearView(cam, p, W, H)).toBe(true);
  });

  it("opens a handover replay on the base unless the first step happened away from it", () => {
    const base = { x: 2, y: 7 };
    const home = baseCamera(map, base, W, H, CONTROLS_SPACE);
    expect(replayStartCamera(map, base, null, W, H)).toEqual(home);
    expect(replayStartCamera(map, base, { x: 8, y: 9 }, W, H)).toEqual(home);
    const away = replayStartCamera(map, base, { x: 30, y: 12 }, W, H);
    expect(away.scale).toBe(home.scale);
    expect(inClearView(away, { x: 30, y: 12 }, W, H)).toBe(true);
    expect(away).toEqual(centreCamera(home, clearViewCentre(home, { x: 30, y: 12 }), map, W, H, CONTROLS_SPACE));
  });

  it("can bring every square of the map above the controls pill, the bottom row too", () => {
    // The pill is 420 px wide and centred: a square under it is hidden, so the camera must lift it clear.
    const pillTop = H - CONTROLS_SPACE;
    const starts = [fitCamera(map, W, H, CONTROLS_SPACE), baseCamera(map, { x: 2, y: 7 }, W, H, CONTROLS_SPACE), { cx: 20, cy: 10, scale: 25 }];
    for (const start of starts) {
      for (let y = 0; y < map.h; y++) {
        for (let x = 0; x < map.w; x++) {
          const p = { x: x + 0.5, y: y + 0.5 };
          const cam = inClearView(start, p, W, H) ? start : centreCamera(start, clearViewCentre(start, p), map, W, H, CONTROLS_SPACE);
          // The square's whole height sits above the pill.
          expect(toScreen(cam, { x: p.x, y: p.y + 0.5 }, W, H).y, `square ${x},${y} at scale ${start.scale}`).toBeLessThanOrEqual(pillTop + 1e-6);
        }
      }
    }
  });

  it("opens a match replay on the whole map, all of it above the pill", () => {
    const c = fitCamera(map, W, H, CONTROLS_SPACE);
    expect(toScreen(c, { x: 0, y: 0 }, W, H).y).toBeCloseTo(0, 9);
    expect(toScreen(c, { x: map.w, y: map.h }, W, H).y).toBeLessThanOrEqual(H - CONTROLS_SPACE + 1e-6);
    expect(toScreen(c, { x: 0, y: 0 }, W, H).x).toBeGreaterThanOrEqual(0);
    expect(toScreen(c, { x: map.w, y: 0 }, W, H).x).toBeLessThanOrEqual(W);
  });
});

describe("scrollToShow", () => {
  it("leaves the list alone when the item is in view", () => {
    expect(scrollToShow(100, 130, 80, 200)).toBe(80);
  });

  it("scrolls up to an item above the view and down to one below it, as little as it can", () => {
    expect(scrollToShow(40, 70, 80, 200)).toBe(36);
    expect(scrollToShow(300, 330, 80, 200)).toBe(134);
  });

  it("keeps the top of an item taller than the list in view, and never goes below 0", () => {
    expect(scrollToShow(300, 600, 0, 200)).toBe(296);
    expect(scrollToShow(2, 30, 50, 200)).toBe(0);
  });
});

describe("mergeMoves", () => {
  it("gives one slide per unit, from its first place to its last", () => {
    const moves: ReplayStep["moves"] = [
      { unitId: "infantry-3", owner: 0, from: { x: 1, y: 1 }, to: { x: 2, y: 1 } },
      { unitId: "truck-1", owner: 0, from: { x: 5, y: 5 }, to: { x: 9, y: 5 } },
      { unitId: "infantry-3", owner: 0, from: { x: 2, y: 1 }, to: { x: 8, y: 4 } },
      { unitId: "infantry-3", owner: 1, from: { x: 30, y: 1 }, to: { x: 29, y: 1 } },
    ];
    expect(mergeMoves(moves)).toEqual([
      { unitId: "infantry-3", owner: 0, from: { x: 1, y: 1 }, to: { x: 8, y: 4 } },
      { unitId: "truck-1", owner: 0, from: { x: 5, y: 5 }, to: { x: 9, y: 5 } },
      { unitId: "infantry-3", owner: 1, from: { x: 30, y: 1 }, to: { x: 29, y: 1 } },
    ]);
  });
});

describe("slideStart", () => {
  const tank = unit("tank-1", 1, 16, 6, { hp: 3, maxHp: 3 });
  // The enemy tank drove from (24, 6) to (16, 6); the viewer saw only the stretch from x 20 on.
  const move = { unitId: "tank-1", owner: 1 as const, from: { x: 24, y: 6 }, to: { x: 16, y: 6 } };
  const track: ReplayMark = { kind: "track", owner: 1, points: [{ x: 20, y: 7 }, { x: 17, y: 7 }] };

  it("slides an enemy only along the part of its track the viewer saw", () => {
    expect(slideStart({ frame: frame([tank]), marks: [track] }, move, false)).toEqual({ x: 19, y: 6 });
  });

  it("never slides an enemy from where it really was when no track leads to it", () => {
    expect(slideStart({ frame: frame([tank]), marks: [] }, move, false)).toBeNull();
    const elsewhere: ReplayMark = { kind: "track", owner: 1, points: [{ x: 20, y: 12 }, { x: 18, y: 12 }] };
    expect(slideStart({ frame: frame([tank]), marks: [elsewhere] }, move, false)).toBeNull();
    // An own track ending on the same spot is not the enemy's.
    expect(slideStart({ frame: frame([tank]), marks: [{ ...track, owner: 0 }] }, move, false)).toBeNull();
  });

  it("does not slide an enemy that is not drawn (it went into the fog)", () => {
    expect(slideStart({ frame: frame([]), marks: [track] }, move, false)).toBeNull();
  });

  it("slides the viewer's own units, and everything once the fog is lifted, from where they were", () => {
    const own = { unitId: "infantry-1", owner: 0 as const, from: { x: 5, y: 5 }, to: { x: 6, y: 5 } };
    expect(slideStart({ frame: frame([]), marks: [] }, own, false)).toEqual({ x: 5, y: 5 });
    expect(slideStart({ frame: frame([tank]), marks: [] }, move, true)).toEqual({ x: 24, y: 6 });
  });
});

describe("track geometry", () => {
  it("draws a polyline in world units", () => {
    expect(trackPath([{ x: 1, y: 2 }, { x: 3.5, y: 2 }], 38)).toBe("M38 76L133 76");
    expect(trackPath([{ x: 0.123, y: 0 }], 38)).toBe("M4.67 0");
  });

  it("stops a track at the edge of the unit at its end", () => {
    const rect = { x: 16, y: 6, w: 2, h: 2 };
    const cut = trimTrack([{ x: 21, y: 7 }, { x: 17, y: 7 }], rect, 0.05);
    expect(cut).not.toBeNull();
    expect(cut!.length).toBe(2);
    expect(cut![1]!.x).toBeCloseTo(18.05, 9);
    expect(cut![1]!.y).toBeCloseTo(7, 9);
    // Diagonal into a 1x1 square: it enters through the corner.
    const diag = trimTrack([{ x: 3.5, y: 3.5 }, { x: 4.5, y: 4.5 }], { x: 4, y: 4, w: 1, h: 1 }, 0)!;
    expect(diag[1]!.x).toBeCloseTo(4, 9);
    expect(diag[1]!.y).toBeCloseTo(4, 9);
  });

  it("cuts a bent track where it last enters the unit", () => {
    const pts = [{ x: 10, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 6 }];
    const cut = trimTrack(pts, { x: 13, y: 5, w: 2, h: 2 }, 0)!;
    expect(cut.length).toBe(3);
    expect(cut[2]).toEqual({ x: 14, y: 7 });
  });

  it("leaves a track that does not end on the unit alone, and gives up on one wholly inside it", () => {
    const pts = [{ x: 1, y: 1 }, { x: 5, y: 1 }];
    expect(trimTrack(pts, { x: 10, y: 10, w: 2, h: 2 }, 0.05)).toEqual(pts);
    expect(trimTrack([{ x: 18, y: 7 }, { x: 17, y: 7 }], { x: 16, y: 6, w: 2, h: 2 }, 0.05)).toBeNull();
  });

  it("puts the arrow of a track inside its unit on the unit's edge, on the side it came from", () => {
    const [a, tip] = edgeArrow([{ x: 18, y: 7 }, { x: 17, y: 7 }], { x: 16, y: 6, w: 2, h: 2 }, 0.05)!;
    expect(tip.x).toBeCloseTo(18.05, 9);
    expect(tip.y).toBeCloseTo(7, 9);
    expect(a.x).toBeGreaterThan(tip.x);
    expect(edgeArrow([{ x: 3, y: 3 }, { x: 3, y: 3 }], { x: 2, y: 2, w: 2, h: 2 }, 0)).toBeNull();
  });

  it("draws an arrowhead pointing along the last stretch", () => {
    // Pointing right: both arms trail to the left of the tip, one above and one below.
    const d = arrowHeadPath([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10, 0.5);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const [ax, ay, tx, ty, bx, by] = nums as [number, number, number, number, number, number];
    expect([tx, ty]).toEqual([100, 0]);
    expect(ax).toBeLessThan(100);
    expect(bx).toBeLessThan(100);
    expect(Math.sign(ay)).toBe(-Math.sign(by));
    expect(arrowHeadPath([{ x: 5, y: 5 }])).toBe("");
  });
});
