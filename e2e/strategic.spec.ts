import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { confirmHandoff, createGame, finishBuild, randomLayout, rectOf, type Game, type Unit } from "../src/rules/index.ts";
import {
  BASE_GRID,
  HP,
  NEW_GAME_MAP_IDS,
  aimProblem,
  decodeExplored,
  distanceToRect,
  endStrategicTurn,
  fireArtillery,
  fireTank,
  footprintAt,
  isAlive,
  isFree,
  mapOf,
  moveUnit,
  reachableFor,
  replayFor,
  shakeRadius,
  shotForViewer,
  squareDistance,
  tankTargets,
  unitSeen,
  unitTracks,
  validBaseSpots,
  visibleSquares,
} from "../src/strategic/rules/index.ts";
import {
  buildBothAndStart,
  centreOfUnit,
  continueSaved,
  mapPoint,
  savedGame,
  startNewGame,
  strategicGame,
  tapMap,
  turnOnLargeText,
} from "./helpers.ts";

/** The Strategic base, in squares (see src/strategic/rules). */
const BASE = { w: 12, h: 6 };
/** World units per square in the map's SVG. */
const SQ_NEAR = 38;
/** The Strategic army: fort, 2 tanks, artillery, 2 infantry, 2 walls and the truck. */
const ARMY_SIZE = 9;

const SIZE: Record<string, [number, number]> = { fort: [3, 3], tank: [2, 2], artillery: [2, 2], infantry: [1, 1], wall: [2, 1], truck: [2, 2] };

const viewBox = async (page: Page): Promise<number[]> =>
  ((await page.getByTestId("strategic-map").getAttribute("viewBox")) as string).split(" ").map(Number);

const percentOf = async (page: Page): Promise<number> => Number(((await page.getByTestId("explored").textContent()) ?? "").replace(/\D/g, ""));

/**
 * How badly the panel fails to fit, in screen px: how far its last line reaches past the bottom of
 * its content box, or how far any two of its lines (the order rows counted one by one) are drawn
 * over each other, whichever is worse. Zero or less when everything fits. The panel's scrollHeight
 * alone would miss rows squeezed under the lines laid out after them.
 */
const panelFits = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector(".panel") as HTMLElement;
    const items = [...panel.querySelectorAll(":scope > *:not(.orders), .orders > *")] as HTMLElement[];
    const boxes = items
      .map((e) => e.getBoundingClientRect())
      .filter((b) => b.height > 0)
      .sort((a, b) => a.top - b.top);
    // The stage is CSS-scaled to the phone, so the panel's padding (in stage px) is scaled the same way.
    const k = (document.getElementById("stage") as HTMLElement).getBoundingClientRect().width / 920;
    const inner = panel.getBoundingClientRect().bottom - parseFloat(getComputedStyle(panel).paddingBottom) * k;
    let worst = Math.max(...boxes.map((b) => b.bottom)) - inner;
    for (let i = 1; i < boxes.length; i++) worst = Math.max(worst, boxes[i - 1]!.bottom - boxes[i]!.top);
    return Math.round(worst * 2) / 2;
  });

function ok(r: { ok: boolean; game?: Game; reason?: string }): Game {
  if (!r.ok) throw new Error(r.reason);
  return r.game as Game;
}

const insideBase = (u: Unit, base: { x: number; y: number }): boolean => {
  const [w, h] = SIZE[u.type] as [number, number];
  const [rw, rh] = u.type === "wall" && u.upright ? [h, w] : [w, h];
  return u.x >= base.x && u.y >= base.y && u.x + rw <= base.x + BASE.w && u.y + rh <= base.y + BASE.h;
};

/** Whether a map point falls on the square of one of these units (a tap there would pick the unit instead). */
const onAUnit = (units: readonly Unit[], p: { x: number; y: number }): boolean =>
  units.some((u) => {
    const r = rectOf(u);
    const sq = { x: Math.floor(p.x), y: Math.floor(p.y) };
    return sq.x >= r.x && sq.x < r.x + r.w && sq.y >= r.y && sq.y < r.y + r.h;
  });

/** The size of the map a game is played on: a new game draws one of the Large maps at random. */
const mapSize = (g: Game): { w: number; h: number } => mapOf(g.strategic?.map);

/** The way from a unit's centre toward the middle of the map, as a unit vector. */
function towardCentre(u: Unit, map: { w: number; h: number }): { x: number; y: number } {
  const c = centreOfUnit(u);
  const dx = map.w / 2 - c.x;
  const dy = map.h / 2 - c.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
}

/** An empty point one to three squares from an artillery piece: too close for a shell, with nothing to pick there. */
function tooClosePoint(units: readonly Unit[], gun: Unit, map: { w: number; h: number }): { x: number; y: number } {
  const c = centreOfUnit(gun);
  const rect = rectOf(gun);
  for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 8) {
    for (let t = 2.5; t <= 3.5; t += 0.25) {
      const p = { x: c.x + t * Math.cos(angle), y: c.y + t * Math.sin(angle) };
      const d = distanceToRect(p.x, p.y, rect);
      if (p.x < 0.5 || p.y < 0.5 || p.x > map.w - 0.5 || p.y > map.h - 0.5) continue;
      if (d >= 1 && d < 2.9 && !onAUnit(units, p)) return p;
    }
  }
  throw new Error("no empty square near the artillery");
}

