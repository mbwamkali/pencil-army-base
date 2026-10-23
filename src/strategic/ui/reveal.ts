import type { Game, PlayerIndex } from "../../rules/game.ts";
import { el } from "../../ui/dom.ts";
import { isAlive } from "../rules/constants.ts";
import { decodeExplored, mapOf, matchReplay, revealView, turnNumber, unitTracks } from "../rules/index.ts";
import type { StrategicState } from "../rules/types.ts";
import { createMapView, fitCamera } from "./mapView.ts";
import { saveStrategicImage } from "./saveImage.ts";

/**
 * The Strategic results screen: a fort has fallen, so the fog lifts and both players see the whole
 * map with every unit and every shot as it really was, the dotted track of every unit that moved, a
 * few numbers about the match, and the ways on: play again, save the map as a picture, or watch the
 * whole match again turn by turn. Nothing here is shown before the game is over.
 */

/** The whole map above the stats: wide as the turn screen's map, shorter so the numbers and buttons fit under it. */
export const REVEAL_MAP_W = 744;
export const REVEAL_MAP_H = 300;

/** What the screen needs from app.ts: the same handlers as the Quick action end screen's buttons, plus the match replay. */
export interface RevealContext {
  playAgain(): void;
  mainMenu(): void;
  /** Opens the match replay: the whole game again, turn by turn, with the fog lifted. */
  watchMatch(): void;
}

export interface RevealStat {
  label: string;
  /** One cell per player, as the text to show. */
  cells: [string, string];
}

/** "Ana wins!", the line over the results screen and the saved picture. */
export function revealHeadline(game: Game): string {
  return game.winner === null ? "Game over" : `${game.players[game.winner].name} wins!`;
}

/**
 * The match in numbers, one row per stat: turns played, units lost, shots fired, shots that hurt
 * at least one enemy unit (a wall counts: it took the blow), and how much of the map each player saw.
 */
export function revealStats(game: Game): RevealStat[] {
  const s = game.strategic as StrategicState;
  const map = mapOf(s.map);
  const per = (f: (p: PlayerIndex) => string): [string, string] => [f(0), f(1)];
  const shotsBy = (p: PlayerIndex) => s.shots.filter((shot) => shot.by === p);
  return [
    { label: "Turns", cells: per((p) => String(turnNumber(game, p))) },
    { label: "Lost", cells: per((p) => String(game.players[p].units.filter((u) => !isAlive(u)).length)) },
    { label: "Shots", cells: per((p) => String(shotsBy(p).length)) },
    { label: "Hits", cells: per((p) => String(shotsBy(p).filter((shot) => shot.hits.some((h) => h.owner !== p)).length)) },
    { label: "Explored", cells: per((p) => `${Math.round((100 * decodeExplored(s.explored[p], map).size) / (map.w * map.h))}%`) },
  ];
}

export function strategicRevealScreen(game: Game, ctx: RevealContext): HTMLElement {
  const view = revealView(game);
  const names: [string, string] = [game.players[0].name, game.players[1].name];
  // Every unit's way across the map; none for a game saved before the starting armies were recorded.
  const tracks = unitTracks(game);

  const mapView = createMapView({
    view,
    width: REVEAL_MAP_W,
    height: REVEAL_MAP_H,
    camera: fitCamera(view.map, REVEAL_MAP_W, REVEAL_MAP_H),
    minimap: false,
    names,
    tracks,
  });
  mapView.fitWhole();
  mapView.root.style.margin = "0 auto";

  // Players as rows and stats as columns: three short rows fit under the map where seven would not.
  const stats = revealStats(game);
  const table = el(
    "table",
    { class: "summary reveal-stats", "data-testid": "reveal-stats" },
    el("tr", {}, el("th", { class: "summary-name" }), stats.map((st) => el("th", {}, st.label))),
    ([0, 1] as PlayerIndex[]).map((p) =>
      el(
        "tr",
        { "data-testid": `reveal-${p}`, class: p === game.winner ? "reveal-winner" : undefined },
        el("td", { class: "summary-name" }, el("span", { class: "reveal-name", title: names[p] }, names[p])),
        stats.map((st) => el("td", {}, st.cells[p])),
      ),
    ),
  );

  // Rendering the picture takes a moment on a big map: the button rests meanwhile so a second tap
  // does not open a second share sheet.
  const save = el("button", { class: "btn", "data-testid": "save-image" }, "Save image");
  save.addEventListener("click", () => {
    save.disabled = true;
    void saveStrategicImage(game).finally(() => (save.disabled = false));
  });
  // A game saved before the starting armies were recorded has nothing to replay.
  const watch = matchReplay(game).steps.length > 0;

  return el(
    "div",
    { class: "screen over strategic-reveal", "data-testid": "strategic-reveal" },
    el(
      "div",
      { class: tracks.length > 0 ? "reveal-head with-legend" : "reveal-head" },
      el("h2", { class: "winner", "data-testid": "winner" }, revealHeadline(game)),
      tracks.length > 0 &&
        el(
          "p",
          { class: "reveal-legend", "data-testid": "reveal-legend" },
          el("span", { class: "reveal-legend-line", "aria-hidden": "true" }),
          el("span", { class: "reveal-legend-line enemy", "aria-hidden": "true" }),
          "where units went",
        ),
    ),
    el("div", { class: "reveal-map" }, mapView.root),
    el(
      "div",
      { class: "reveal-bottom" },
      table,
      el(
        "div",
        { class: "menu-buttons row reveal-buttons" },
        el("button", { class: "btn primary", "data-testid": "play-again", onclick: () => ctx.playAgain() }, "Play again"),
        el("button", { class: "btn", "data-testid": "main-menu", onclick: () => ctx.mainMenu() }, "Main menu"),
        save,
        watch && el("button", { class: "btn", "data-testid": "watch-match", onclick: () => ctx.watchMatch() }, "Watch the match"),
      ),
    ),
  );
}
