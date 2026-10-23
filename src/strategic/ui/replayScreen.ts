import type { Game, PlayerIndex } from "../../rules/game.ts";
import { el, sv } from "../../ui/dom.ts";
import type { Point, Replay, ReplayMark, ReplayStep, StrategicMap } from "../rules/types.ts";
import { baseCamera, centreCamera, createMapView, fitCamera, footprintOf, toScreen, type Camera, type MapView } from "./mapView.ts";
import { MAP_H, MAP_W } from "./screen.ts";
import "./replay.css";

/**
 * The replay screen, in two modes. Handover: when a player picks up the phone, before their turn,
 * it plays what their units saw of the enemy's turn and their own start of turn (decision 15), as
 * the rules built it (replayFor). Match: from the results screen, the whole match turn by turn with
 * the fog lifted (matchReplay). Each step is a ready-made map (its frame) plus a few marks; the
 * screen only draws them, slides the units that moved and pans to where it happened, so nothing the
 * fog hid can leak from here.
 */

/** What the screen needs from app.ts, passed in so this file never imports the app. */
export interface ReplayContext {
  mode: "handover" | "match";
  /** The small Menu button (handover only; the match replay has none). */
  menuButton(): HTMLElement;
  /** The in-game Menu overlay while it is open, or null. */
  overlay(): HTMLElement | null;
  /** "Start my turn" (handover) or "Back to results" (match). */
  done(): void;
}

export type ReplayMode = ReplayContext["mode"];

/** How long each step shows while playing, in ms: the enemy's moves need a moment to read, a whole match should not drag. */
export const STEP_MS = { enemy: 1400, own: 1000, turn: 700 } as const;
/** A unit slides from its old place to its new one in this long. */
export const SLIDE_MS = 600;
/** A short eased pan when the next step happens outside the middle of the view. */
export const PAN_MS = 450;
/** The middle 70% of the view counts as "in view": only a step outside it moves the camera. */
export const FOCUS_MARGIN = 0.15;
/**
 * Stage px at the map's bottom edge that the controls pill covers (a 52 px pill 8 px off the edge,
 * plus a little air): the replay aims at the map above it, fits the whole map above it, and lets
 * the map's last row be panned up clear of it.
 */
export const CONTROLS_SPACE = 64;

/** How long a step stays up while playing. */
export function stepMs(mode: ReplayMode, part: ReplayStep["part"]): number {
  return mode === "match" ? STEP_MS.turn : STEP_MS[part];
}

/**
 * "Step 7 of 31" under the map, in both modes. A match replay has one step per Game.turn, but its
 * chip and list count each player's own turns ("Turn 4 · Ana"), so calling this "Turn 7" would put
 * two different turn numbers on screen for the same moment.
 */
export function counterText(index: number, count: number): string {
  return `Step ${count === 0 ? 0 : index + 1} of ${count}`;
}

/** The chip over the map: whose turn this step comes from. */
export function chipText(mode: ReplayMode, step: Pick<ReplayStep, "part" | "text"> | undefined, enemyName: string): string {
  if (!step) return mode === "match" ? "The whole match" : "While you were away";
  if (mode === "match") return step.text;
  return step.part === "own" ? "Start of your turn" : `${enemyName}'s turn`;
}

/** Playback position: which step is showing and whether it moves on by itself. */
export interface Playback {
  index: number;
  playing: boolean;
}

/** One tick of the clock: on to the next step, or stop on the last one (the replay never closes itself). */
export function afterTick(at: Playback, count: number): Playback {
  if (!at.playing) return at;
  if (at.index < count - 1) return { index: at.index + 1, playing: true };
  return { index: Math.max(0, count - 1), playing: false };
}

/** The play/pause button: pause while playing; play from here when paused; from step 1 again once at the last step. */
export function pressPlay(at: Playback, count: number): Playback {
  if (count === 0) return { index: 0, playing: false };
  if (at.playing) return { index: at.index, playing: false };
  if (at.index >= count - 1) return { index: 0, playing: true };
  return { index: at.index, playing: true };
}

/**
 * Whether a map point lies in the middle of the part of the view the replay can use: the map above
 * the controls pill, with `margin` of that area's width and height kept clear on every side.
 */
export function inClearView(c: Camera, p: Point, width: number, height: number, bottom = CONTROLS_SPACE, margin = FOCUS_MARGIN): boolean {
  const s = toScreen(c, p, width, height);
  const h = height - bottom;
  return s.x >= margin * width && s.x <= (1 - margin) * width && s.y >= margin * h && s.y <= (1 - margin) * h;
}

/** The point to centre the camera on so that `p` lands in the middle of the map above the controls, at the camera's zoom. */
export function clearViewCentre(c: Camera, p: Point, bottom = CONTROLS_SPACE): Point {
  return { x: p.x, y: p.y + bottom / 2 / c.scale };
}

