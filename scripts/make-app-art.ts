/**
 * Draws the Android app's icon and splash source images in resources/ from public/art/icon.svg,
 * then turns them into every Android size with @capacitor/assets. Run after the icon art changes:
 *   node scripts/make-app-art.ts && npx capacitor-assets generate --android --assetPath resources --iconBackgroundColor "#fbfaf4" --splashBackgroundColor "#fbfaf4"
 * Needs Chromium (set CHROMIUM_PATH if Playwright can't find it).
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync("public/art/icon.svg", "utf8");
const body = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>.*?<\/title>/, "");
const firstDrawing = body.indexOf("<g ");
const paper = body.slice(0, firstDrawing);
const drawing = body.slice(firstDrawing);

/** Shrinks the drawing about the centre, so it fits the part of an adaptive icon that every phone shape shows. */
const centred = (scale: number) => `<g transform="translate(256,256) scale(${scale}) translate(-256,-256)">${drawing}</g>`;

const images: Record<string, { size: number; content: string }> = {
  // Older phones use the whole square icon.
  "icon-only.png": { size: 1024, content: paper + drawing },
  // Adaptive icons: lined paper behind, the fort in front. @capacitor/assets insets both layers to the visible part of the icon.
  "icon-background.png": { size: 1024, content: paper },
  "icon-foreground.png": { size: 1024, content: centred(1.1) },
  // The splash screen: the fort on a page of lined paper.
  "splash.png": { size: 2732, content: paper + centred(0.35) },
};

mkdirSync("resources", { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const [name, { size, content }] of Object.entries(images)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}</style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">${content}</svg>`,
  );
  await page.screenshot({ path: `resources/${name}`, omitBackground: true });
  console.log(`resources/${name}`);
}
await browser.close();
