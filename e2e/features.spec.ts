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
    await page.getByTestId("mode-select").selectOption(mode);
    await page.getByTestId("opponent-share").click();
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

test("the main menu shows the version, and About has credits, the version and a privacy note", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("version")).toHaveText(/^Version \d+\.\d+\.\d+( dev (\d+|local))?$/);
  const version = (await page.getByTestId("version").innerText()).replace("Version ", "");
  await page.getByTestId("about").click();
  const about = page.getByTestId("about-screen");
  await expect(about).toContainText(`version ${version}`);
  await expect(about).toContainText("Credits");
  await expect(about).toContainText("collects nothing");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("menu")).toBeVisible();
});

test("Clear all removes every placed unit after asking, and can be cancelled", async ({ page }) => {
  await startNewGame(page, 7);
  await expect(page.getByTestId("clear-all")).toBeDisabled();
  await page.getByTestId("random-layout").click();
  await expect(page.locator("[data-unit]")).toHaveCount(17);
  await page.getByTestId("clear-all").click();
  await page.getByTestId("clear-keep").click();
  await expect(page.locator("[data-unit]")).toHaveCount(17);
  await page.getByTestId("clear-all").click();
  await page.getByTestId("clear-confirm").click();
  await expect(page.locator("[data-unit]")).toHaveCount(0);
  await expect(page.getByTestId("done")).toBeDisabled();
  expect((await savedGame(page)).players[0]!.units).toHaveLength(0);
  await expect(page.getByTestId("tray-fort")).toHaveAttribute("data-left", "1");
});

test("the end screen summarises shots, hit rate and points by unit type", async ({ page }) => {
  await startNewGame(page, 3, ["", ""], "skirmish");
  await buildBothAndStart(page);
  const hunter = (await savedGame(page)).current;
  await huntCore(page);
  const over = await savedGame(page);
  const row = page.getByTestId(`summary-${hunter}`);
  const shots = over.players[hunter]!.shots.length;
  await expect(row).toContainText(over.players[hunter]!.name);
  const cells = await row.locator("td").allInnerTexts();
  expect(cells[1]).toBe(String(shots));
  expect(cells[2]).toMatch(/^\d+%$/);
  // Fort 5 per hit twice, tank 3, artillery 3: at least 16 in all.
  expect(Number(cells.at(-1))).toBeGreaterThanOrEqual(16);
  await expect(page.getByTestId("summary")).toContainText("Hit rate");
});

test("Save image uses the share sheet when the browser can share files, and downloads otherwise", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      (window as unknown as { shared: unknown[] }).shared.push({ files: data?.files?.map((f) => f.name) });
    };
  });
  await startNewGame(page, 3, ["", ""], "skirmish");
  await buildBothAndStart(page);
  await huntCore(page);
  await page.getByTestId("save-image").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shared: unknown[] }).shared.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { shared: { files: string[] }[] }).shared[0]!.files)).toEqual([
    "pencil-army-base-battlefield.png",
  ]);
});

for (const large of [false, true]) {
  test(`the end screen buttons stay on screen${large ? " with larger text" : ""}`, async ({ page }) => {
    if (large) await turnOn(page, "largeText");
    await page.goto("/?seed=3");
    await page.getByTestId("new-game").click();
    await page.getByTestId("mode-select").selectOption("battle");
    await page.getByTestId("opponent-share").click();
    await page.getByTestId("start-game").click();
    await buildBothAndStart(page);
    await huntCore(page, { w: 20, h: 10 });
    const fit = await page.evaluate(() => {
      const stage = document.getElementById("stage")!.getBoundingClientRect();
      const btn = document.querySelector('[data-testid="save-image"]')!.getBoundingClientRect();
      return stage.bottom - btn.bottom;
    });
    expect(fit).toBeGreaterThanOrEqual(0);
  });

  test(`the shot result is fully visible in the panel${large ? " with larger text" : ""}`, async ({ page }) => {
    if (large) await turnOn(page, "largeText");
    await page.goto("/?seed=3");
    await page.getByTestId("new-game").click();
    await page.getByTestId("mode-select").selectOption("battle");
    await page.getByTestId("opponent-share").click();
    await page.getByTestId("start-game").click();
    await buildBothAndStart(page);
    await page.getByTestId("view-target").click();
    const g = await savedGame(page);
    const inf = g.players[g.current === 0 ? 1 : 0]!.units.find((u) => u.type === "infantry")!;
    await tapGrid(page, inf.x + 0.5, inf.y + 0.5);
    await page.getByTestId("fire").click();
    const gap = await page.evaluate(() => {
      const result = document.querySelector('[data-testid="result"]')!.getBoundingClientRect();
      const status = document.querySelector(".status")!.getBoundingClientRect();
      return status.bottom - result.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(-0.5);
  });
}

test("Copy layout and Paste layout bring back the same base, and a bad code shows an error", async ({ page }) => {
  await startNewGame(page, 5, ["", ""], "skirmish");
  await page.getByTestId("menu-open").click();
  await expect(page.getByTestId("menu-copy")).toBeDisabled();
  await page.getByTestId("menu-resume").click();

  await page.getByTestId("random-layout").click();
  const built = (await savedGame(page)).players[0]!.units;
  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu-copy").click();
  const code = await page.getByTestId("copy-code").inputValue();
  expect(code).toMatch(/^PAB1-[A-Za-z0-9_-]+$/);
  await page.getByTestId("copy-done").click();

  // A bad code is refused with a message and the base stays as it was.
  for (const junk of ["", "not a code", code.slice(0, -4)]) {
    await page.getByTestId("menu-open").click();
    await page.getByTestId("menu-paste").click();
    await page.getByTestId("paste-input").fill(junk);
    await page.getByTestId("paste-load").click();
    await expect(page.getByTestId("paste-error")).toBeVisible();
    await page.getByTestId("paste-cancel").click();
    await expect(page.getByTestId("menu-overlay")).toHaveCount(0);
    expect((await savedGame(page)).players[0]!.units).toEqual(built);
  }

  await page.getByTestId("clear-all").click();
  await page.getByTestId("clear-confirm").click();
  await expect(page.locator("[data-unit]")).toHaveCount(0);

  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu-paste").click();
  await page.getByTestId("paste-input").fill(code);
  await page.getByTestId("paste-load").click();
  await expect(page.getByTestId("menu-overlay")).toHaveCount(0);
  await expect(page.locator("[data-unit]")).toHaveCount(7);
  const byId = (us: { id: string }[]) => [...us].sort((a, b) => a.id.localeCompare(b.id));
  expect(byId((await savedGame(page)).players[0]!.units)).toEqual(byId(built));
  await expect(page.getByTestId("done")).toBeEnabled();
});

test("a code from another mode is refused by name", async ({ page }) => {
  await startNewGame(page, 5, ["", ""], "battle");
  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu-paste").click();
  await page.getByTestId("paste-input").fill("PAB1-WvZU0fhPsJpz7gA");
  await page.getByTestId("paste-load").click();
  await expect(page.getByTestId("paste-error")).toHaveText("That code is for Skirmish, but this game is Battle.");
  await expect(page.locator("[data-unit]")).toHaveCount(0);
});

test("Copy and Paste layout are only in the Menu while building", async ({ page }) => {
  await startNewGame(page, 7, ["", ""], "skirmish");
  await buildBothAndStart(page);
  await page.getByTestId("menu-open").click();
  await expect(page.getByTestId("menu-copy")).toHaveCount(0);
  await expect(page.getByTestId("menu-paste")).toHaveCount(0);
});