/**
 * Where a handover replay opens: on the player's base, as the turn screen does (centred above the
 * controls), unless the first step happened outside the middle of that view, in which case it opens
 * looking at the first step.
 */
export function replayStartCamera(
  map: Pick<StrategicMap, "w" | "h">,
  base: Point,
  focus: Point | null,
  width: number,
  height: number,
  bottom = CONTROLS_SPACE,
): Camera {
  const home = baseCamera(map, base, width, height, bottom);
  if (!focus || inClearView(home, focus, width, height, bottom)) return home;
  return centreCamera(home, clearViewCentre(home, focus, bottom), map, width, height, bottom);
}

/** The scroll position that brings a list item (top and bottom in the list's own px) into view, changing as little as it can. */
export function scrollToShow(top: number, bottom: number, scrollTop: number, height: number, pad = 4): number {
  if (top - pad < scrollTop) return Math.max(0, top - pad);
  if (bottom + pad > scrollTop + height) return Math.max(0, Math.min(top - pad, bottom + pad - height));
  return scrollTop;
}

type StepMove = ReplayStep["moves"][number];

/** One slide per unit: a unit that moved twice in a step (an infantry that marched, then rode the truck) slides from its first place to its last. */
export function mergeMoves(moves: readonly StepMove[]): StepMove[] {
  const byUnit = new Map<string, StepMove>();
  for (const m of moves) {
    const k = `${m.owner}:${m.unitId}`;
    const was = byUnit.get(k);
    byUnit.set(k, was ? { ...was, to: m.to } : { ...m });
  }
  return [...byUnit.values()];
}

/** Two map points closer than this (squares) are the same point: track ends are worked out by the rules in the same way. */
const SAME_POINT = 0.05;

/**
 * Where a unit's slide starts (top-left square), or null for no slide. The viewer's own units (and
 * everything in a match replay, where the fog is lifted) slide from where they really were. An enemy
 * slides only along the part of its track the viewer could see: from the first point of the track
 * that ends at it, so an enemy coming out of the fog never shows where it came from.
 */
export function slideStart(step: Pick<ReplayStep, "frame" | "marks">, move: StepMove, fogLifted: boolean): Point | null {
  if (fogLifted || move.owner === step.frame.viewer) return move.from;
  const drawn = step.frame.enemies.find((u) => u.id === move.unitId && u.current && u.state !== "destroyed");
  if (!drawn) return null;
  const size = footprintOf({ ...drawn, x: 0, y: 0 });
  const end = { x: move.to.x + size.w / 2, y: move.to.y + size.h / 2 };
  for (const m of step.marks) {
    if (m.kind !== "track" || m.owner !== move.owner) continue;
    const last = m.points[m.points.length - 1];
    const first = m.points[0];
    if (!last || !first || Math.hypot(last.x - end.x, last.y - end.y) > SAME_POINT) continue;
    return { x: first.x - size.w / 2, y: first.y - size.h / 2 };
  }
  return null;
}

/** Whether the player asked their phone for less motion: then units jump and the camera cuts instead of panning. */
function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * What the screen is doing, kept across renders for the same game and turn: render() rebuilds every
 * screen whenever anything changes (the Menu opening, say), and that must never restart the replay
 * or move the map.
 */
interface ReplayMemory extends Playback {
  key: string;
  camera: Camera | null;
  /** The step list's scroll position. */
  scroll: number;
  /** A pan under way to a step, so a re-render in the middle of it finishes the pan instead of stopping short. */
  pan: { to: Point; until: number } | null;
}

const blankMemory = (key: string, playing: boolean): ReplayMemory => ({ key, index: 0, playing, camera: null, scroll: 0, pan: null });

let memory: ReplayMemory = blankMemory("", false);

/** The one pending tick. Only the newest screen may tick: building a screen cancels the last one's clock. */
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;

/**
 * Forgets where the replay was, so the next one opens at step 1 and plays. The screen's own Start my
 * turn and Back to results do this; app.ts calls it when the replay is left another way (Android
 * back from Watch the match), since a finished game keeps the same seed and turn and the memory
 * would otherwise pick up where the player left off.
 */
export function forgetReplay(): void {
  clearTimeout(timer);
  generation++;
  memory = blankMemory("", false);
}

/** Draws one replay mark into the map view's overlay. */
function drawMark(mv: MapView, m: ReplayMark): void {
  if (m.kind === "track") mv.markTrack(m.points, m.owner);
  else if (m.kind === "shot") mv.markShot(m);
  else if (m.kind === "clash") mv.markClash(m.at);
  else mv.markSpawn(m.at);
}

