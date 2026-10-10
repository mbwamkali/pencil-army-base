import { expect, test, type Page } from "@playwright/test";
import { POINTS } from "../src/rules/modes.ts";
import { SMALL, buildBothAndStart, centreOfUnit, savedGame, startNewGame, tapGrid, type ModeName } from "./helpers.ts";

const CORE = ["fort", "tank", "artillery"];

/** The first player keeps shooting at a fort, tank or artillery; the other fires into an empty corner. */
async function huntCore(page: Page, grid = SMALL, only: string[] = CORE, maxShots = 60): Promise<number> {
  const hunter = (await savedGame(page)).current;
  let shots = 0;
  while (shots < maxShots) {
    const g = await savedGame(page);
    const foe = g.current === 0 ? 1 : 0;
    await page.getByTestId("view-target").click();
    let aim = { x: grid.w - 0.5, y: grid.h - 0.5 };
    if (g.current === hunter) {
      const target = g.players[foe]!.units.find((u) => only.includes(u.type) && u.hits < (u.type === "fort" ? 2 : 1))!;
      aim = centreOfUnit(target);
    }
    await tapGrid(page, aim.x, aim.y, grid);
    await page.getByTestId("fire").click();
    shots++;
    if ((await savedGame(page)).phase === "over") {
      await page.getByTestId("see-results").click();
      return shots;
    }
    await page.getByTestId("end-turn").click();
    await page.getByTestId("start").click();
  }
  throw new Error("the game did not end");
}

const panelFits = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector(".panel") as HTMLElement;
    return panel.scrollHeight - panel.clientHeight;
  });

test("Skirmish is the default mode on the setup screen, and each mode shows what it is", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await expect(page.getByTestId("mode-skirmish")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mode-blurb")).toContainText("Small army");
  await page.getByTestId("mode-score").click();
  await expect(page.getByTestId("mode-score")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("mode-skirmish")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("mode-blurb")).toContainText("20 shots each");
  await page.getByTestId("mode-battle").click();
  await expect(page.getByTestId("mode-blurb")).toContainText("Infantry are optional");
  // Starting without touching the picker uses the default.
  await page.goto("/");
  await page.getByTestId("new-game").click();
  await page.getByTestId("start-game").click();
  expect((await savedGame(page)).mode).toBe("skirmish");
});

test("a Skirmish army has 7 units, and its smaller board fills the same space as a full one", async ({ page }) => {
  await startNewGame(page, 7, ["", ""], "battle");
  const full = await page.getByTestId("board").boundingBox();
  await page.goto("/?seed=7");
  await startNewGame(page, 7, ["", ""], "skirmish");
  const small = await page.getByTestId("board").boundingBox();
  expect(Math.abs(small!.width - full!.width)).toBeLessThan(1);
  expect(Math.abs(small!.height - full!.height)).toBeLessThan(1);
  await expect(page.getByTestId("tray-tank")).toHaveAttribute("data-left", "1");
  await expect(page.getByTestId("tray-infantry")).toHaveAttribute("data-left", "2");
  await expect(page.getByTestId("tray-wall")).toHaveAttribute("data-left", "2");
  await expect(page.getByText("Place 7 more")).toBeVisible();
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
  await page.getByTestId("random-layout").click();
  await expect(page.locator("[data-unit]")).toHaveCount(7);
  await expect(page.getByTestId("done")).toBeEnabled();
});

test("a Skirmish game is won by destroying the fort, tank and artillery, with points shown", async ({ page }) => {
  await startNewGame(page, 3, ["", ""], "skirmish");
  await buildBothAndStart(page);
  await expect(page.getByTestId("counter-you")).toContainText("5 / 5");
  await expect(page.getByTestId("points")).toContainText("0 : 0");
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
  const hunter = (await savedGame(page)).current;
  await huntCore(page);
  const over = await savedGame(page);
  expect(over.winner).toBe(hunter);
  await expect(page.getByTestId("game-over")).toBeVisible();
  await expect(page.getByTestId("winner")).toContainText("wins");
  // The fort alone is worth 10 points and the tank and artillery 6 more, so the winner has at least 16.
  const points = over.players[hunter]!.shots.reduce((n, s) => n + s.hits.reduce((m, h) => m + (POINTS[h.type] ?? 0), 0), 0);
  expect(points).toBeGreaterThanOrEqual(16);
  await expect(page.getByTestId("game-over")).toContainText(`${points} points`);
});