/** Both bases built at random through the rules, and player 1's first turn begun (its automatic phase run). */
function firstTurn(seed: number): Game {
  let g = createGame({ seed, names: ["Ana", "Ben"], mode: "strategic" });
  g = randomLayout(g, 0);
  g = ok(finishBuild(g, 0));
  g = ok(confirmHandoff(g));
  g = randomLayout(g, 1);
  g = ok(finishBuild(g, 1));
  return ok(confirmHandoff(g));
}

/** Ends the current player's turn and begins the other player's, as pressing Start on the black screen does. */
const pass = (g: Game): Game => ok(confirmHandoff(ok(endStrategicTurn(g))));

/** Moves one of the current player's units as far toward the enemy base as it can go this turn (it stays put if it cannot move). */
function advance(g: Game, unitId: string): Game {
  const s = g.strategic as NonNullable<Game["strategic"]>;
  const base = s.bases[g.current === 0 ? 1 : 0];
  const goal = { x: base.x + BASE_GRID.w / 2, y: base.y + BASE_GRID.h / 2 };
  const unit = g.players[g.current].units.find((u) => u.id === unitId);
  if (!unit || !isAlive(unit)) return g;
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  for (const to of reachableFor(g, unitId)) {
    const c = centreOfUnit({ ...unit, ...to });
    const d = Math.hypot(c.x - goal.x, c.y - goal.y);
    if (d < bestDistance) [best, bestDistance] = [to, d];
  }
  return best ? ok(moveUnit(g, unitId, best)) : g;
}

/** Ben's artillery puts a shell close to one of Ana's units, on ground she has explored, so her replay shows it. */
function shellOnAnasGround(g: Game): Game {
  const map = mapOf((g.strategic as NonNullable<Game["strategic"]>).map);
  const explored = decodeExplored((g.strategic as NonNullable<Game["strategic"]>).explored[0], map);
  for (const u of g.players[0].units.filter(isAlive)) {
    const c = centreOfUnit(u);
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]] as const) {
      const aim = { x: c.x + dx, y: c.y + dy };
      if (aimProblem(g, "artillery-1", aim)) continue;
      const r = fireArtillery(g, "artillery-1", aim);
      if (r.ok && shotForViewer(r.shot, 0, explored, map)) return r.game;
    }
  }
  throw new Error("no shell landed where Ana could see it");
}

/**
 * A game left on the black screen before Ana's turn, built through the rules (the replay rebuilds
 * the past from the saved events). Each round both tanks 1 head for the other base, until Ben's
 * comes into Ana's sight; on that turn it fires at one of her units in range, and his artillery
 * puts a shell on ground she knows. Seed 4 (The ridge): her replay opens with Ben's tank coming out of
 * the fog.
 */
function craftedHandover(): Game {
  let g = firstTurn(4);
  const map = mapOf((g.strategic as NonNullable<Game["strategic"]>).map);
  for (let round = 0; round < 8; round++) {
    g = advance(pass(advance(g, "tank-1")), "tank-1");
    const tank = g.players[1].units.find((u) => u.id === "tank-1") as Unit;
    if (!unitSeen(tank, visibleSquares(g.players[0].units.filter(isAlive), map), map)) {
      g = pass(g);
      continue;
    }
    const target = tankTargets(g, "tank-1")[0];
    if (target) g = ok(fireTank(g, "tank-1", target));
    return ok(endStrategicTurn(shellOnAnasGround(g)));
  }
  throw new Error("Ben's tank never came into Ana's sight");
}

/**
 * A Strategic game on the brink of its end, built through the rules: both bases random, `rounds`
 * quiet rounds played (Ana's tank 2 and Ben's tank 1 head for the other base, so the match has
 * turns and tracks to show), then player 1 at the start of their turn with their tank 1 lifted
 * beside the enemy fort, which has one hit point left. One tank shot wins.
 */
