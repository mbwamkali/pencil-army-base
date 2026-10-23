import { expect, test, type Page } from "@playwright/test";
import { buildBothAndStart, savedGame, startNewGame } from "./helpers.ts";

/** The Medium map and the Strategic base, in squares (see src/strategic/rules). */
const MAP = { w: 40, h: 20 };
const BASE = { w: 12, h: 6 };
/** World units per square in the map's SVG. */
const SQ_NEAR = 38;

const SIZE: Record<string, [number, number]> = { fort: [3, 3], tank: [2, 2], artillery: [2, 2], infantry: [1, 1], wall: [2, 1] };

const viewBox = async (page: Page): Promise<number[]> =>
  ((await page.getByTestId("strategic-map").getAttribute("viewBox")) as string).split(" ").map(Number);

const percentOf = async (page: Page): Promise<number> => Number(((await page.getByTestId("explored").textContent()) ?? "").replace(/\D/g, ""));

const panelFits = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector(".panel") as HTMLElement;
    return panel.scrollHeight - panel.clientHeight;
  });

test("a Strategic game: build both bases, land on the map in fog, and take turns passing the phone", async ({ page }) => {
  await startNewGame(page, 11, ["Ana", "Ben"], "strategic");
  await expect(page.getByTestId("builder")).toHaveText("Ana");
  await expect(page.getByText("Place 8 more")).toBeVisible();
  await buildBothAndStart(page);

  await expect(page.getByTestId("strategic-map")).toBeVisible();
  await expect(page.getByTestId("minimap")).toBeVisible();
  await expect(page.getByTestId("shooter")).toHaveText("Ana");
  await expect(page.getByTestId("turn")).toHaveText("Turn 1");
  const explored = await percentOf(page);
  expect(explored).toBeGreaterThan(0);
  expect(explored).toBeLessThan(100);
  await expect(page.getByTestId("enemy-base")).toContainText("not found yet");
  expect(await panelFits(page)).toBeLessThanOrEqual(0);

  // Both bases sit on the map, player 2's at player 1's spot turned half a circle, with every unit inside its base.
  const g = await savedGame(page);
  expect(g.mode).toBe("strategic");
  const s = g.strategic!;
  expect(s.map).toBe("medium-1");
  expect(s.bases[1].x).toBe(MAP.w - BASE.w - s.bases[0].x);
  expect(s.bases[1].y).toBe(MAP.h - BASE.h - s.bases[0].y);
  for (const p of [0, 1] as const) {
    const base = s.bases[p];
    expect(g.players[p].units.length).toBe(8);
    for (const u of g.players[p].units) {
      const [w, h] = SIZE[u.type] as [number, number];
      const [rw, rh] = u.type === "wall" && u.upright ? [h, w] : [w, h];
      expect(u.x).toBeGreaterThanOrEqual(base.x);
      expect(u.y).toBeGreaterThanOrEqual(base.y);
      expect(u.x + rw).toBeLessThanOrEqual(base.x + BASE.w);
      expect(u.y + rh).toBeLessThanOrEqual(base.y + BASE.h);
    }
  }
  // Each player's own base is explored and their units are drawn; no enemy has been seen.
  expect(s.explored[0].length).toBe(Math.ceil((MAP.w * MAP.h) / 4));
  await expect(page.locator(".strategic-units [data-unit]")).toHaveCount(8);
  await expect(page.locator(".strategic-enemies [data-unit]")).toHaveCount(0);

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

test("larger text still fits the Strategic panels", async ({ page }) => {
  await page.goto("/");
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