const PLAY_ICON = "M3 2 L15 9 L3 16 Z";
const PAUSE_ICON = "M5 3 V15 M12 3 V15";

export function strategicReplayScreen(game: Game, replay: Replay, ctx: ReplayContext): HTMLElement {
  const mode = ctx.mode;
  const steps = replay.steps;
  const count = steps.length;
  const key = `${mode}:${game.seed}:${game.turn}`;
  const fresh = memory.key !== key;
  if (fresh) memory = blankMemory(key, count > 0);
  memory.index = Math.min(Math.max(0, memory.index), Math.max(0, count - 1));

  const gen = ++generation;
  clearTimeout(timer);
  const overlay = ctx.overlay();
  const viewer: PlayerIndex = replay.before.viewer;
  const enemyName = game.players[viewer === 0 ? 1 : 0].name;
  const names: [string, string] = [game.players[0].name, game.players[1].name];
  const map = replay.before.map;
  const fogLifted = mode === "match";

  // The map side: a slot for the step's map view, the chip and the controls over it.
  const mapSlot = el("div", { class: "replay-map-slot" });
  const chip = el("div", { class: "replay-chip", "data-testid": "replay-chip" });
  const icon = sv("path", { d: PLAY_ICON });
  const playButton = el(
    "button",
    { class: "replay-play", "data-testid": "replay-play", type: "button", onclick: () => toggle() },
    sv("svg", { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": "true" }, icon),
  );
  const fill = el("div", { class: "replay-progress-fill" });
  const progress = el(
    "div",
    {
      class: "replay-progress",
      "data-testid": "replay-progress",
      role: "progressbar",
      "aria-label": mode === "match" ? "Turns watched" : "Steps watched",
      "aria-valuemin": 0,
      "aria-valuemax": count,
    },
    fill,
  );
  const counter = el("span", { class: "replay-counter", "data-testid": "replay-counter" });
  const mapBox = el(
    "div",
    { class: "replay-map" },
    mapSlot,
    chip,
    el("div", { class: "replay-controls" }, playButton, progress, counter),
  );

  // The panel: the steps as buttons, enemy steps first and the player's own start of turn under a divider.
  const firstOwn = mode === "handover" ? steps.findIndex((s) => s.part === "own") : -1;
  const stepButtons = steps.map((s, i) =>
    el(
      "button",
      { class: "replay-step", "data-testid": `replay-step-${i + 1}`, "data-part": s.part, type: "button", onclick: () => jump(i) },
      mode === "handover" && el("span", { class: "replay-step-n" }, `${i + 1}.`),
      el("span", { class: "replay-step-text" }, s.text),
    ),
  );
  const list = el(
    "div",
    { class: "replay-list", "data-testid": "replay-list" },
    stepButtons.map((b, i) => [i === firstOwn && el("div", { class: "replay-divider", "data-testid": "replay-divider" }, "Start of your turn"), b]),
    count === 0 && el("p", { class: "replay-empty" }, "Nothing to show."),
  );
  /** Fades the list's top or bottom edge while there is more to scroll that way, so a cut-off line reads as "more". */
  const markEdges = (): void => {
    list.classList.toggle("more-above", list.scrollTop > 1);
    list.classList.toggle("more-below", list.scrollTop + list.clientHeight < list.scrollHeight - 1);
  };
  list.addEventListener("scroll", () => {
    if (gen === generation) memory.scroll = list.scrollTop;
    markEdges();
  });

  const panel = el(
    "div",
    { class: "panel" },
    mode === "handover" && el("div", { class: "menu-row" }, ctx.menuButton()),
    el("div", { class: "replay-title" }, mode === "handover" ? "While you were away" : "The whole match"),
    el("div", { class: "rule" }),
    list,
    el("div", { class: "spacer" }),
    el(
      "button",
      { class: "btn primary", "data-testid": "replay-done", type: "button", onclick: () => finish() },
      mode === "handover" ? "Start my turn" : "Back to results",
    ),
  );

  const root = el("div", { class: "screen game strategic-replay", "data-testid": "strategic-replay", "data-mode": mode }, mapBox, panel, overlay);

  let mapView: MapView | null = null;

  /** Everything around the map that follows the step and the play state. */
  const refresh = (): void => {
    const step = steps[memory.index];
    chip.textContent = chipText(mode, step, enemyName);
    counter.textContent = counterText(memory.index, count);
    const shown = count === 0 ? 0 : memory.index + 1;
    fill.style.width = `${count === 0 ? 0 : (100 * shown) / count}%`;
    progress.setAttribute("aria-valuenow", String(shown));
    progress.setAttribute("aria-valuetext", counter.textContent);
    stepButtons.forEach((b, i) => {
      b.classList.toggle("current", i === memory.index);
      if (i === memory.index) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    });
    icon.setAttribute("d", memory.playing ? PAUSE_ICON : PLAY_ICON);
    playButton.setAttribute("aria-label", memory.playing ? "Pause the replay" : memory.index >= count - 1 && count > 1 ? "Play the replay from the start" : "Play the replay");
    root.dataset.step = String(shown);
    root.dataset.playing = memory.playing ? "true" : "false";
  };

  /** Keeps the current step in sight in the list, which scrolls inside its own box. */
  const keepCurrentInView = (): void => {
    const b = stepButtons[memory.index];
    if (!b || !list.isConnected) return;
    list.scrollTop = scrollToShow(b.offsetTop, b.offsetTop + b.offsetHeight, list.scrollTop, list.clientHeight);
    memory.scroll = list.scrollTop;
    markEdges();
  };

  /**
   * Shows step i: a fresh map view from its frame at the remembered camera, with its marks. When the
   * step is new on screen (`animate`), the units that moved slide into place and the camera pans to
   * the step if it happened outside the middle of the view; a re-render shows it as it stands.
   */
  const show = (i: number, animate: boolean): void => {
    memory.index = i;
    const step = steps[i];
    const frame = step?.frame ?? replay.before;
    // The match opens on the whole map, fitted above the controls so the pill hides none of it.
    const start =
      memory.camera ??
      (fogLifted ? fitCamera(map, MAP_W, MAP_H, CONTROLS_SPACE) : replayStartCamera(map, frame.base, steps[0]?.focus ?? null, MAP_W, MAP_H));
    const mv: MapView = createMapView({
      view: frame,
      width: MAP_W,
      height: MAP_H,
      camera: start,
      // The pill covers the map's bottom edge: the camera may lift the last rows above it.
      bottomInset: CONTROLS_SPACE,
      minimap: false,
      names: fogLifted ? names : undefined,
      // Only the view on screen speaks for the camera: a view being replaced may still finish a pan.
      onCamera: (c) => {
        if (mapView === mv && gen === generation) memory.camera = c;
      },
    });
    mapView = mv;
    memory.camera = mv.camera();
    if (step) {
      for (const m of step.marks) drawMark(mv, m);
      const motion = animate && !reducedMotion();
      if (motion) {
        for (const move of mergeMoves(step.moves)) {
          const from = slideStart(step, move, fogLifted);
          if (from) mv.slideUnit(move.unitId, move.owner, from, move.to, SLIDE_MS);
        }
      }
      const now = performance.now();
      if (animate) {
        memory.pan = null;
        if (!inClearView(mv.camera(), step.focus, MAP_W, MAP_H)) {
          const to = clearViewCentre(mv.camera(), step.focus);
          mv.panTo(to, motion ? PAN_MS : 0);
          if (motion) memory.pan = { to, until: now + PAN_MS };
        }
      } else if (memory.pan && memory.pan.until > now) {
        mv.panTo(memory.pan.to, memory.pan.until - now);
      }
    }
    mapSlot.replaceChildren(mv.root);
    refresh();
    if (animate) keepCurrentInView();
  };

  /**
   * The clock: while playing, each step stays up for its time and then the next one shows. It holds
   * while the Menu is open (the replay goes on when the menu closes) and stops for good once this
   * screen has been replaced or taken off the stage.
   */
  const schedule = (): void => {
    clearTimeout(timer);
    const step = steps[memory.index];
    if (!memory.playing || overlay || !step) return;
    timer = setTimeout(() => {
      if (gen !== generation || !root.isConnected) return;
      const next = afterTick(memory, count);
      const moved = next.index !== memory.index;
      memory.playing = next.playing;
      if (moved) show(next.index, true);
      else refresh();
      schedule();
    }, stepMs(mode, step.part));
  };

  const toggle = (): void => {
    const next = pressPlay(memory, count);
    memory.playing = next.playing;
    // Playing again shows the step afresh, so the button answers at once instead of after a pause.
    if (next.playing) show(next.index, true);
    else refresh();
    schedule();
  };

  /** A tap on a step in the list: show it and pause there. */
  const jump = (i: number): void => {
    memory.playing = false;
    show(i, true);
    schedule();
  };

  const finish = (): void => {
    forgetReplay();
    ctx.done();
  };

  show(memory.index, fresh);
  schedule();

  // The list can only be scrolled once the app has put the screen on the stage, right after this returns.
  const placeList = (): void => {
    if (gen !== generation) return;
    list.scrollTop = memory.scroll;
    keepCurrentInView();
    markEdges();
  };
  queueMicrotask(() => (list.isConnected ? placeList() : typeof requestAnimationFrame === "function" && requestAnimationFrame(placeList)));

  return root;
}