function craftedWin(rounds = 0): Game {
  let g = firstTurn(5);
  for (let i = 0; i < rounds; i++) g = pass(advance(pass(advance(g, "tank-2")), "tank-1"));
  const s = g.strategic;
  if (!s?.start) throw new Error("no Strategic state");
  const map = mapOf(s.map);
  const fort = g.players[1].units.find((u) => u.type === "fort") as Unit;
  const tank = g.players[0].units.find((u) => u.id === "tank-1") as Unit;
  const all = [...g.players[0].units, ...g.players[1].units];
  const fortRect = rectOf(fort);
  let spot: { x: number; y: number } | null = null;
  for (let dy = -2; dy <= 3 && !spot; dy++) {
    for (let dx = -2; dx <= 3 && !spot; dx++) {
      const r = footprintAt(tank, fort.x + dx, fort.y + dy);
      if (squareDistance(r, fortRect) === 1 && isFree(map, all, r, new Set([tank]))) spot = { x: r.x, y: r.y };
    }
  }
  if (!spot) throw new Error("no room beside the enemy fort");
  tank.x = spot.x;
  tank.y = spot.y;
  fort.hits = HP.fort - 1;
  // The same edits in the starting armies, so the replays' rebuilt past agrees with the saved units
  // (tank 1 never moved and nothing hit the fort, so no event undoes them).
  Object.assign(s.start[0].find((u) => u.id === "tank-1") as Unit, spot);
  (s.start[1].find((u) => u.type === "fort") as Unit).hits = HP.fort - 1;
  s.autoDoneTurn = g.turn;
  return g;
}

/** Opens a crafted save on Ana's turn, plays through her replay if one opens, and fells the enemy fort with tank 1. */
async function winWithTank1(page: Page, crafted: Game): Promise<void> {
  await continueSaved(page, crafted);
  await page.getByTestId("start").click();
  if (replayFor(crafted).open) {
    await expect(page.getByTestId("strategic-replay")).toBeVisible();
    await page.getByTestId("replay-done").click();
  }
  await expect(page.getByTestId("shooter")).toHaveText("Ana");
  await page.getByTestId("order-tank-1").click();
  const fort = crafted.players[1].units.find((u) => u.type === "fort") as Unit;
  const fc = centreOfUnit(fort);
  await tapMap(page, fc.x, fc.y);
  await expect(page.getByTestId("banner")).toContainText("You win");
  await page.getByTestId("see-results").click();
  await expect(page.getByTestId("strategic-reveal")).toBeVisible();
}

test("a Strategic game: build both bases, land on the map in fog, and take turns passing the phone", async ({ page }) => {
  await startNewGame(page, 11, ["Ana", "Ben"], "strategic");
  await expect(page.getByTestId("builder")).toHaveText("Ana");
  await expect(page.getByText(`Place ${ARMY_SIZE} more`)).toBeVisible();
  await page.getByTestId("random-layout").click();
  await page.getByTestId("done").click();
  await page.getByTestId("start").click();
  await page.getByTestId("random-layout").click();
  await page.getByTestId("done").click();

  // Both bases sit on one of the Large maps, each at a spot drawn from the valid spots of its own
  // half, with every unit inside its base.
  const built = await savedGame(page);
  expect(built.mode).toBe("strategic");
  expect(built.phase).toBe("handoff");
  const s = built.strategic!;
  expect(NEW_GAME_MAP_IDS).toContain(s.map);
  const map = mapOf(s.map);
  expect(map.size).toBe("large");
  for (const p of [0, 1] as const) {
    expect(validBaseSpots(map, p)).toContainEqual(s.bases[p]);
    expect(built.players[p].units.length).toBe(ARMY_SIZE);
    for (const u of built.players[p].units) expect(insideBase(u, s.bases[p])).toBe(true);
  }
  expect(s.explored[0].length).toBe(Math.ceil((map.w * map.h) / 4));

  // The first turns go straight to the turn screen: there is nothing yet to replay.
  await page.getByTestId("start").click();
  await expect(page.getByTestId("strategic-map")).toBeVisible();
  await expect(page.getByTestId("minimap")).toBeVisible();
  await expect(page.getByTestId("shooter")).toHaveText("Ana");
  await expect(page.getByTestId("turn")).toHaveText("Turn 1");
  await expect(page.locator("body")).toHaveAttribute("data-screen", "strategic");
  await expect(page.getByTestId("strategic-replay")).toHaveCount(0);
  const explored = await percentOf(page);
  expect(explored).toBeGreaterThan(0);
  expect(explored).toBeLessThan(100);
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
  // Each player's own units are drawn; no enemy has been seen, so no enemy base is outlined.
  await expect(page.locator(".strategic-units [data-unit]")).toHaveCount(ARMY_SIZE);
  await expect(page.locator(".strategic-enemies [data-unit]")).toHaveCount(0);
  await expect(page.locator(".strategic-enemy-base")).toHaveCount(0);

  // End turn: the phone goes to player 2, who is also on their first turn.
  await page.getByTestId("end-turn").click();
  await expect(page.getByTestId("handoff")).toContainText("Pass to Ben");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("shooter")).toHaveText("Ben");
  await expect(page.getByTestId("turn")).toHaveText("Turn 1");
  await expect(page.getByTestId("strategic-map")).toBeVisible();
  await expect(page.getByTestId("strategic-replay")).toHaveCount(0);

  // And back to player 1 for their second turn. Ben's units stayed out of her sight and her own
  // infantry only marched, which never opens a replay, so her turn screen comes up at once.
  await page.getByTestId("end-turn").click();
  await expect(page.getByTestId("handoff")).toContainText("Pass to Ana");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("shooter")).toHaveText("Ana");
  await expect(page.getByTestId("turn")).toHaveText("Turn 2");
  await expect(page.getByTestId("strategic-replay")).toHaveCount(0);
  expect((await savedGame(page)).turn).toBe(3);
});

