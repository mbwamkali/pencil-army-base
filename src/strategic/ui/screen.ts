import type { Failure, Game, PlayerIndex } from "../../rules/game.ts";
import type { Rect } from "../../rules/units.ts";
import { UNIT_LABEL } from "../../ui/art.ts";
import { el, sv } from "../../ui/dom.ts";
import {
  ARTILLERY_MIN_RANGE,
  HP,
  aimProblem,
  shakeFor,
  centreOf,
  endStrategicTurn,
  fireArtillery,
  fireTank,
  footprintAt,
  hpLeft,
  moveUnit,
  reachableFor,
  shooterView,
  strategicView,
  tankTargets,
} from "../rules/index.ts";
import type { DrawnUnit, MapShot, OrderRow, Point } from "../rules/types.ts";
import { SQ_NEAR, baseCamera, createMapView, footprintOf, type Camera, type MapView } from "./mapView.ts";

/**
 * The Strategic turn screen: the fog-of-war map on the left and a slim panel on the right with the
 * orders list. The player taps a tank, truck or artillery (on the map or in the list), then taps
 * where it should go, what it should shoot or where the shell should land. Every order acts at
 * once through the rules, and the whole screen is rebuilt from the new game. A tap that only picks
 * a unit, sets an aim or shows a tip redraws just the marks and the panel, in place: rebuilding a
 * Large map with a hundred units for every pick made a slow phone wait about a tenth of a second.
 */

/** The map fills the stage left of the panel (the panel is 176 px wide on this screen). */
export const MAP_W = 744;
export const MAP_H = 412;

/** A second tap this close (in squares) to the artillery's aim fires the shell. */
const AIM_TAP = 0.6;

/** What the screen needs from app.ts, passed in so this file never imports the app and the app can import it. */
export interface ScreenContext {
  /** The small Menu button at the top of the side panel. */
  menuButton(): HTMLElement;
  /** Saves the game and redraws the screen after a rules change. */
  setGame(game: Game): void;
  /** The in-game Menu overlay while it is open, or null. */
  overlay(): HTMLElement | null;
  /** The game is over and the player has seen the last shot: on to the results screen. */
  showResults(): void;
  /** The one-line explanation for an order the rules refused. */
  problemTip(reason: Failure): string;
}

/**
 * Where the camera was, keyed by game and turn: render() rebuilds the whole screen on every change,
 * so without this the map would jump back to the base each time. A new turn starts on the base.
 */
let remembered: { key: string; camera: Camera } | null = null;

/** What the player is doing on this turn, kept across renders the same way as the camera. */
interface Selection {
  key: string;
  /** The unit picked for an order, or null. */
  unitId: string | null;
  /** Where the selected artillery is aimed, or null. */
  aim: Point | null;
  /** What the last order did ("Hit enemy tank: 1 of 3 left"), shown until the next order or turn. */
  result: string | null;
  /** Why the last tap did nothing ("Too close: ..."); cleared by the next tap. */
  tip: string | null;
}

let selection: Selection = { key: "", unitId: null, aim: null, result: null, tip: null };

/** "tank-2" reads as "Tank 2" in the orders list. */
export function orderLabel(unitId: string, type: OrderRow["type"]): string {
  return `${UNIT_LABEL[type]} ${unitId.split("-")[1] ?? ""}`.trim();
}

