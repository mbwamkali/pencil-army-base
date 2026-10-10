import type { Game, PlayerIndex } from "../rules/game.ts";
import { scoreOf, shotStats, unitsLeft } from "../rules/game.ts";
import { fightingCount, modeOf } from "../rules/modes.ts";
import { rectOf, unitState } from "../rules/units.ts";
import { FOOTPRINT } from "../rules/constants.ts";
import { artUrl, unitArt } from "./art.ts";

const BOARD_W = 760;
const PAD = 40;
const PAPER = "#faf9f4";
const GRID = "#b9cadb";
const INK = "#3b3d40";
const FONT = '"Patrick Hand", "Comic Sans MS", cursive';

const images = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load ${url}`));
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

/** Draws the finished game, both bases side by side with every unit and shot, onto a canvas. */
export async function renderBattlefield(game: Game): Promise<HTMLCanvasElement> {
  const mode = modeOf(game.mode);
  const sq = BOARD_W / mode.grid.w;
  const boardH = mode.grid.h * sq;
  const headH = 90;
  const titleH = 50;
  const footH = 80;
  const canvas = document.createElement("canvas");
  canvas.width = PAD * 3 + BOARD_W * 2;
  canvas.height = PAD + headH + titleH + boardH + footH + PAD;
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
  const winner = game.winner === null ? "It's a tie!" : `${game.players[game.winner].name} wins!`;
  ctx.fillText(winner, canvas.width / 2, PAD + 62);

  for (const p of [0, 1] as PlayerIndex[]) {
    const x0 = PAD + p * (BOARD_W + PAD);
    const y0 = PAD + headH + titleH;
    const left = unitsLeft(game.players[p].units).total;
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.font = `34px ${FONT}`;
    ctx.fillText(`${game.players[p].name}'s base`, x0, y0 - 14);
    ctx.textAlign = "right";
    ctx.font = `28px ${FONT}`;
    ctx.fillText(`${left} / ${fightingCount(mode)} left`, x0 + BOARD_W, y0 - 14);

    ctx.fillStyle = "#fff";
    ctx.fillRect(x0, y0, BOARD_W, boardH);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < mode.grid.w; i++) {
      ctx.moveTo(x0 + i * sq, y0);
      ctx.lineTo(x0 + i * sq, y0 + boardH);
    }
    for (let j = 1; j < mode.grid.h; j++) {
      ctx.moveTo(x0, y0 + j * sq);
      ctx.lineTo(x0 + BOARD_W, y0 + j * sq);
    }
    ctx.stroke();

    // Shots the enemy fired at this base, then the units on top, as on screen.
    const enemy: PlayerIndex = p === 0 ? 1 : 0;
    for (const s of game.players[enemy].shots) {
      const img = await loadImage(artUrl(s.hits.length > 0 ? "shot-hit" : "shot-miss"));
      ctx.drawImage(img, x0 + s.x * sq - sq, y0 + s.y * sq - sq, 2 * sq, 2 * sq);
    }
    for (const u of game.players[p].units) {
      const r = rectOf(u);
      const side = Math.max(FOOTPRINT[u.type].w, FOOTPRINT[u.type].h) * sq;
      const cx = x0 + (r.x + r.w / 2) * sq;
      const cy = y0 + (r.y + r.h / 2) * sq;
      const img = await loadImage(unitArt(u.type, unitState(u)));
      ctx.save();
      ctx.translate(cx, cy);
      if (p === 1) ctx.scale(-1, 1);
      if (u.upright) ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, -side / 2, -side / 2, side, side);
      ctx.restore();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.strokeRect(x0, y0, BOARD_W, boardH);
  }

  const stat = (p: PlayerIndex) => {
    const s = shotStats(game.players[p]);
    return `${game.players[p].name}: ${s.hits} hits from ${s.shots} shots, ${scoreOf(game.players[p])} points`;
  };
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.font = `28px ${FONT}`;
  const footY = PAD + headH + titleH + boardH + 48;
  ctx.fillText(`${mode.name}, ${game.turn} turns. ${stat(0)}. ${stat(1)}.`, canvas.width / 2, footY);
  return canvas;
}

/** Saves the final battlefield as a PNG: the browser's download, which lands in Downloads on a phone. */
export async function saveBattlefieldImage(game: Game): Promise<void> {
  const canvas = await renderBattlefield(game);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pencil-army-base-battlefield.png";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