test("Whole map shows the whole sheet and the mini-map jumps the view", async ({ page }) => {
  await startNewGame(page, 11, ["", ""], "strategic");
  await buildBothAndStart(page);
  const map = mapSize(await savedGame(page));

  // The turn opens zoomed in on the base: 38 px per square, so the view is 744 / 38 squares wide.
  const atBase = await viewBox(page);
  expect(atBase[2]).toBeCloseTo(744, 0);
  await expect(page.getByTestId("whole-map")).toHaveText("Whole map");

  // A tap at the right edge of the mini-map moves the view right at the same zoom.
  const mini = (await page.getByTestId("minimap").boundingBox())!;
  await page.mouse.click(mini.x + mini.width - 2, mini.y + mini.height / 2);
  const moved = await viewBox(page);
  expect(moved[0]).toBeGreaterThan(atBase[0]! + 100);
  expect(moved[2]).toBeCloseTo(atBase[2]!, 0);

  // Whole map: the viewBox is as wide as the map, and the button offers the way back.
  await page.getByTestId("whole-map").click();
  const whole = await viewBox(page);
  expect(Math.abs(whole[2]! - map.w * SQ_NEAR)).toBeLessThan(map.w * SQ_NEAR * 0.01);
  await expect(page.getByTestId("whole-map")).toHaveText("Zoom to base");
  // The mini-map would only repeat the whole map, over its corner: it steps aside until the view zooms in.
  await expect(page.getByTestId("minimap")).toBeHidden();
  await page.getByTestId("whole-map").click();
  expect((await viewBox(page))[2]).toBeCloseTo(744, 0);
  await expect(page.getByTestId("whole-map")).toHaveText("Whole map");
  await expect(page.getByTestId("minimap")).toBeVisible();
});

test("dragging the map past its edge and back follows the finger straight away", async ({ page }) => {
  await startNewGame(page, 11, ["", ""], "strategic");
  await buildBothAndStart(page);

  // The turn opens zoomed in on the base, 38 px per square: one world unit per stage px, so the viewBox
  // x reads directly as stage px of travel. The base lands anywhere in its half, so a tap on the
  // mini-map's left edge first brings the map's left edge against the view's left edge (viewBox x 0).
  const svg = (await page.getByTestId("strategic-map").boundingBox())!;
  const k = svg.width / 744; // the stage is CSS-scaled: screen px per stage px
  const mini = (await page.getByTestId("minimap").boundingBox())!;
  await page.mouse.click(mini.x + 2, mini.y + mini.height / 2);
  expect((await viewBox(page))[0]).toBe(0);
  expect((await viewBox(page))[2]).toBeCloseTo(744, 0);

  // Pulling the map rightwards asks for paper past the edge: the map stays put.
  const x0 = svg.x + svg.width / 2;
  const y0 = svg.y + svg.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 100, y0, { steps: 10 });
  expect((await viewBox(page))[0]).toBe(0);

  // Turning back 40 px moves the map 40 px at once, with no dead travel for the 100 px of overshoot.
  await page.mouse.move(x0 + 60, y0, { steps: 4 });
  const [x] = await viewBox(page);
  expect(Math.abs(x! - 40 / k)).toBeLessThan(1);
  await page.mouse.up();
});

test("a double tap on empty ground zooms in a step, while two taps on a unit only pick it", async ({ page }) => {
  await strategicGame(page, 11);
  const g = await savedGame(page);
  const base = g.strategic!.bases[0];
  // An empty square inside the base, which the opening view shows whole.
  let empty: { x: number; y: number } | null = null;
  for (let y = base.y; y < base.y + BASE.h && !empty; y++) {
    for (let x = base.x; x < base.x + BASE.w && !empty; x++) {
      if (!onAUnit(g.players[0].units, { x: x + 0.5, y: y + 0.5 })) empty = { x: x + 0.5, y: y + 0.5 };
    }
  }
  if (!empty) throw new Error("no empty square in the base");
  const before = await viewBox(page);
  const p = await mapPoint(page, empty.x, empty.y);
  await page.mouse.dblclick(p.x, p.y);
  const zoomed = await viewBox(page);
  expect(Math.abs(zoomed[2]! - before[2]! / 1.6)).toBeLessThan(1);
  await expect(page.locator(".order-row.selected")).toHaveCount(0);

  // Two quick taps on a tank pick it (and pick it again): no zoom.
  const tank = g.players[0].units.find((u) => u.id === "tank-1")!;
  const c = centreOfUnit(tank);
  const q = await mapPoint(page, c.x, c.y);
  await page.mouse.dblclick(q.x, q.y);
  await expect(page.getByTestId("order-tank-1")).toHaveClass(/selected/);
  expect((await viewBox(page))[2]).toBeCloseTo(zoomed[2]!, 0);
});

