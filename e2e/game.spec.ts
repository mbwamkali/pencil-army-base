import { expect, test } from "@playwright/test";
import { buildBothAndStart, centreOfUnit, savedGame, startNewGame, tapGrid } from "./helpers.ts";

test("the menu opens How to play and explains that walls don't count", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("menu")).toBeVisible();
  await expect(page.getByTestId("continue")).toHaveCount(0);
  await page.getByTestId("how-to-play").click();
  await expect(page.getByTestId("how-to-play-screen")).toContainText("Walls don't count");
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("menu")).toBeVisible();
});

test("setup shows two different pencil names already filled in, and Shuffle changes one without typing", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-game").click();
  const one = page.getByTestId("name-1");
  const two = page.getByTestId("name-2");
  await expect(one).not.toHaveValue("");
  await expect(two).not.toHaveValue("");
  expect(await one.inputValue()).not.toBe(await two.inputValue());
  for (let i = 0; i < 5; i++) {
    const before = await one.inputValue();
    await page.getByTestId("shuffle-1").click();
    await expect(one).not.toHaveValue(before);
    expect(await one.inputValue()).not.toBe(await two.inputValue());
  }
  const keep = await two.inputValue();
  await page.getByTestId("start-game").click();
  const names = (await savedGame(page)).players.map((p) => p.name);
  expect(names[1]).toBe(keep);
});

test("names default to two different pencil officers and typed names are kept", async ({ page }) => {
  await startNewGame(page, 3);
  const first = (await savedGame(page)).players.map((p) => p.name);
  expect(first[0]).not.toBe(first[1]);
  await page.goto("/?seed=3");
  await page.getByTestId("new-game").click();
  await page.getByTestId("name-1").fill("Ana");
  await page.getByTestId("start-game").click();
  await expect(page.getByTestId("builder")).toHaveText("Ana");
});

test("a whole game: build, hand off, fire, end turn, win, play again", async ({ page }) => {
  await startNewGame(page, 7);
  await buildBothAndStart(page);

  const first = await savedGame(page);
  const hunter = first.current;
  let shots = 0;
  for (;;) {
    const g = await savedGame(page);
    const foe = g.current === 0 ? 1 : 0;
    await page.getByTestId("view-target").click();
    let aim = { x: 5.5, y: 5.5 };
    if (g.current === hunter) {
      const target = g.players[foe]!.units.find((u) => u.type !== "wall" && u.hits < (u.type === "fort" ? 2 : 1))!;
      aim = centreOfUnit(target);
    }
    await tapGrid(page, aim.x, aim.y);
    await expect(page.getByTestId("fire")).toBeEnabled();
    await page.getByTestId("fire").click();
    shots++;
    // Only one shot per turn: Fire is gone, End turn (or See results) replaces it.
    await expect(page.getByTestId("fire")).toHaveCount(0);
    if ((await savedGame(page)).phase === "over") {
      await page.getByTestId("see-results").click();
      break;
    }
    await page.getByTestId("end-turn").click();
    // The black handoff screen shows no board at all.
    await expect(page.getByTestId("handoff")).toBeVisible();
    await expect(page.getByTestId("board")).toHaveCount(0);
    await expect(page.locator("body")).toHaveAttribute("data-screen", "handoff");
    await page.getByTestId("start").click();
  }
  const over = await savedGame(page);
  expect(over.winner).toBe(hunter);
  await expect(page.getByTestId("game-over")).toBeVisible();
  await expect(page.getByTestId("winner")).toContainText(`${over.players[hunter]!.name} wins`);
  expect(shots).toBeGreaterThan(13);

  await page.getByTestId("play-again").click();
  await expect(page.getByTestId("setup")).toBeVisible();
  await page.getByTestId("start-game").click();
  await expect(page.getByTestId("builder")).toBeVisible();
  expect((await savedGame(page)).phase).toBe("build");
});

test("the Target view never shows an undamaged enemy unit", async ({ page }) => {
  await startNewGame(page, 11);
  await buildBothAndStart(page);
  await page.getByTestId("view-target").click();
  await expect(page.locator("[data-unit]")).toHaveCount(0);

  // Hit an infantry unit and a fort: only destroyed units and the damaged fort appear.
  const g = await savedGame(page);
  const foe = g.current === 0 ? 1 : 0;
  const fort = g.players[foe]!.units.find((u) => u.type === "fort")!;
  const c = centreOfUnit(fort);
  await tapGrid(page, c.x, c.y);
  await page.getByTestId("fire").click();
  await expect(page.getByTestId("result")).toHaveText("Fort damaged");
  const states = await page.locator("[data-unit]").evaluateAll((els) => els.map((e) => e.getAttribute("data-state")));
  expect(states).toEqual(["damaged"]);
});

