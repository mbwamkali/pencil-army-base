import latinFont from "@fontsource/patrick-hand/files/patrick-hand-latin-400-normal.woff2?url";
import latinExtFont from "@fontsource/patrick-hand/files/patrick-hand-latin-ext-400-normal.woff2?url";
import type { Game, PlayerIndex } from "../../rules/game.ts";
import { sv } from "../../ui/dom.ts";
import { offerImage } from "../../ui/share.ts";
import { revealView, unitTracks } from "../rules/index.ts";
import { createMapView, fitCamera } from "./mapView.ts";
// reveal.ts imports this file too; only its function declarations are used here, and those are
// ready before either file runs, so the loop between the two is harmless.
import { revealHeadline, revealMapName, revealStats } from "./reveal.ts";

/**
 * Save image on the Strategic results screen: the revealed map with every unit's track, the
 * headline and the match's numbers as one PNG, offered the way Quick action offers its picture
 * (the share sheet where there is one, else a download).
 *
 * The map is the same drawing as on screen: a fresh map view, serialised and painted onto a canvas.
 * An SVG painted as an image cannot load anything outside itself, so the unit and shot art (separate
 * SVG files) is fetched once, kept as data URIs, and placed inside the map's own SVG first.
 */

/**
 * The map's width in the picture: about 25 px a square on a 60-wide Large map (38, the scale the
 * map's drawing is made at, on the 40-wide Medium 1), so the picture stays a size a phone shares easily.
 */
export const IMAGE_MAP_W = 1520;
const PAD = 40;
const HEAD_H = 90;
const PAPER = "#faf9f4";
const INK = "#3b3d40";
const INK_SOFT = "#6b6d70";
const FONT = '"Patrick Hand", "Comic Sans MS", cursive';
export const STRATEGIC_IMAGE_NAME = "pencil-army-base-strategic.png";

/**
 * What style.css gives the map that its attributes do not: the shield on a shot a wall blocked, and
 * the font. A picture has no stylesheet, so these travel inside the SVG.
 */
const SVG_STYLE = `.mark-shield{fill:#fff;stroke:${INK};stroke-width:2.5;stroke-linejoin:round}text{font-family:${FONT}}`;

/** The game's font files for Latin names (the same files style.css loads), with the letters each one covers. */
const FONT_FILES = [
  { url: latinFont, range: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212,U+FEFF,U+FFFD" },
  { url: latinExtFont, range: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+20A0-20AB,U+2C60-2C7F,U+A720-A7FF" },
];

/**
 * Each fetched file once per session, as a data URI of the given type (named here, not taken from the
 * server, which may label an SVG as plain XML). A failed fetch is forgotten so the next save tries again.
 */
const dataUris = new Map<string, Promise<string>>();

function asDataUri(url: string, type: string): Promise<string> {
  let p = dataUris.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`could not load ${url}`);
        return r.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(`data:${type};base64,${String(reader.result).split(",")[1] ?? ""}`);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      );
    p.catch(() => dataUris.delete(url));
    dataUris.set(url, p);
  }
  return p;
}

/**
 * The game's hand-drawn font as @font-face rules with the files inside, so the map's labels in the
 * picture match the headline. Without it (a fetch failed) the labels fall back to a system font.
 */
async function fontFaces(): Promise<string> {
  try {
    const files = await Promise.all(FONT_FILES.map((f) => asDataUri(f.url, "font/woff2")));
    return FONT_FILES.map((f, k) => `@font-face{font-family:"Patrick Hand";src:url(${files[k]}) format("woff2");unicode-range:${f.range}}`).join("");
  } catch {
    return "";
  }
}

/**
 * Puts every art file the map uses inside the SVG: one <symbol> per file holding it as a data URI,
 * and each drawing becomes a <use> of it with the same box, turn and fade. A long game has a hundred
 * smudges of the same two files, so this keeps the picture's SVG small.
 */
