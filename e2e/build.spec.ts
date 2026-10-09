import { expect, test, type Page } from "@playwright/test";
import { gridPoint, savedGame, startNewGame } from "./helpers.ts";

async function dragFromTray(page: Page, type: string, gx: number, gy: number): Promise<void> {
  const tray = await page.getByTestId(`tray-${type}`).boundingBox();
  const to = await gridPoint(page, gx, gy);
  await page.mouse.move(tray!.x + tray!.width / 2, tray!.y + tray!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

async function placed(page: Page) {
  return (await savedGame(page)).players[0].units;
}

test.beforeEach(async ({ page }) => {
  await startNewGame(page, 7);
});

test("Done only works once every unit is placed", async ({ page }) => {
  await expect(page.getByTestId("done")).toBeDisabled();
  await page.getByTestId("random-layout").click();
  await expect(page.getByTestId("done")).toBeEnabled();
  expect(await placed(page)).toHaveLength(17);
});

test("dragging a unit from the tray snaps it to the grid", async ({ page }) => {
  await dragFromTray(page, "fort", 9.5, 4.5);
  expect(await placed(page)).toEqual([{ id: "fort-1", type: "fort", x: 8, y: 3, upright: false, hits: 0 }]);
  await expect(page.getByTestId("tray-fort")).toHaveAttribute("data-left", "0");
});

test("a wall dragged beside the fort snaps against it and stands upright", async ({ page }) => {
  await dragFromTray(page, "fort", 9.5, 4.5);
  await dragFromTray(page, "wall", 7.4, 4.5);
  const wall = (await placed(page)).find((u) => u.id === "wall-1")!;
  expect(wall).toMatchObject({ x: 7, upright: true });
  await dragFromTray(page, "wall", 9.5, 1.6);
  const top = (await placed(page)).find((u) => u.id === "wall-2")!;
  expect(top).toMatchObject({ y: 2, upright: false });
});

test("a wall far from the fort lies flat", async ({ page }) => {
  await dragFromTray(page, "fort", 9.5, 4.5);
  await dragFromTray(page, "wall", 3, 8.5);
  expect((await placed(page)).find((u) => u.type === "wall")).toMatchObject({ upright: false });
});

test("units cannot overlap, and the player is told why", async ({ page }) => {
  await dragFromTray(page, "fort", 9.5, 4.5);
  await dragFromTray(page, "tank", 9.5, 4.5);
  expect(await placed(page)).toHaveLength(1);
  await expect(page.getByTestId("tip")).toHaveText("Something is already there.");
});

test("units cannot hang off the grid", async ({ page }) => {
  await dragFromTray(page, "tank", 19.8, 4.5);
  expect(await placed(page)).toHaveLength(0);
});

test("dragging a placed unit moves it, and dragging it off the grid removes it", async ({ page }) => {
  await dragFromTray(page, "infantry", 3.5, 3.5);
  expect((await placed(page))[0]).toMatchObject({ x: 3, y: 3 });
  const from = await gridPoint(page, 3.5, 3.5);
  const to = await gridPoint(page, 12.5, 6.5);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  expect((await placed(page))[0]).toMatchObject({ x: 12, y: 6 });
  const off = await gridPoint(page, 21.5, 5);
  const now = await gridPoint(page, 12.5, 6.5);
  await page.mouse.move(now.x, now.y);
  await page.mouse.down();
  await page.mouse.move(off.x, off.y, { steps: 6 });
  await page.mouse.up();
  expect(await placed(page)).toHaveLength(0);
});

test("a finger drag floats the unit above the fingertip", async ({ page }) => {
  const client = await page.context().newCDPSession(page);
  const tray = await page.getByTestId("tray-infantry").boundingBox();
  const sx = tray!.x + tray!.width / 2;
  const sy = tray!.y + tray!.height / 2;
  // The finger lands 0.8 squares below where the unit should go, so the finger does not hide it.
  const to = await gridPoint(page, 5.5, 5.5 + 0.8);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: to.x, y: to.y }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await placed(page)).length).toBe(1);
  expect((await placed(page))[0]).toMatchObject({ id: "infantry-1", x: 5, y: 5 });
});