test("the counters show what is left to destroy, with infantry beneath, and drop as units die", async ({ page }) => {
  await startNewGame(page, 7);
  await buildBothAndStart(page);
  await expect(page.getByTestId("counter-you")).toContainText("7 / 7");
  await expect(page.getByTestId("counter-enemy")).toContainText("7 / 7");
  await expect(page.getByTestId("infantry-enemy")).toHaveText("+ 6 infantry");
  const g = await savedGame(page);
  const foe = g.current === 0 ? 1 : 0;
  const tank = g.players[foe]!.units.find((u) => u.type === "tank")!;
  await page.getByTestId("view-target").click();
  const c = centreOfUnit(tank);
  await tapGrid(page, c.x, c.y);
  await page.getByTestId("fire").click();
  const result = await page.getByTestId("result").innerText();
  expect(result).toMatch(/Destroyed: Tank|Wall hit/);
  // One shot can catch several units, so count what the rules say is dead.
  const after = await savedGame(page);
  const units = after.players[foe]!.units;
  const core = units.filter((u) => ["tank", "artillery", "fort"].includes(u.type) && u.hits < (u.type === "fort" ? 2 : 1)).length;
  const infantry = units.filter((u) => u.type === "infantry" && u.hits < 1).length;
  expect(core).toBeLessThanOrEqual(result.startsWith("Destroyed") ? 6 : 7);
  await expect(page.getByTestId("counter-enemy")).toContainText(`${core} / 7`);
  await expect(page.getByTestId("infantry-enemy")).toHaveText(`+ ${infantry} infantry`);
  await page.getByTestId("counter-enemy").click();
  await expect(page.getByTestId("breakdown")).toContainText("Walls left");
});

test("a game in progress survives a refresh and covers the base until the player taps Start", async ({ page }) => {
  await startNewGame(page, 7);
  await buildBothAndStart(page);
  const before = await savedGame(page);
  await page.reload();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("handoff")).toBeVisible();
  await expect(page.getByTestId("board")).toHaveCount(0);
  await page.getByTestId("start").click();
  await expect(page.getByTestId("shooter")).toHaveText(before.players[before.current]!.name);
});

test("held upright, the game asks the player to turn the phone", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 923 });
  await page.goto("/");
  await expect(page.locator("#rotate")).toBeVisible();
  await page.setViewportSize({ width: 923, height: 412 });
  await expect(page.locator("#rotate")).toBeHidden();
});

test("the game keeps a margin from the screen edges so rounded phone corners do not cut it off", async ({ page }) => {
  await page.goto("/");
  const box = await page.locator("#stage").boundingBox();
  const size = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(15.5);
  expect(box!.y).toBeGreaterThanOrEqual(15.5);
  expect(size.width - (box!.x + box!.width)).toBeGreaterThanOrEqual(15.5);
  expect(size.height - (box!.y + box!.height)).toBeGreaterThanOrEqual(15.5);
});

test("the side panel fits on screen while building, before Done is available", async ({ page }) => {
  await startNewGame(page, 7);
  const fit = await page.evaluate(() => {
    const panel = document.querySelector(".panel") as HTMLElement;
    const stage = document.getElementById("stage")!.getBoundingClientRect();
    const done = document.querySelector('[data-testid="done"]')!.getBoundingClientRect();
    return { overflow: panel.scrollHeight - panel.clientHeight, doneBottom: done.bottom, stageBottom: stage.bottom };
  });
  expect(fit.overflow).toBeLessThanOrEqual(0);
  expect(fit.doneBottom).toBeLessThanOrEqual(fit.stageBottom - 7);
});

test("buttons are big enough for a thumb and nothing overflows the screen", async ({ page }) => {
  await startNewGame(page, 7);
  await buildBothAndStart(page);
  await page.getByTestId("view-target").click();
  for (const id of ["view-mine", "view-target", "fire"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box!.height, id).toBeGreaterThanOrEqual(47);
  }
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - window.innerWidth,
    y: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(overflow.x).toBeLessThanOrEqual(0);
  expect(overflow.y).toBeLessThanOrEqual(0);
});

test("the Menu button works while placing: Resume, Main menu then Continue, and New game asks first", async ({ page }) => {
  await startNewGame(page, 7);
  await page.getByTestId("menu-open").click();
  await expect(page.getByTestId("menu-overlay")).toBeVisible();
  await page.getByTestId("menu-resume").click();
  await expect(page.getByTestId("menu-overlay")).toHaveCount(0);

  await page.getByTestId("random-layout").click();
  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu-main").click();
  await expect(page.getByTestId("menu")).toBeVisible();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("handoff")).toBeVisible();
  await page.getByTestId("start").click();
  await expect(page.getByTestId("builder")).toBeVisible();
  await expect(page.locator("[data-unit]")).toHaveCount(17);

  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu-new").click();
  await page.getByTestId("menu-keep").click();
  await expect(page.getByTestId("builder")).toBeVisible();
  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu-new").click();
  await page.getByTestId("menu-confirm-new").click();
  await expect(page.getByTestId("setup")).toBeVisible();
});

test("the Menu button is also there during play, and the panel still fits", async ({ page }) => {
  await startNewGame(page, 7);
  await buildBothAndStart(page);
  const fit = await page.evaluate(() => {
    const panel = document.querySelector(".panel") as HTMLElement;
    return panel.scrollHeight - panel.clientHeight;
  });
  expect(fit).toBeLessThanOrEqual(0);
  await page.getByTestId("menu-open").click();
  await page.getByTestId("menu-new").click();
  await page.getByTestId("menu-confirm-new").click();
  await expect(page.getByTestId("setup")).toBeVisible();
});
