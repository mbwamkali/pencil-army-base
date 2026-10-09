import { expect, type Page } from "@playwright/test";
import type { Game } from "../src/rules/index.ts";

export async function savedGame(page: Page): Promise<Game> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("pencil-army-base:game") as string));
}

/** Screen position of a point on the board, given in grid squares. */
export async function gridPoint(page: Page, gx: number, gy: number): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId("board").boundingBox();
  if (!box) throw new Error("no board on screen");
  return { x: box.x + (gx / 20) * box.width, y: box.y + (gy / 10) * box.height };
}

export async function tapGrid(page: Page, gx: number, gy: number): Promise<void> {
  const p = await gridPoint(page, gx, gy);
  await page.mouse.click(p.x, p.y);
}

export async function startNewGame(page: Page, seed = 7, names: [string, string] = ["", ""]): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.getByTestId("new-game").click();
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

const SIZE: Record<string, [number, number]> = { fort: [3, 3], tank: [2, 2], artillery: [2, 2], infantry: [1, 1], wall: [2, 1] };

export function centreOfUnit(u: { type: string; x: number; y: number; upright: boolean }): { x: number; y: number } {
  const [w, h] = SIZE[u.type] as [number, number];
  const [rw, rh] = u.type === "wall" && u.upright ? [h, w] : [w, h];
  return { x: u.x + rw / 2, y: u.y + rh / 2 };
}
