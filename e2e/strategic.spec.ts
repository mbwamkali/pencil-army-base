import { expect, test, type Page } from "@playwright/test";
import { confirmHandoff, createGame, finishBuild, randomLayout, rectOf, type Game, type Unit } from "../src/rules/index.ts";
import { HP, distanceToRect, footprintAt, isFree, mapOf, reachableFor, shakeRadius, squareDistance } from "../src/strategic/rules/index.ts";
import { buildBothAndStart, centreOfUnit, mapPoint, savedGame, startNewGame, strategicGame, tapMap } from "./helpers.ts";

/** The Medium map and the Strategic base, in squares (see src/strategic/rules). */
const MAP = { w: 40, h: 20 };
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

/** The way from a unit's centre toward the middle of the map, as a unit vector. */
function towardCentre(u: Unit): { x: number; y: number } {
  const c = centreOfUnit(u);
  const dx = MAP.w / 2 - c.x;
  const dy = MAP.h / 2 - c.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: dx / d, y: dy / d };
}

/** An empty point one to three squares from an artillery piece: too close for a shell, with nothing to pick there. */
function tooClosePoint(units: readonly Unit[], gun: Unit): { x: number; y: number } {
  const c = centreOfUnit(gun);
  const rect = rectOf(gun);
  for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 8) {
    for (let t = 2.5; t <= 3.5; t += 0.25) {
      const p = { x: c.x + t * Math.cos(angle), y: c.y + t * Math.sin(angle) };
      const d = distanceToRect(p.x, p.y, rect);
      if (p.x < 0.5 || p.y < 0.5 || p.x > MAP.w - 0.5 || p.y > MAP.h - 0.5) continue;
      if (d >= 1 && d < 2.9 && !onAUnit(units, p)) return p;
    }
  }
  throw new Error("no empty square near the artillery");
}

/**
 * A Strategic game on the brink of its end, built through the rules: both bases random, player 1 at
 * their first turn (the automatic phase already run), their tank 1 lifted beside the enemy fort,
 * which has one hit point left. One tank shot wins.
 */
function craftedWin(): Game {
  let g = createGame({ seed: 5, names: ["Ana", "Ben"], mode: "strategic" });
  g = randomLayout(g, 0);
  g = ok(finishBuild(g, 0));
  g = ok(confirmHandoff(g));
  g = randomLayout(g, 1);
  g = ok(finishBuild(g, 1));
  g = ok(confirmHandoff(g));
  const s = g.strategic;
  if (!s) throw new Error("no Strategic state");
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
  s.autoDoneTurn = g.turn;
  return g;
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

  // Both bases sit on the map, player 2's at player 1's spot turned half a circle, with every unit inside its base.
  const built = await savedGame(page);
  expect(built.mode).toBe("strategic");
  expect(built.phase).toBe("handoff");
  const s = built.strategic!;
  expect(s.map).toBe("medium-1");
  expect(s.bases[1].x).toBe(MAP.w - BASE.w - s.bases[0].x);
  expect(s.bases[1].y).toBe(MAP.h - BASE.h - s.bases[0].y);
  for (const p of [0, 1] as const) {
    expect(built.players[p].units.length).toBe(ARMY_SIZE);
    for (const u of built.players[p].units) expect(insideBase(u, s.bases[p])).toBe(true);
  }
  expect(s.explored[0].length).toBe(Math.ceil((MAP.w * MAP.h) / 4));

  await page.getByTestId("start").click();
  await expect(page.getByTestId("strategic-map")).toBeVisible();
  await expect(page.getByTestId("minimap")).toBeVisible();
  await expect(page.getByTestId("shooter")).toHaveText("Ana");
  await expect(page.getByTestId("turn")).toHaveText("Turn 1");
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

  // And back to player 1 for their second turn.
  await page.getByTestId("end-turn").click();
  await expect(page.getByTestId("handoff")).toContainText("Pass to Ana");
  await page.getByTestId("start").click();
  await expect(page.getByTestId("shooter")).toHaveText("Ana");
  await expect(page.getByTestId("turn")).toHaveText("Turn 2");
  expect((await savedGame(page)).turn).toBe(3);
});

test("Whole map shows the whole sheet and the mini-map jumps the view", async ({ page }) => {
  await startNewGame(page, 11, ["", ""], "strategic");
  await buildBothAndStart(page);

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
  expect(Math.abs(whole[2]! - MAP.w * SQ_NEAR)).toBeLessThan(MAP.w * SQ_NEAR * 0.01);
  await expect(page.getByTestId("whole-map")).toHaveText("Zoom to base");
  await page.getByTestId("whole-map").click();
  expect((await viewBox(page))[2]).toBeCloseTo(744, 0);
  await expect(page.getByTestId("whole-map")).toHaveText("Whole map");
});

test("dragging the map past its edge and back follows the finger straight away", async ({ page }) => {
  await startNewGame(page, 11, ["", ""], "strategic");
  await buildBothAndStart(page);

  // The turn opens with the map's left edge against the view's left edge (viewBox x 0), 38 px per square:
  // one world unit per stage px, so the viewBox x reads directly as stage px of travel.
  const svg = (await page.getByTestId("strategic-map").boundingBox())!;
  const k = svg.width / 744; // the stage is CSS-scaled: screen px per stage px
  expect((await viewBox(page))[0]).toBe(0);

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
  await page.getByTestId("order-tank-1").click();
  await expect(page.getByTestId("order-tank-1")).toHaveClass(/selected/);
  await expect(page.locator(".strategic-reach")).toHaveCount(1);
  await expect(page.locator(".strategic-selected")).toHaveCount(1);
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
  const near = tooClosePoint(g.players[0].units, gun);
  await tapMap(page, near.x, near.y);
  await expect(page.getByTestId("result")).toContainText("Too close");
  await expect(page.getByTestId("fire")).toHaveCount(0);
  await expect(page.locator(".strategic-aim")).toHaveCount(0);

  // Six squares toward the middle of the map: the aim shows and the Fire button appears.
  const c = centreOfUnit(gun);
  const dir = towardCentre(gun);
  const aim = { x: c.x + 6 * dir.x, y: c.y + 6 * dir.y };
  await tapMap(page, aim.x, aim.y);
  await expect(page.locator(".strategic-aim")).toHaveCount(1);
  await expect(page.getByTestId("fire")).toBeVisible();
  await page.getByTestId("fire").click();

  const after = await savedGame(page);
  expect(after.strategic!.shots).toHaveLength(1);
  const shot = after.strategic!.shots[0]!;
  expect(shot.by).toBe(0);
  expect(shot.weapon).toBe("shell");
  expect(Math.hypot(shot.aim.x - aim.x, shot.aim.y - aim.y)).toBeLessThan(0.15);
  // The shake grows with the range: this aim is about six squares out, so a little over two squares.
  const shake = shakeRadius(distanceToRect(shot.aim.x, shot.aim.y, rectOf(gun)));
  expect(shake).toBeGreaterThan(1.5);
  expect(shake).toBeLessThan(3.5);
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
  const dir = towardCentre(gun);
  await tapMap(page, c.x + 6 * dir.x, c.y + 6 * dir.y);
  await expect(page.getByTestId("fire")).toBeVisible();
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
  // The fullest the panel gets: the Fire button and a two-line tip at once.
  const near = tooClosePoint(g.players[0].units, gun);
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
