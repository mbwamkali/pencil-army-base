import type { Game } from "../rules/game.ts";
import { MODE_IDS } from "../rules/modes.ts";

const KEY = "pencil-army-base:game";

/** Browser storage can be blocked or full; the game still plays without it. */
export function saveGame(game: Game): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(game));
  } catch {
    // ignore
  }
}

export function loadGame(): Game | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as Game;
    if (g.version !== 1 || !Array.isArray(g.players) || g.players.length !== 2) return null;
    // Games saved before modes existed (or in a mode since removed) play as Battle.
    if (!MODE_IDS.includes(g.mode)) g.mode = "battle";
    return g;
  } catch {
    return null;
  }
}

export function clearGame(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