/** Every square of a footprint, as top-left points. */
function squaresOf(r: Rect): Point[] {
  const out: Point[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
}

/**
 * Where a tap sends a mover: the reachable top-left whose footprint would cover the tapped square,
 * nearest the tap when several would (a 2x2 tank has four), so tapping where the tank should stand
 * works. Null when the tap is not on reachable ground.
 */
export function moveTarget(unit: Pick<DrawnUnit, "type" | "upright">, reach: readonly Point[], tap: Point): Point | null {
  const sq = { x: Math.floor(tap.x), y: Math.floor(tap.y) };
  let best: Point | null = null;
  let bestD = Infinity;
  for (const tl of reach) {
    const r = footprintAt(unit, tl.x, tl.y);
    if (sq.x < r.x || sq.x >= r.x + r.w || sq.y < r.y || sq.y >= r.y + r.h) continue;
    const c = centreOf(r);
    const d = Math.hypot(c.x - tap.x, c.y - tap.y);
    if (d < bestD) {
      best = tl;
      bestD = d;
    }
  }
  return best;
}

/** Hit points a unit has left after a shot, read from the game the shot produced. */
function leftAfter(after: Game, owner: PlayerIndex, unitId: string): number {
  const u = after.players[owner].units.find((v) => v.id === unitId);
  return u ? hpLeft(u) : 0;
}

/** The result line after a tank shot: a tank always sees what it hit. */
export function describeTankShot(shot: MapShot, after: Game): string {
  const hit = shot.hits[0];
  if (!hit) return "Missed";
  if (hit.destroyed) return `Destroyed enemy ${hit.type}`;
  return `Hit enemy ${hit.type}: ${leftAfter(after, hit.owner, hit.unitId)} of ${HP[hit.type]} left`;
}

/**
 * The result line after a shell, from the shot as the shooter knows it (shooterView): what the fog
 * hid stays out of it, and the line agrees with the mark drawn on the map.
 */
export function describeShell(shot: MapShot, after: Game, me: PlayerIndex): string {
  const { outcome, hits } = shooterView(shot);
  if (outcome === "unknown") return "Shell landed. Nothing in sight there.";
  if (hits.length === 0) return "Shell missed";
  if (hits.every((h) => h.type === "wall")) return "Shell blocked by a wall";
  const [hit] = hits;
  if (hit && hits.length === 1) {
    const whose = hit.owner === me ? "your" : "enemy";
    if (hit.destroyed) return `Shell destroyed ${whose} ${hit.type}`;
    return `Shell hit ${whose} ${hit.type}: ${leftAfter(after, hit.owner, hit.unitId)} of ${HP[hit.type]} left`;
  }
  const destroyed = hits.filter((h) => h.destroyed).length;
  const own = hits.filter((h) => h.owner === me).length;
  const notes = [destroyed > 0 && `${destroyed} destroyed`, own > 0 && `${own} yours`].filter((n): n is string => typeof n === "string");
  return `Shell hit: ${hits.length} units${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
}

/**
 * The result line after a move. `stopped` when an enemy hidden in the fog stood in the way and the
 * unit halted beside it (moveUnit); the enemy is in sight now, so naming it gives nothing away.
 */
export function describeMove(label: string, riders: number, stopped = false): string {
  const withRiders = riders === 0 ? "" : ` with ${riders} ${riders === 1 ? "rider" : "riders"}`;
  if (stopped) return `${label} stopped${withRiders}: enemy in the way`;
  return `${label} moved${withRiders}`;
}

/** What the current pick allows, worked out again after every tap. */
interface Picked {
  row: OrderRow;
  unit: DrawnUnit;
  /** Top-left squares the unit can move to now (empty when it cannot move). */
  reach: Point[];
  /** Enemy unit ids a picked tank can shoot now. */
  targets: string[];
}

export function strategicScreen(game: Game, ctx: ScreenContext): HTMLElement {
  const viewer = game.current;
  const view = strategicView(game, viewer);
  const key = `${game.seed}:${game.turn}`;
  if (selection.key !== key) selection = { key, unitId: null, aim: null, result: null, tip: null };
  const start = remembered?.key === key ? remembered.camera : baseCamera(view.map, view.base, MAP_W, MAP_H);
  // Orders exist only while it is this player's turn and the game is on; afterwards the screen is read-only.
  const rows = view.orders;
  const rowOf = (id: string | null): OrderRow | undefined => rows.find((r) => r.unitId === id);
  const unitOf = (id: string): DrawnUnit | undefined => view.units.find((u) => u.id === id);

  /** The picked unit and what it can do, or null; a pick that no longer has an order row is dropped. */
  const picked = (): Picked | null => {
    const row = rowOf(selection.unitId);
    const unit = row ? unitOf(row.unitId) : undefined;
    if (!row || !unit) {
      selection.unitId = null;
      selection.aim = null;
      return null;
    }
    const reach = row.canMove ? reachableFor(game, row.unitId) : [];
    const targets = row.type === "tank" && row.canFire ? tankTargets(game, row.unitId) : [];
    return { row, unit, reach, targets };
  };
  let pick = picked();

  // The button reads "Whole map" when zoomed in and "Zoom to base" once the whole map is in view.
  const wholeLabel = (mv: MapView): string => (mv.isWhole() ? "Zoom to base" : "Whole map");
  const wholeButton = el("button", { class: "btn menu-btn", "data-testid": "whole-map" }) as HTMLButtonElement;
  const mapView = createMapView({
    view,
    width: MAP_W,
    height: MAP_H,
    camera: start,
    onCamera: (c) => {
      remembered = { key, camera: c };
      wholeButton.textContent = wholeLabel(mapView);
    },
    onTap: (p) => onTap(p),
  });
  remembered = { key, camera: mapView.camera() };
  wholeButton.textContent = wholeLabel(mapView);
  wholeButton.addEventListener("click", () => (mapView.isWhole() ? mapView.focusBase() : mapView.fitWhole()));

  /**
   * A change on the screen only (a pick, an aim, a tip): the marks and the panel are drawn again in
   * place while the map, the camera and everything under the marks stay as they are.
   */
  const refresh = (): void => {
    pick = picked();
    mapView.clearOverlay();
    drawMarks();
    const next = buildPanel();
    panel.replaceWith(next);
    panel = next;
  };

  const refused = (reason: Failure): void => {
    selection.tip = ctx.problemTip(reason) || "Not now.";
    refresh();
  };

  /**
   * An order went through: show what it did, drop the aim, and let the rules' new game redraw
   * everything. The buzz comes from the hits the shooter may know about (a tank's always; a shell's
   * as shooterView keeps them), never from what the fog hides.
   */
  const done = (g: Game, result: string, destroyed: boolean): void => {
    selection.result = result;
    selection.tip = null;
    selection.aim = null;
    if (destroyed) navigator.vibrate?.(60);
    ctx.setGame(g);
  };

  const fireAt = (aim: Point): void => {
    if (!pick) return;
    const r = fireArtillery(game, pick.row.unitId, aim);
    if (!r.ok) return refused(r.reason);
    done(r.game, describeShell(r.shot, r.game, viewer), shooterView(r.shot).hits.some((h) => h.destroyed));
  };

  const select = (unitId: string): void => {
    if (selection.unitId !== unitId) selection.aim = null;
    selection.unitId = unitId;
    selection.tip = null;
  };

  /** A tap on the map. Returns true when it did something, so the map view knows it was no half of a double tap. */
  const onTap = (p: Point): boolean => {
    if (view.over) return false;
    const hadTip = selection.tip !== null;
    selection.tip = null;
    const hit = mapView.unitAt(p);
    // 1. One of your active units: pick it. An enemy in range of the picked tank: shoot it.
    if (hit && hit.owner === viewer && rowOf(hit.id)) {
      select(hit.id);
      refresh();
      return true;
    }
    if (hit && hit.owner !== viewer && pick && pick.targets.includes(hit.id)) {
      const r = fireTank(game, pick.row.unitId, hit.id);
      if (r.ok) done(r.game, describeTankShot(r.shot, r.game), r.shot.hits.some((h) => h.destroyed));
      else refused(r.reason);
      return true;
    }
    // 2. Reachable ground under a picked tank or truck: go there, and stay picked.
    if (pick && pick.row.canMove) {
      const to = moveTarget(pick.unit, pick.reach, p);
      if (to) {
        const { row } = pick;
        const r = moveUnit(game, row.unitId, to);
        if (r.ok) {
          const event = r.game.strategic?.events.at(-1);
          const riders = event?.kind === "move" ? event.riders.length : 0;
          const stopped = event?.kind === "move" && (event.to.x !== to.x || event.to.y !== to.y);
          done(r.game, describeMove(orderLabel(row.unitId, row.type), riders, stopped), false);
        } else refused(r.reason);
        return true;
      }
    }
    // 3. A picked artillery: aim where the tap fell, or fire when the tap is on the aim already set.
    if (pick && pick.row.type === "artillery" && pick.row.canFire) {
      if (selection.aim && Math.hypot(p.x - selection.aim.x, p.y - selection.aim.y) <= AIM_TAP) {
        fireAt(selection.aim);
        return true;
      }
      const problem = aimProblem(game, pick.row.unitId, p);
      if (problem === null) {
        selection.aim = p;
        selection.result = null;
      } else {
        selection.tip = problem === "too_close" ? ctx.problemTip("too_close") : "Aim on the paper.";
      }
      refresh();
      return true;
    }
    // 4. Anything else: nothing is picked any more. With nothing picked to begin with the tap
    // changes nothing, and the map is left alone so a second quick tap can zoom in on the spot.
    if (!pick && !hadTip) return false;
    selection.unitId = null;
    selection.aim = null;
    selection.result = null;
    refresh();
    return true;
  };

  /** The marks for the current pick: where it can go, what it can shoot, the aim, and the pick itself. */
  const drawMarks = (): void => {
    if (!pick) return;
    const { row, unit, reach, targets } = pick;
    if (reach.length > 0) mapView.markSquares(reach.flatMap((tl) => squaresOf(footprintAt(unit, tl.x, tl.y))), "strategic-reach");
    for (const id of targets) {
      const enemy = view.enemies.find((u) => u.id === id && u.current);
      if (enemy) mapView.markRect(footprintOf(enemy), "strategic-target");
    }
    if (row.type === "artillery" && row.canFire) {
      mapView.markRect(footprintOf(unit), "strategic-minrange", ARTILLERY_MIN_RANGE);
      if (selection.aim) mapView.markAim(selection.aim, shakeFor(game, row.unitId, selection.aim));
    }
    mapView.markRect(footprintOf(unit), "strategic-selected");
    if (row.type === "truck" && (row.riders ?? 0) > 0) mapView.overlay.append(ridersLabel(footprintOf(unit), row.riders as number));
  };

  const orderRow = (row: OrderRow): HTMLElement => {
    const isPicked = row.unitId === selection.unitId;
    const moveState = row.type === "artillery" ? ["Stay", "off"] : row.moved ? ["Moved", "done"] : row.canMove ? ["Move", "on"] : ["Stuck", "off"];
    const fireState = row.type === "truck" ? ["—", "off"] : row.fired ? ["Fired", "done"] : row.canFire ? ["Fire", "on"] : ["No target", "off"];
    return el(
      "button",
      {
        class: `order-row${isPicked ? " selected" : ""}`,
        "data-testid": `order-${row.unitId}`,
        "aria-pressed": isPicked ? "true" : "false",
        onclick: () => {
          select(row.unitId);
          const u = unitOf(row.unitId);
          if (u) mapView.centreOn(centreOf(footprintOf(u)));
          refresh();
        },
      },
      el("span", { class: "order-name" }, orderLabel(row.unitId, row.type)),
      el(
        "span",
        { class: "order-state" },
        el("span", { class: `order-move ${moveState[1]}` }, moveState[0]),
        el("span", { class: `order-fire ${fireState[1]}` }, fireState[0]),
        (row.riders ?? 0) > 0 && el("span", { class: "order-riders" }, `+${row.riders}`),
      ),
    );
  };

  const infantry = view.units.filter((u) => u.type === "infantry" && u.state !== "destroyed").length;
  const name = game.players[viewer].name;

  /** The side panel for the current pick. */
  const buildPanel = (): HTMLElement => {
    const showFire = !!pick && pick.row.type === "artillery" && pick.row.canFire && !!selection.aim;
    const line = selection.tip ?? (showFire ? null : selection.result);
    // The panel has two moods, so that everything always fits above the buttons: with nothing picked
    // it tells the story (the whole report, the infantry line); with a unit picked it is about the
    // order (the report's first line only, the result or tip, and Fire).
    const report = pick ? view.report.slice(0, 1) : view.report;
    return el(
      "div",
      { class: "panel" },
      el("div", { class: "menu-row" }, ctx.menuButton(), wholeButton),
      el("div", { class: `panel-name${name.length > 13 ? " long" : ""}`, "data-testid": "shooter" }, name),
      el(
        "div",
        { class: "panel-sub" },
        el("span", { "data-testid": "turn" }, `Turn ${view.turnNumber}`),
        " · ",
        el("span", { "data-testid": "explored" }, `Explored ${view.exploredPercent}%`),
      ),
      report.length > 0 &&
        el(
          "div",
          { class: `report${pick ? " brief" : ""}`, "data-testid": "report" },
          report.map((t) => el("p", { class: t.startsWith("Lost:") ? "wrap" : undefined }, t)),
        ),
      el("div", { class: "rule" }),
      !view.over &&
        (rows.length > 0
          ? el("div", { class: "orders", "data-testid": "orders" }, el("div", { class: "orders-title" }, "Orders"), rows.map(orderRow))
          : el("p", { class: "strategic-line soft", "data-testid": "orders-empty" }, "No units left to order.")),
      !view.over && !pick && el("p", { class: "strategic-line soft", "data-testid": "infantry-note" }, `${infantry} infantry act on their own.`),
      line && el("p", { class: `result${selection.tip ? " tip" : ""}`, "data-testid": "result" }, line),
      showFire && el("button", { class: "btn danger", "data-testid": "fire", onclick: () => selection.aim && fireAt(selection.aim) }, "Fire"),
      el("div", { class: "spacer" }),
      view.over
        ? el("button", { class: "btn primary", "data-testid": "see-results", onclick: () => ctx.showResults() }, "See results")
        : el(
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
  };

  // The overlay is lost when the map is rebuilt, so it is drawn again from the selection every time.
  drawMarks();
  let panel = buildPanel();

  // The game ended on this turn: only the attacker can be looking, but the loser's line is here for safety.
  const banner =
    view.over &&
    el("div", { class: "banner strategic-banner", "data-testid": "banner" }, view.winner === viewer ? "Enemy fort destroyed! You win" : "Your fort has fallen");

  return el("div", { class: "screen game strategic" }, mapView.root, banner, panel, ctx.overlay());
}

/** "+2 riders" above a picked truck, with a paper halo so it reads over the grid. */
function ridersLabel(truck: Rect, riders: number): SVGTextElement {
  const S = SQ_NEAR;
  return sv(
    "text",
    {
      x: (truck.x + truck.w / 2) * S,
      y: truck.y * S - 8,
      "text-anchor": "middle",
      "font-size": 15,
      fill: "#2f5fa7",
      stroke: "#faf9f4",
      "stroke-width": 4,
      "paint-order": "stroke",
      "stroke-linejoin": "round",
      class: "strategic-riders",
    },
    `+${riders} ${riders === 1 ? "rider" : "riders"}`,
  );
}