async function inlineArt(svg: SVGSVGElement): Promise<void> {
  const images = [...svg.querySelectorAll("image")];
  const urls = [...new Set(images.map((img) => img.getAttribute("href") ?? ""))].filter((u) => u !== "" && !u.startsWith("data:"));
  const data = await Promise.all(urls.map((u) => asDataUri(u, "image/svg+xml")));
  const ids = new Map(urls.map((u, k) => [u, `art-${k}`]));
  // Art files are drawn on a 64 x 64 page.
  svg.prepend(
    sv(
      "defs",
      {},
      urls.map((u, k) => sv("symbol", { id: ids.get(u)!, viewBox: "0 0 64 64" }, sv("image", { href: data[k]!, width: 64, height: 64 }))),
    ),
  );
  for (const img of images) {
    const id = ids.get(img.getAttribute("href") ?? "");
    if (!id) continue;
    const use = sv("use", { href: `#${id}` });
    for (const a of ["x", "y", "width", "height", "transform", "opacity", "class", "data-shot", "data-outcome", "data-weapon"]) {
      const v = img.getAttribute(a);
      if (v !== null) use.setAttribute(a, v);
    }
    img.replaceWith(use);
  }
}

/** The revealed map as standalone SVG text, IMAGE_MAP_W wide, with its art inside. */
export async function strategicMapSvg(game: Game): Promise<{ svg: string; width: number; height: number }> {
  const view = revealView(game);
  const width = IMAGE_MAP_W;
  const height = Math.round((IMAGE_MAP_W * view.map.h) / view.map.w);
  // Laid out at half size and painted at 2x: the whole map then fills the picture (at the drawing's
  // own scale on a 40-wide map).
  const mapView = createMapView({
    view,
    width: width / 2,
    height: height / 2,
    camera: fitCamera(view.map, width / 2, height / 2),
    minimap: false,
    names: [game.players[0].name, game.players[1].name],
    tracks: unitTracks(game),
  });
  mapView.fitWhole();
  const svg = mapView.svg;
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.removeAttribute("style");
  svg.prepend(sv("style", {}, (await fontFaces()) + SVG_STYLE));
  await inlineArt(svg);
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not draw the map"));
    img.src = src;
  });
}

/** Draws the finished Strategic game, headline, revealed map with tracks, and the stats, onto a canvas. */
export async function renderStrategicImage(game: Game): Promise<HTMLCanvasElement> {
  const map = await strategicMapSvg(game);
  const mapImg = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(map.svg)}`);
  const stats = revealStats(game);
  const rowH = 42;
  const statsTop = PAD + HEAD_H + map.height + 50;
  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + map.width;
  canvas.height = statsTop + rowH * 2 + 70 + PAD;
  const ctx = canvas.getContext("2d")!;
  try {
    await document.fonts?.ready;
  } catch {
    // The fallback font is fine.
  }

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.font = `64px ${FONT}`;
  ctx.fillText(revealHeadline(game), canvas.width / 2, PAD + 62);

  const mapTop = PAD + HEAD_H;
  ctx.drawImage(mapImg, PAD, mapTop, map.width, map.height);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(PAD, mapTop, map.width, map.height);

  // The stats as on screen: players as rows, the winner's in bold.
  const nameW = 330;
  const colW = (canvas.width - PAD * 2 - nameW) / stats.length;
  const colRight = (c: number) => PAD + nameW + (c + 1) * colW - 12;
  ctx.fillStyle = INK_SOFT;
  ctx.font = `26px ${FONT}`;
  ctx.textAlign = "right";
  stats.forEach((st, c) => ctx.fillText(st.label, colRight(c), statsTop));
  ctx.fillStyle = INK;
  ([0, 1] as PlayerIndex[]).forEach((p) => {
    const y = statsTop + rowH * (p + 1);
    ctx.font = `${p === game.winner ? "bold " : ""}30px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(game.players[p].name, PAD, y);
    ctx.textAlign = "right";
    stats.forEach((st, c) => ctx.fillText(st.cells[p], colRight(c), y));
  });
  ctx.fillStyle = INK_SOFT;
  ctx.textAlign = "center";
  ctx.font = `24px ${FONT}`;
  const [a, b] = [game.players[0].name, game.players[1].name];
  const legend = unitTracks(game).length > 0 ? ` Dotted lines: where units went (${a} in pencil, ${b} in red).` : "";
  ctx.fillText(`Strategic on ${revealMapName(game)}, ${game.turn} turns.${legend}`, canvas.width / 2, statsTop + rowH * 2 + 46);
  return canvas;
}

/**
 * Offers the revealed Strategic map as a PNG, exactly as Quick action offers its battlefield: the
 * share sheet in the app or where the browser can share files, else a download.
 */
export async function saveStrategicImage(game: Game): Promise<void> {
  const canvas = await renderStrategicImage(game);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  await offerImage(blob, STRATEGIC_IMAGE_NAME);
}
