import type { Game } from "../../rules/game.ts";
import { el } from "../../ui/dom.ts";
import { endStrategicTurn, strategicView } from "../rules/index.ts";
import { baseCamera, createMapView, type Camera, type MapView } from "./mapView.ts";

/**
 * The Strategic turn screen: the fog-of-war map on the left and a slim panel on the right. This
 * build has no orders or shooting, so the panel only tells the player where they stand and lets
 * them look around the map before passing the phone.
 */

/** The map fills the stage left of the panel (the panel is 176 px wide on this screen). */
export const MAP_W = 744;
export const MAP_H = 412;

/** What the screen needs from app.ts, passed in so this file never imports the app and the app can import it. */
export interface ScreenContext {
  /** The small Menu button at the top of the side panel. */
  menuButton(): HTMLElement;
  /** Saves the game and redraws the screen after a rules change. */
  setGame(game: Game): void;
  /** The in-game Menu overlay while it is open, or null. */
  overlay(): HTMLElement | null;
}

/**
 * Where the camera was, keyed by game and turn: render() rebuilds the whole screen on every change,
 * so without this the map would jump back to the base each time. A new turn starts on the base.
 */
let remembered: { key: string; camera: Camera } | null = null;

export function strategicScreen(game: Game, ctx: ScreenContext): HTMLElement {
  const viewer = game.current;
  const view = strategicView(game, viewer);
  const key = `${game.seed}:${game.turn}`;
  const start = remembered?.key === key ? remembered.camera : baseCamera(view.map, view.base, MAP_W, MAP_H);

  // The button reads "Whole map" when zoomed in and "Zoom to base" once the whole map is in view.
  const wholeLabel = (mv: MapView): string => (mv.isWhole() ? "Zoom to base" : "Whole map");
  const wholeButton = el("button", { class: "btn", "data-testid": "whole-map" }) as HTMLButtonElement;
  const mapView = createMapView({
    view,
    width: MAP_W,
    height: MAP_H,
    camera: start,
    onCamera: (c) => {
      remembered = { key, camera: c };
      wholeButton.textContent = wholeLabel(mapView);
    },
  });
  remembered = { key, camera: mapView.camera() };
  wholeButton.textContent = wholeLabel(mapView);
  wholeButton.addEventListener("click", () => (mapView.isWhole() ? mapView.focusBase() : mapView.fitWhole()));

  // "Spotted" the moment any enemy fort has been seen, now or earlier; it is the thing to find.
  const fortSeen = view.enemies.some((e) => e.type === "fort");
  const status = el(
    "div",
    { class: "status strategic-status" },
    el("p", { "data-testid": "explored" }, `Explored ${view.exploredPercent}%`),
    el("p", { "data-testid": "enemy-base" }, `Enemy base: ${fortSeen ? "spotted" : "not found yet"}`),
    el("p", { class: "muted strategic-note" }, "Test build: map and fog. Orders and shooting come next."),
  );

  const panel = el(
    "div",
    { class: "panel" },
    ctx.menuButton(),
    el("div", { class: "panel-name", "data-testid": "shooter" }, game.players[viewer].name),
    el("div", { class: "panel-sub", "data-testid": "turn" }, `Turn ${view.turnNumber}`),
    el("div", { class: "rule" }),
    status,
    el("div", { class: "spacer" }),
    wholeButton,
    el(
      "button",
      {
        class: "btn primary",
        "data-testid": "end-turn",
        onclick: () => {
          const r = endStrategicTurn(game);
          if (r.ok) ctx.setGame(r.game);
        },
      },
      "End turn",
    ),
  );

  return el("div", { class: "screen game strategic" }, mapView.root, panel, ctx.overlay());
}
