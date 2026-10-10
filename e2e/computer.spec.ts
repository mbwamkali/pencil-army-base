import { expect, test, type Page } from "@playwright/test";
import { CORE, SMALL, centreOfUnit, savedGame, tapGrid } from "./helpers.ts";

async function startVsComputer(page: Page, seed = 7): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.getByTestId("new-game").click();
  await page.getByTestId("opponent-computer").click();
  await expect(page.getByTestId("name-2")).toHaveCount(0);
  await expect(page.getByText("Your name")).toBeVisible();
  await page.getByTestId("name-1").fill("Tester");
  await page.getByTestId("start-game").click();
  await page.getByTestId("random-layout").click();
  await page.getByTestId("done").click();
  await expect(page.getByTestId("handoff")).toHaveCount(0);
}

/** Waits until it is the human's turn (the computer shoots on its own after a short pause). */
async function waitForMyTurn(page: Page): Promise<void> {
  await expect(page.getByTestId("shooter")).toHaveText("Tester", { timeout: 5000 });
}

test("a single player game: the computer builds, shoots back, and the human can win with no handoff screens", async ({ page }) => {
  await startVsComputer(page, 3);
  for (let turn = 0; turn < 40; turn++) {
    await waitForMyTurn(page);
    const g = await savedGame(page);
    expect(g.ai).toBe(1);
    const target = g.players[1]!.units.find((u) => CORE.includes(u.type) && u.hits < (u.type === "fort" ? 2 : 1))!;
    const aim = centreOfUnit(target);
    await page.getByTestId("view-target").click();
    await tapGrid(page, aim.x, aim.y, SMALL);
    await page.getByTestId("fire").click();
    if ((await savedGame(page)).phase === "over") break;
    await page.getByTestId("end-turn").click();
    await expect(page.getByTestId("handoff")).toHaveCount(0);
    await expect(page.getByTestId("computer-status")).toBeVisible();
  }
  await page.getByTestId("see-results").click();
  await expect(page.getByTestId("winner")).toHaveText("Tester wins!");
  const over = await savedGame(page);
  // The computer took one shot per turn: never more shots than the human.
  expect(over.players[1]!.shots.length).toBeLessThanOrEqual(over.players[0]!.shots.length);
});

test("reloading during the computer's turn gives it exactly one shot", async ({ page }) => {
  await startVsComputer(page, 8);
  await waitForMyTurn(page);
  await page.getByTestId("view-target").click();
  await tapGrid(page, 0.5, 0.5, SMALL);
  await page.getByTestId("fire").click();
  const before = (await savedGame(page)).players[1]!.shots.length;
  await page.getByTestId("end-turn").click();
  await page.reload();
  await page.getByTestId("continue").click();
  await waitForMyTurn(page);
  const after = await savedGame(page);
  expect(after.players[1]!.shots.length).toBe(before + 1);
  expect(after.shotFired).toBe(false);
});

test("the Menu pauses the computer until it is closed", async ({ page }) => {
  await startVsComputer(page, 8);
  await waitForMyTurn(page);
  await page.getByTestId("view-target").click();
  await tapGrid(page, 0.5, 0.5, SMALL);
  await page.getByTestId("fire").click();
  const before = (await savedGame(page)).players[1]!.shots.length;
  await page.getByTestId("end-turn").click();
  await page.getByTestId("menu-open").click();
  await page.waitForTimeout(1500);
  expect((await savedGame(page)).players[1]!.shots.length).toBe(before);
  await page.getByTestId("menu-resume").click();
  await waitForMyTurn(page);
  expect((await savedGame(page)).players[1]!.shots.length).toBe(before + 1);
});

test("Share device games still use the handoff screen", async ({ page }) => {
  await page.goto("/?seed=7");
  await page.getByTestId("new-game").click();
  await expect(page.getByTestId("opponent")).toBeVisible();
  await page.getByTestId("opponent-share").click();
  await expect(page.getByTestId("name-2")).toBeVisible();
  await page.getByTestId("start-game").click();
  await page.getByTestId("random-layout").click();
  await page.getByTestId("done").click();
  await expect(page.getByTestId("handoff")).toBeVisible();
});

test("Back on Who's playing returns to the opponent choice", async ({ page }) => {
  await page.goto("/?seed=7");
  await page.getByTestId("new-game").click();
  await page.getByTestId("opponent-computer").click();
  await expect(page.getByTestId("setup")).toBeVisible();
  await page.getByTestId("back").click();
  await expect(page.getByTestId("opponent")).toBeVisible();
  await page.getByTestId("back").click();
  await expect(page.getByTestId("menu")).toBeVisible();
});