test("points go up as units are hit, and the panel keeps room for them", async ({ page }) => {
  await startNewGame(page, 3, ["", ""], "skirmish");
  await buildBothAndStart(page);
  const g = await savedGame(page);
  const foe = g.current === 0 ? 1 : 0;
  const tank = g.players[foe]!.units.find((u) => u.type === "tank")!;
  await page.getByTestId("view-target").click();
  const c = centreOfUnit(tank);
  await tapGrid(page, c.x, c.y, SMALL);
  await page.getByTestId("fire").click();
  await expect(page.getByTestId("result")).toBeVisible();
  const after = await savedGame(page);
  const expected = after.players[g.current]!.shots[0]!.hits.reduce((n, h) => n + (POINTS[h.type] ?? 0), 0);
  expect(expected).toBeGreaterThanOrEqual(3); // with this seed the tank is unguarded
  await expect(page.getByTestId("points-you")).toHaveText(String(expected));
  await expect(page.getByTestId("points-enemy")).toHaveText("0");
  expect(await panelFits(page)).toBeLessThanOrEqual(0);
});

for (const mode of ["battle", "score"] as ModeName[]) {
  test(`${mode} uses the full army and board, and the panel fits`, async ({ page }) => {
    await startNewGame(page, 5, ["", ""], mode);
    await expect(page.getByText("Place 17 more")).toBeVisible();
    expect(await panelFits(page)).toBeLessThanOrEqual(0);
    await buildBothAndStart(page);
    await expect(page.getByTestId("counter-you")).toContainText("13 / 13");
    await expect(page.getByTestId("points")).toBeVisible();
    expect(await panelFits(page)).toBeLessThanOrEqual(0);
    expect((await savedGame(page)).mode).toBe(mode);
  });
}

test("Battle ends without destroying infantry", async ({ page }) => {
  await startNewGame(page, 9, ["", ""], "battle");
  await buildBothAndStart(page);
  const hunter = (await savedGame(page)).current;
  await huntCore(page, { w: 20, h: 10 }, CORE, 80);
  const over = await savedGame(page);
  expect(over.winner).toBe(hunter);
  const foe = hunter === 0 ? 1 : 0;
  expect(over.players[foe]!.units.some((u) => u.type === "infantry" && u.hits === 0)).toBe(true);
});

test("Score attack counts shots, and the game lasts 20 shots each", async ({ page }) => {
  await startNewGame(page, 5, ["", ""], "score");
  await buildBothAndStart(page);
  await expect(page.getByTestId("turn")).toHaveText("Shot 1 of 20");
  await page.getByTestId("view-target").click();
  await tapGrid(page, 19.5, 9.5);
  await page.getByTestId("fire").click();
  await expect(page.getByTestId("turn")).toHaveText("Shot 1 of 20");
  await page.getByTestId("end-turn").click();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("turn")).toHaveText("Shot 1 of 20");
  // Fire the remaining shots into the corner: 40 in all, and then the game ends.
  for (let i = 0; i < 39; i++) {
    await page.getByTestId("view-target").click();
    await tapGrid(page, 19.5, 9.5);
    await page.getByTestId("fire").click();
    if ((await savedGame(page)).phase === "over") break;
    await page.getByTestId("end-turn").click();
    await page.getByTestId("start").click();
  }
  const over = await savedGame(page);
  expect(over.phase).toBe("over");
  expect(over.players[0]!.shots).toHaveLength(20);
  expect(over.players[1]!.shots).toHaveLength(20);
});