test("orders: pick a tank from the list, tap reachable ground to move it, and the infantry walk on their own", async ({ page }) => {
  const before = await strategicGame(page, 11, ["Ana", "Ben"]);
  await expect(page.locator("[data-testid^=order-]")).toHaveCount(4);
  for (const id of ["tank-1", "tank-2", "artillery-1", "truck-1"]) await expect(page.getByTestId(`order-${id}`)).toBeVisible();
  await expect(page.getByTestId("order-tank-1")).toContainText("Move");
  await expect(page.getByTestId("order-artillery-1")).toContainText("Stay");
  await expect(page.getByTestId("order-artillery-1")).toContainText("Fire");

  // The automatic step moved at least one infantry before the player saw the map.
  const atStart = await savedGame(page);
  const infantryAt = (g: Game) => g.players[0].units.filter((u) => u.type === "infantry").map((u) => `${u.x},${u.y}`);
  expect(infantryAt(atStart)).not.toEqual(infantryAt(before));

  // Picking the tank's row shows where it can go; tapping one of those squares moves it there.
  // A pick redraws only the marks and the panel: the map itself is the same drawing as before.
  const drawing = await page.getByTestId("strategic-map").elementHandle();
  await page.getByTestId("order-tank-1").click();
  await expect(page.getByTestId("order-tank-1")).toHaveClass(/selected/);
  await expect(page.locator(".strategic-reach")).toHaveCount(1);
  await expect(page.locator(".strategic-selected")).toHaveCount(1);
  expect(await drawing!.evaluate((svg) => svg.isConnected)).toBe(true);
  const reach = reachableFor(atStart, "tank-1");
  expect(reach.length).toBeGreaterThan(0);
  const to = reach[reach.length - 1]!;
  await tapMap(page, to.x + 1, to.y + 1);
  await expect(page.getByTestId("order-tank-1")).toContainText("Moved");
  await expect(page.getByTestId("result")).toContainText("Tank 1 moved");
  const moved = await savedGame(page);
  expect(moved.strategic!.orders["tank-1"]).toEqual({ moved: true, fired: false });
  const tank = moved.players[0].units.find((u) => u.id === "tank-1")!;
  expect({ x: tank.x, y: tank.y }).toEqual(to);
  // Still picked, but with nowhere left to go this turn.
  await expect(page.getByTestId("order-tank-1")).toHaveClass(/selected/);
  await expect(page.locator(".strategic-reach")).toHaveCount(0);

  // Player 2 gets their own orders; their first report may well be empty.
  await page.getByTestId("end-turn").click();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("shooter")).toHaveText("Ben");
  await expect(page.locator("[data-testid^=order-]")).toHaveCount(4);
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
});

test("artillery: aim too close for a tip, aim further out and fire a shell that drifts a little", async ({ page }) => {
  await strategicGame(page, 11);
  await page.getByTestId("order-artillery-1").click();
  await expect(page.getByTestId("order-artillery-1")).toHaveClass(/selected/);
  await expect(page.locator(".strategic-minrange")).toHaveCount(1);
  const g = await savedGame(page);
  const gun = g.players[0].units.find((u) => u.type === "artillery")!;

  // Within the minimum range: a tip, and nothing to fire.
  const map = mapSize(g);
  const near = tooClosePoint(g.players[0].units, gun, map);
  await tapMap(page, near.x, near.y);
  await expect(page.getByTestId("result")).toContainText("Too close");
  await expect(page.getByTestId("fire")).toHaveCount(0);
  await expect(page.locator(".strategic-aim")).toHaveCount(0);

  // Six squares toward the middle of the map: the aim shows and the Fire button appears.
  const c = centreOfUnit(gun);
  const dir = towardCentre(gun, map);
  const aim = { x: c.x + 6 * dir.x, y: c.y + 6 * dir.y };
  await tapMap(page, aim.x, aim.y);
  await expect(page.locator(".strategic-aim")).toHaveCount(1);
  await expect(page.getByTestId("fire")).toBeVisible();
  // The dashed ring shows how far this shell may drift.
  const ring = Number(await page.locator(".strategic-aim-shake").getAttribute("r")) / SQ_NEAR;
  expect(ring).toBeCloseTo(shakeRadius(distanceToRect(aim.x, aim.y, rectOf(gun))), 1);
  await page.getByTestId("fire").click();

  const after = await savedGame(page);
  expect(after.strategic!.shots).toHaveLength(1);
  const shot = after.strategic!.shots[0]!;
  expect(shot.by).toBe(0);
  expect(shot.weapon).toBe("shell");
  expect(Math.hypot(shot.aim.x - aim.x, shot.aim.y - aim.y)).toBeLessThan(0.15);
  // The drift grows a little with the range: this aim is about five squares from the gun's edge, so
  // a little under a square.
  const shake = shakeRadius(distanceToRect(shot.aim.x, shot.aim.y, rectOf(gun)));
  expect(shake).toBeGreaterThan(0.75);
  expect(shake).toBeLessThan(1);
  expect(Math.hypot(shot.x - shot.aim.x, shot.y - shot.aim.y)).toBeLessThanOrEqual(shake + 0.01);
  expect(after.strategic!.orders["artillery-1"]?.fired).toBe(true);
  await expect(page.getByTestId("order-artillery-1")).toContainText("Fired");
  await expect(page.locator(".strategic-shot")).toHaveCount(1);
  await expect(page.getByTestId("result")).toBeVisible();
  await expect(page.getByTestId("fire")).toHaveCount(0);
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
});

