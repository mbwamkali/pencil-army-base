import { expect, test, type Page } from "@playwright/test";
import { buildBothAndStart, huntCore, savedGame, startNewGame, tapGrid, type ModeName } from "./helpers.ts";

const panelOverflow = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector(".panel") as HTMLElement;
    return panel.scrollHeight - panel.clientHeight;
  });

async function turnOn(page: Page, id: "largeText" | "clearMarkers"): Promise<void> {
  await page.goto("/");
  await page.getByTestId("accessibility").click();
  await page.getByTestId(`access-${id}`).click();
  await expect(page.getByTestId(`access-${id}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Back" }).click();
}

test("Player 1's army is drawn as it is and Player 2's is mirrored", async ({ page }) => {
  await startNewGame(page, 7);
  const first = (await savedGame(page)).building;
  await page.getByTestId("random-layout").click();
  const transforms = () => page.locator("[data-unit]").evaluateAll((els) => els.map((e) => e.getAttribute("transform")));
  const one = await transforms();
  expect(one).toHaveLength(17);
  await page.getByTestId("done").click();
  await page.getByTestId("start").click();
  await page.getByTestId("random-layout").click();
  const two = await transforms();
  expect(two).toHaveLength(17);
  const [mine, theirs] = first === 0 ? [one, two] : [two, one];
  expect(mine.every((t) => t === null)).toBe(true);
  expect(theirs.every((t) => t !== null && t.includes("scale(-1 1)"))).toBe(true);
});

test("clear markers add a cross for a hit and a ring for a miss, and are off by default", async ({ page }) => {
  await startNewGame(page, 7);
  await buildBothAndStart(page);
  await page.getByTestId("view-target").click();
  await tapGrid(page, 0.6, 0.6);
  await page.getByTestId("fire").click();
  await expect(page.locator(".mark-hit, .mark-miss")).toHaveCount(0);

  await turnOn(page, "clearMarkers");
  await page.getByTestId("continue").click();
  await page.getByTestId("start").click();
  await page.getByTestId("view-target").click();
  await expect(page.locator(".mark-miss")).toHaveCount(1);
  expect(await page.evaluate(() => document.body.classList.contains("clear-markers"))).toBe(true);
  // The choice is remembered after a reload.
  await page.reload();
  expect(await page.evaluate(() => document.body.classList.contains("clear-markers"))).toBe(true);
});

for (const mode of ["skirmish", "battle", "score"] as ModeName[]) {
  test(`larger text still fits the ${mode} panels`, async ({ page }) => {
    await turnOn(page, "largeText");
    expect(await page.evaluate(() => document.body.classList.contains("large-text"))).toBe(true);
    await page.getByTestId("new-game").click();
    await page.getByTestId(`mode-${mode}`).click();
    await page.getByTestId("start-game").click();
    expect(await panelOverflow(page)).toBeLessThanOrEqual(0);
    await buildBothAndStart(page);
    expect(await panelOverflow(page)).toBeLessThanOrEqual(0);
    await page.getByTestId("view-target").click();
    expect(await panelOverflow(page)).toBeLessThanOrEqual(0);
    await tapGrid(page, 3, 3, mode === "skirmish" ? { w: 12, h: 6 } : { w: 20, h: 10 });
    await page.getByTestId("fire").click();
    expect(await panelOverflow(page)).toBeLessThanOrEqual(0);
  });
}

test("the end screen saves an image of the final battlefield", async ({ page }) => {
  await startNewGame(page, 3, ["", ""], "skirmish");
  await buildBothAndStart(page);
  await huntCore(page);
  await expect(page.getByTestId("game-over")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("save-image").click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const path = await download.path();
  const { statSync, readFileSync } = await import("node:fs");
  expect(statSync(path).size).toBeGreaterThan(20_000);
  // PNG signature.
  expect([...readFileSync(path).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});
