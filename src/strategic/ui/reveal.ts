import type { Game, PlayerIndex } from "../../rules/game.ts";
import { el } from "../../ui/dom.ts";
import { isAlive } from "../rules/constants.ts";
import { decodeExplored, mapOf, revealView, turnNumber } from "../rules/index.ts";
import type { StrategicState } from "../rules/types.ts";
import { createMapView, fitCamera } from "./mapView.ts";

/**
 * The Strategic results screen: a fort has fallen, so the fog lifts and both players see the whole
 * map with every unit and every shot as it really was, a few numbers about the match, and the way
 * to the next game. Nothing here is shown before the game is over.
 */

/** The whole map above the stats: wide as the turn screen's map, shorter so the numbers and buttons fit under it. */
export const REVEAL_MAP_W = 744;
export const REVEAL_MAP_H = 300;

/** What the screen needs from app.ts: the same handlers as the Quick action end screen's buttons. */
export interface RevealContext {
  playAgain(): void;
  mainMenu(): void;
}

export interface RevealStat {
  label: string;
  /** One cell per player, as the text to show. */
  cells: [string, string];
}

/** The match in numbers, one row per stat: turns played, units lost, shots fired and how much of the map each player saw. */
export function revealStats(game: Game): RevealStat[] {
  const s = game.strategic as StrategicState;
  const map = mapOf(s.map);
  const per = (f: (p: PlayerIndex) => string): [string, string] => [f(0), f(1)];
  return [
    { label: "Turns", cells: per((p) => String(turnNumber(game, p))) },
    { label: "Lost", cells: per((p) => String(game.players[p].units.filter((u) => !isAlive(u)).length)) },
    { label: "Shots", cells: per((p) => String(s.shots.filter((shot) => shot.by === p).length)) },
    { label: "Explored", cells: per((p) => `${Math.round((100 * decodeExplored(s.explored[p], map).size) / (map.w * map.h))}%`) },
  ];
}

export function strategicRevealScreen(game: Game, ctx: RevealContext): HTMLElement {
  const view = revealView(game);
  const names: [string, string] = [game.players[0].name, game.players[1].name];
  const headline = game.winner === null ? "Game over" : `${names[game.winner]} wins!`;

  const mapView = createMapView({
    view,
    width: REVEAL_MAP_W,
    height: REVEAL_MAP_H,
    camera: fitCamera(view.map, REVEAL_MAP_W, REVEAL_MAP_H),
    minimap: false,
    names,
  });
  mapView.fitWhole();
  mapView.root.style.margin = "0 auto";

  // Players as rows and stats as columns: three short rows fit under the map where six would not.
  const stats = revealStats(game);
  const table = el(
    "table",
    { class: "summary reveal-stats", "data-testid": "reveal-stats" },
    el("tr", {}, el("th", { class: "summary-name" }), stats.map((st) => el("th", {}, st.label))),
    ([0, 1] as PlayerIndex[]).map((p) =>
      el(
        "tr",
        { "data-testid": `reveal-${p}`, class: p === game.winner ? "reveal-winner" : undefined },
        el("td", { class: "summary-name" }, names[p]),
        stats.map((st) => el("td", {}, st.cells[p])),
      ),
    ),
  );

  return el(
    "div",
    { class: "screen over strategic-reveal", "data-testid": "strategic-reveal" },
    el("h2", { class: "winner", "data-testid": "winner" }, headline),
    el("div", { class: "reveal-map" }, mapView.root),
    el(
      "div",
      { class: "reveal-bottom" },
      table,
      el(
        "div",
        { class: "menu-buttons row" },
        el("button", { class: "btn primary", "data-testid": "play-again", onclick: () => ctx.playAgain() }, "Play again"),
        el("button", { class: "btn", "data-testid": "main-menu", onclick: () => ctx.mainMenu() }, "Main menu"),
      ),
    ),
  );
}