test("win and reveal: a tank shot fells the enemy fort, the banner says so, and the results screen lifts the fog", async ({ page }) => {
  const crafted = craftedWin();
  await page.goto("/");
  await page.evaluate((g) => localStorage.setItem("pencil-army-base:game", JSON.stringify(g)), crafted);
  await page.reload();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("handoff")).toContainText("Pass to Ana");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("shooter")).toHaveText("Ana");

  // The fort is in sight and in range, so picking the tank outlines it as a target.
  await page.getByTestId("order-tank-1").click();
  await expect(page.getByTestId("order-tank-1")).toContainText("Fire");
  expect(await page.locator(".strategic-target").count()).toBeGreaterThan(0);
  await expect(page.locator(".strategic-enemy-base")).toHaveCount(1);
  const fort = crafted.players[1].units.find((u) => u.type === "fort")!;
  const fc = centreOfUnit(fort);
  await tapMap(page, fc.x, fc.y);

  await expect(page.getByTestId("banner")).toContainText("You win");
  await expect(page.getByTestId("result")).toContainText("Destroyed enemy fort");
  const over = await savedGame(page);
  expect(over.phase).toBe("over");
  expect(over.winner).toBe(0);
  await expect(page.getByTestId("end-turn")).toHaveCount(0);
  await page.getByTestId("see-results").click();

  await expect(page.getByTestId("strategic-reveal")).toBeVisible();
  await expect(page.getByTestId("winner")).toHaveText("Ana wins!");
  await expect(page.getByTestId("reveal-stats")).toBeVisible();
  await expect(page.getByTestId("reveal-0")).toContainText("Ana");
  await expect(page.getByTestId("reveal-1")).toContainText("Ben");
  await expect(page.locator(".strategic-enemies [data-unit]")).toHaveCount(ARMY_SIZE);
  // Everything fits the stage.
  const stage = (await page.locator("#stage").boundingBox())!;
  for (const id of ["play-again", "main-menu", "reveal-stats"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height + 0.5);
  }
});

test("handover replay: Start shows what Ana's units saw of Ben's turn, and Start my turn opens her turn for good", async ({ page }) => {
  const crafted = craftedHandover();
  // What the rules will show once Start has run Ana's automatic phase, as the app does.
  const replay = replayFor(ok(confirmHandoff(crafted)));
  const texts = replay.steps.map((st) => st.text);
  const firstOwn = replay.steps.findIndex((st) => st.part === "own");
  const lineStep = replay.steps.findIndex((st) => st.marks.some((m) => m.kind === "shot" && m.from !== null));
  expect(replay.open).toBe(true);
  expect(replay.steps[0]!.part).toBe("enemy");
  expect(replay.steps[0]!.marks.some((m) => m.kind === "track")).toBe(true);
  expect(texts.some((t) => t.includes("shell"))).toBe(true);
  expect(lineStep).toBeGreaterThan(0);
  expect(firstOwn).toBeGreaterThan(lineStep);

  await continueSaved(page, crafted);
  await expect(page.getByTestId("handoff")).toContainText("Pass to Ana");
  await page.getByTestId("start").click();

  const screen = page.getByTestId("strategic-replay");
  await expect(screen).toBeVisible();
  await expect(screen).toHaveAttribute("data-mode", "handover");
  await expect(page.locator("body")).toHaveAttribute("data-screen", "strategic-replay");
  const steps = page.locator("[data-testid^=replay-step-]");
  await expect(steps).toHaveCount(texts.length);
  await expect(steps).toContainText(texts);
  await expect(page.getByTestId("replay-divider")).toHaveText("Start of your turn");
  await expect(page.getByTestId("replay-done")).toHaveText("Start my turn");

  // It plays by itself: the counter moves on without a tap.
  const counter = page.getByTestId("replay-counter");
  await expect(counter).toHaveText(new RegExp(`^Step \\d of ${texts.length}$`));
  const first = (await screen.getAttribute("data-step")) as string;
  await expect(screen).not.toHaveAttribute("data-step", first);
  expect(Number(await screen.getAttribute("data-step"))).toBeGreaterThan(Number(first));

  // Tapping step 1 shows it and pauses there: Ben's tank coming out of the fog, its track drawn.
  await page.getByTestId("replay-step-1").click();
  await expect(screen).toHaveAttribute("data-playing", "false");
  await expect(page.getByTestId("replay-step-1")).toHaveAttribute("aria-current", "step");
  await expect(counter).toHaveText(`Step 1 of ${texts.length}`);
  await expect(page.getByTestId("replay-chip")).toHaveText("Ben's turn");
  await expect(page.locator(".strategic-replay-track")).not.toHaveCount(0);

  // The tank's shot at Ana's unit, with a line from the tank she could see.
  await page.getByTestId(`replay-step-${lineStep + 1}`).click();
  await expect(page.locator(".strategic-replay-shot[data-from=seen] .strategic-replay-shot-line")).toHaveCount(1);

  // Her own start of turn comes after the divider; the Menu opening and closing keeps the step.
  await page.getByTestId(`replay-step-${firstOwn + 1}`).click();
  await expect(page.getByTestId("replay-chip")).toHaveText("Start of your turn");
  await page.getByTestId("menu-open").click();
  await expect(page.getByTestId("menu-overlay")).toBeVisible();
  await page.getByTestId("menu-resume").click();
  await expect(page.getByTestId(`replay-step-${firstOwn + 1}`)).toHaveAttribute("aria-current", "step");
  await expect(screen).toHaveAttribute("data-playing", "false");

  // Start my turn: the turn screen, and a re-render does not bring the replay back.
  await page.getByTestId("replay-done").click();
  await expect(page.getByTestId("shooter")).toHaveText("Ana");
  await expect(page.locator("body")).toHaveAttribute("data-screen", "strategic");
  await expect(screen).toHaveCount(0);
  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu-resume").click();
  await expect(page.getByTestId("shooter")).toHaveText("Ana");
  await expect(screen).toHaveCount(0);

  // A reload shows the replay again until she gives her first order; after that the turn opens straight away.
  await page.reload();
  await page.getByTestId("continue").click();
  await page.getByTestId("start").click();
  await expect(screen).toBeVisible();
  await page.getByTestId("replay-done").click();
  const atTurn = await savedGame(page);
  const to = reachableFor(atTurn, "tank-2").at(-1);
  if (!to) throw new Error("tank 2 has nowhere to go");
  await page.getByTestId("order-tank-2").click();
  await tapMap(page, to.x + 1, to.y + 1);
  await expect(page.getByTestId("order-tank-2")).toContainText("Moved");
  await page.reload();
  await page.getByTestId("continue").click();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("shooter")).toHaveText("Ana");
  await expect(screen).toHaveCount(0);
});

