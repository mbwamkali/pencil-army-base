import { expect, type Page } from "@playwright/test";
import type { Game } from "../src/rules/index.ts";

export async function savedGame(page: Page): Promise<Game> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("pencil-army-base:game") as string));
}

/** Screen position of a point on the board, given in grid squares. */
export type GridSize = { w: number; h: number };
export const FULL: GridSize = { w: 20, h: 10 };
export const SMALL: GridSize = { w: 12, h: 6 };

export async function gridPoint(page: Page, gx: number, gy: number, grid: GridSize = FULL): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("board").boundingBox();
  if (!box) throw new Error("no board on screen");
  return { x: box.x + (gx / grid.w) * box.width, y: box.y + (gy / grid.h) * box.height };
}

export async function tapGrid(page: Page, gx: number, gy: number, grid: GridSize = FULL): Promise<void> {
  const p = await gridPoint(page, gx, gy, grid);
  await page.mouse.click(p.x, p.y);
}

export type ModeName = "skirmish" | "battle" | "score" | "strategic";

/** Starts a game from the menu. Most tests use Battle (the full army); pass a mode to try another. */
export async function startNewGame(
  page: Page,
  seed = 7,
  names: [string, string] = ["", ""],
  mode: ModeName = "battle",
): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.getByTestId("new-game").click();
  await page.getByTestId("mode-select").selectOption(mode);
  await page.getByTestId("opponent-share").click();
  if (names[0]) await page.getByTestId("name-1").fill(names[0]);
  if (names[1]) await page.getByTestId("name-2").fill(names[1]);
  await page.getByTestId("start-game").click();
}

/** Both players use Random layout, then the first shooter's turn begins on their own base. */
export async function buildBothAndStart(page: Page): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("random-layout").click();
    await page.getByTestId("done").click();
    await page.getByTestId("start").click();
  }
  await expect(page.getByTestId("shooter")).toBeVisible();
}

/**
 * A Strategic game from the menu: Random layouts for both players, then Start for player 1's first
 * turn. Returns the game as saved just before that Start (both bases on the map, nobody has acted),
 * so a test can see what the turn's automatic infantry step changed.
 */
export async function strategicGame(page: Page, seed: number, names: [string, string] = ["", ""]): Promise<Game> {
  await startNewGame(page, seed, names, "strategic");
  await page.getByTestId("random-layout").click();
  await page.getByTestId("done").click();
  await page.getByTestId("start").click();
  await page.getByTestId("random-layout").click();
  await page.getByTestId("done").click();
  await expect(page.getByTestId("handoff")).toBeVisible();
  const before = await savedGame(page);
  await page.getByTestId("start").click();
  await expect(page.getByTestId("strategic-map")).toBeVisible();
  return before;
}

/** World units per map square in the Strategic map's SVG (SQ_NEAR in src/strategic/ui/camera.ts). */
const MAP_UNIT = 38;

/** Screen position of a point on the Strategic map, given in map squares, read from the svg's viewBox as it is now. */
export async function mapPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const svg = page.getByTestId("strategic-map");
  const box = await svg.boundingBox();
  const viewBox = ((await svg.getAttribute("viewBox")) ?? "").split(" ").map(Number);
  if (!box || viewBox.length !== 4) throw new Error("no Strategic map on screen");
  const [vx, vy, vw, vh] = viewBox as [number, number, number, number];
  return { x: box.x + ((x * MAP_UNIT - vx) / vw) * box.width, y: box.y + ((y * MAP_UNIT - vy) / vh) * box.height };
}

/** A tap on the Strategic map at a point in map squares (it must be in view). */
export async function tapMap(page: Page, x: number, y: number): Promise<void> {
  const p = await mapPoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

const SIZE: Record<string, [number, number]> = { fort: [3, 3], tank: [2, 2], artillery: [2, 2], infantry: [1, 1], wall: [2, 1], truck: [2, 2] };

export function centreOfUnit(u: { type: string; x: number; y: number; upright: boolean }): { x: number; y: number } {
  const [w, h] = SIZE[u.type] as [number, number];
  const [rw, rh] = u.type === "wall" && u.upright ? [h, w] : [w, h];
  return { x: u.x + rw / 2, y: u.y + rh / 2 };
}

/** The centre of a square with nothing on it or on any square around it, so a shot there is a miss. */
export function emptySpot(units: { type: string; x: number; y: number; upright: boolean }[], grid: GridSize = FULL): { x: number; y: number } {
  const taken = new Set<string>();
  for (const u of units) {
    const [w, h] = SIZE[u.type] as [number, number];
    const [rw, rh] = u.type === "wall" && u.upright ? [h, w] : [w, h];
    for (let dx = 0; dx < rw; dx++) for (let dy = 0; dy < rh; dy++) taken.add(`${u.x + dx},${u.y + dy}`);
  }
  for (let y = 0; y < grid.h; y++)
    for (let x = 0; x < grid.w; x++) {
      let clear = true;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (taken.has(`${x + dx},${y + dy}`)) clear = false;
      if (clear) return { x: x + 0.5, y: y + 0.5 };
    }
  throw new Error("no empty spot on this base");
}

export const CORE = ["fort", "tank", "artillery"];

/** The first player keeps shooting at a fort, tank or artillery; the other fires into an empty corner. */
export async function huntCore(page: Page, grid: GridSize = SMALL, only: string[] = CORE, maxShots = 60): Promise<number> {
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

