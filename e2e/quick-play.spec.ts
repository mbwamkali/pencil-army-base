import { expect, test, type Page } from "@playwright/test";
import { buildBothAndStart, centreOfUnit, gridPoint, savedGame, startNewGame, tapGrid } from "./helpers.ts";

async function trayTap(page: Page, type: string): Promise<void> {
  await page.getByTestId(`tray-${type}`).click();
}

test("tap a unit in the tray, then tap the map to place it; tap it again to put it back", async ({ page }) => {
  await startNewGame(page, 7);
  await trayTap(page, "fort");
  await expect(page.getByTestId("tray-fort")).toHaveClass(/selected/);
  await expect(page.getByTestId("placing")).toContainText("Fort");
  await tapGrid(page, 9.5, 4.5);
  let units = (await savedGame(page)).players[0].units;
  expect(units).toEqual([{ id: "fort-1", type: "fort", x: 8, y: 3, upright: false, hits: 0 }]);
  // Only one fort, so the pick clears once it is placed.
  await expect(page.getByTestId("tray-fort")).not.toHaveClass(/selected/);

  // Several tanks: the pick stays on until they are all placed.
  await trayTap(page, "tank");
  await tapGrid(page, 2, 2);
  await expect(page.getByTestId("tray-tank")).toHaveClass(/selected/);
  await tapGrid(page, 16, 7);
  units = (await savedGame(page)).players[0].units;
  expect(units.filter((u) => u.type === "tank")).toHaveLength(2);

  // Tapping the picked unit again unpicks it, and the map then ignores taps on empty paper.
  await trayTap(page, "infantry");
  await trayTap(page, "infantry");
  await expect(page.getByTestId("tray-infantry")).not.toHaveClass(/selected/);
  await tapGrid(page, 5.5, 8.5);
  expect((await savedGame(page)).players[0].units).toHaveLength(units.length);
});

test("each turn opens on the enemy base, after a short look at the last hit on your own base", async ({ page }) => {
  await startNewGame(page, 7);
  await buildBothAndStart(page);
  // First turn: nothing has hit you yet, so it starts on the enemy base.
  await expect(page.getByTestId("view-target")).toHaveClass(/\bon\b/);
  await tapGrid(page, 0.5, 0.5);
  await page.getByTestId("fire").click();
  await page.getByTestId("end-turn").click();
  await page.getByTestId("start").click();
  // Second player: their own base first, showing the shot that just landed, then the enemy base.
  await expect(page.getByTestId("view-mine")).toHaveClass(/\bon\b/);
  await expect(page.locator(".last-shot")).toHaveCount(1);
  await expect(page.getByTestId("view-target")).toHaveClass(/\bon\b/, { timeout: 4000 });
});

test("a double tap on the enemy base fires, and the Fire button still works", async ({ page }) => {
  await startNewGame(page, 7);
  await buildBothAndStart(page);
  const g = await savedGame(page);
  const foe = g.current === 0 ? 1 : 0;
  const c = centreOfUnit(g.players[foe]!.units.find((u) => u.type === "fort")!);
  const p = await gridPoint(page, c.x, c.y);
  await page.mouse.dblclick(p.x, p.y);
  await expect(page.getByTestId("result")).toHaveText("Fort damaged");
  expect((await savedGame(page)).players[g.current]!.shots).toHaveLength(1);

  // Next turn: a single tap only aims, and Fire shoots.
  await page.getByTestId("end-turn").click();
  await page.getByTestId("start").click();
  await page.getByTestId("view-target").click();
  await tapGrid(page, 0.5, 0.5);
  await page.waitForTimeout(500);
  await tapGrid(page, 0.5, 0.5);
  expect((await savedGame(page)).shotFired).toBe(false);
  await page.getByTestId("fire").click();
  expect((await savedGame(page)).shotFired).toBe(true);
});