test("results: every unit's track on the revealed map, a Hits column, Save image and Watch the match", async ({ page }) => {
  const crafted = craftedWin(3);
  await winWithTank1(page, crafted);

  // The dotted tracks of every unit that moved, with the legend, and the name of the map.
  await expect(page.locator(".strategic-reveal path.strategic-track")).toHaveCount(unitTracks(crafted).length);
  await expect(page.getByTestId("reveal-legend")).toContainText("where units went");
  await expect(page.getByTestId("reveal-map-name")).toHaveText(`Map: ${mapOf(crafted.strategic!.map).name}`);

  // Hits between Shots and Explored: Ana's one shot hurt the fort, Ben never fired.
  await expect(page.locator("[data-testid=reveal-stats] th")).toHaveText(["", "Turns", "Lost", "Shots", "Hits", "Explored"]);
  await expect(page.locator("[data-testid=reveal-0] td").nth(3)).toHaveText("1");
  await expect(page.locator("[data-testid=reveal-0] td").nth(4)).toHaveText("1");
  await expect(page.locator("[data-testid=reveal-1] td").nth(4)).toHaveText("0");

  // Save image: this browser cannot share files, so the picture downloads.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save-image").click()]);
  expect(download.suggestedFilename()).toBe("pencil-army-base-strategic.png");
  const png = await readFile((await download.path()) as string);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(png.length).toBeGreaterThan(20_000);

  // Everything fits the stage, the four buttons included.
  const stage = (await page.locator("#stage").boundingBox())!;
  for (const id of ["play-again", "main-menu", "save-image", "watch-match", "reveal-stats", "reveal-map-name"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height + 0.5);
  }

  // Watch the match: one step per turn, played by itself with the fog lifted, stopping on the last.
  const turns = crafted.turn;
  await page.getByTestId("watch-match").click();
  const screen = page.getByTestId("strategic-replay");
  await expect(screen).toHaveAttribute("data-mode", "match");
  await expect(page.locator("body")).toHaveAttribute("data-screen", "strategic-replay");
  await expect(page.locator("[data-testid^=replay-step-]")).toHaveCount(turns);
  await expect(page.getByTestId("replay-step-1")).toHaveText("Turn 1 · Ana");
  await expect(page.getByTestId("replay-step-2")).toHaveText("Turn 1 · Ben");
  await expect(page.locator(".strategic-replay .strategic-enemies [data-unit]")).not.toHaveCount(0);
  // The counter counts steps, so it never clashes with the chip's per-player turn number.
  await expect(page.getByTestId("replay-counter")).toHaveText(`Step ${turns} of ${turns}`, { timeout: 15_000 });
  await expect(screen).toHaveAttribute("data-playing", "false");
  await expect(page.getByTestId("replay-chip")).toHaveText(`Turn ${(turns + 1) / 2} · Ana`);

  // Back to results.
  await expect(page.getByTestId("replay-done")).toHaveText("Back to results");
  await page.getByTestId("replay-done").click();
  await expect(page.getByTestId("strategic-reveal")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-screen", "over");

  // Watching again starts from the first turn.
  await page.getByTestId("watch-match").click();
  await expect(page.getByTestId("replay-step-1")).toHaveAttribute("aria-current", "step");
  await page.getByTestId("replay-done").click();
  await expect(page.getByTestId("strategic-reveal")).toBeVisible();
});

test("larger text still fits the replay panel", async ({ page }) => {
  await turnOnLargeText(page);
  await continueSaved(page, craftedHandover());
  await page.getByTestId("start").click();
  const screen = page.getByTestId("strategic-replay");
  await expect(screen).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/large-text/);
  expect(await panelFits(page)).toBeLessThanOrEqual(0);

  // No line is cut short: the step texts wrap, and the chip, counter and buttons hold their words.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll(".replay-step, .replay-chip, .replay-counter, .replay-title, [data-testid=replay-done], [data-testid=menu-open]")]
      .filter((e) => e.scrollWidth > e.clientWidth + 1)
      .map((e) => e.textContent),
  );
  expect(clipped).toEqual([]);

  // The list scrolls inside its own box: the last step, once picked, shows inside it.
  const count = await page.locator("[data-testid^=replay-step-]").count();
  const last = page.getByTestId(`replay-step-${count}`);
  await last.click();
  await expect(last).toHaveAttribute("aria-current", "step");
  const list = (await page.getByTestId("replay-list").boundingBox())!;
  const item = (await last.boundingBox())!;
  expect(item.y).toBeGreaterThanOrEqual(list.y - 0.5);
  expect(item.y + item.height).toBeLessThanOrEqual(list.y + list.height + 0.5);
  expect(await panelFits(page)).toBeLessThanOrEqual(0);

  // Every control stays inside the stage.
  const stage = (await page.locator("#stage").boundingBox())!;
  for (const id of ["replay-done", "menu-open", "replay-play", "replay-counter"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height + 0.5);
  }
});

test("larger text still fits the Strategic panels", async ({ page }) => {
  // Seeded like the other Strategic tests: with a random layout the aim below could land on one of
  // the player's own tanks, which a tap would pick instead of setting the aim.
  await page.goto("/?seed=11");
  await page.getByTestId("accessibility").click();
  await page.getByTestId("access-largeText").click();
  await expect(page.getByTestId("access-largeText")).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByTestId("new-game").click();
  await page.getByTestId("mode-select").selectOption("strategic");
  await page.getByTestId("opponent-share").click();
  await page.getByTestId("start-game").click();
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
  await buildBothAndStart(page);
  await expect(page.getByTestId("strategic-map")).toBeVisible();
  expect(await panelFits(page)).toBeLessThanOrEqual(0);

  // Player 1's second turn has a report (the fort sent out infantry), four orders, and after a shell a result line too.
  await page.getByTestId("end-turn").click();
  await page.getByTestId("start").click();
  await page.getByTestId("end-turn").click();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("turn")).toHaveText("Turn 2");
  await expect(page.getByTestId("report")).toContainText("sent out");
  await expect(page.locator("[data-testid^=order-]")).toHaveCount(4);
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
  await page.getByTestId("order-artillery-1").click();
  const g = await savedGame(page);
  const gun = g.players[0].units.find((u) => u.type === "artillery")!;
  const c = centreOfUnit(gun);
  const dir = towardCentre(gun, mapSize(g));
  await tapMap(page, c.x + 6 * dir.x, c.y + 6 * dir.y);
  await expect(page.getByTestId("fire")).toBeVisible();
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
  // The fullest the panel gets: the Fire button and a two-line tip at once.
  const near = tooClosePoint(g.players[0].units, gun, mapSize(g));
  await tapMap(page, near.x, near.y);
  await expect(page.getByTestId("result")).toContainText("Too close");
  await expect(page.getByTestId("fire")).toBeVisible();
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
  await page.getByTestId("fire").click();
  await expect(page.getByTestId("result")).toBeVisible();
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
  // Every panel control stays inside the stage.
  const stage = (await page.locator("#stage").boundingBox())!;
  for (const id of ["whole-map", "end-turn", "menu-open"]) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height + 0.5);
  }
});

test("picking Strategic rules out the computer opponent until another mode is picked", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await expect(page.getByTestId("opponent-computer")).toBeEnabled();
  await page.getByTestId("mode-select").selectOption("strategic");
  await expect(page.getByTestId("opponent-computer")).toBeDisabled();
  await expect(page.getByTestId("opponent-computer")).toContainText("Not in Strategic yet");
  await page.getByTestId("mode-select").selectOption("skirmish");
  await expect(page.getByTestId("opponent-computer")).toBeEnabled();
  await expect(page.getByTestId("opponent-computer")).not.toContainText("Not in Strategic yet");
});
