import {
  ARMY,
  GRID_H,
  GRID_W,
  UNIT_TYPES,
  type UnitType,
} from "../rules/constants.ts";
import {
  confirmHandoff,
  createGame,
  endTurn,
  finishBuild,
  fire,
  isArmyComplete,
  isRepeatOfMiss,
  placeUnit,
  removeUnit,
  shotStats,
  unitsLeft,
  FIGHTING_UNITS,
  type Failure,
  type Game,
  type PlayerIndex,
} from "../rules/game.ts";
import { randomLayout } from "../rules/layout.ts";
import { placementProblem, snapWall, type Candidate } from "../rules/placement.ts";
import { ARMY_SLOTS, rectOf, sizeOf, unitState, type Unit } from "../rules/units.ts";
import { targetView } from "../rules/view.ts";
import { UNIT_LABEL, unitArt } from "./art.ts";
import {
  SQ,
  createBoard,
  drawMagnifier,
  drawShot,
  drawUnit,
  type Board,
} from "./board.ts";
import { el, sv } from "./dom.ts";
import { clearGame, loadGame, saveGame } from "./store.ts";
import { HOW_TO_PLAY, describeIncoming, describeShot } from "./text.ts";

type Screen = "menu" | "howto" | "setup" | "game";

interface Ui {
  screen: Screen;
  names: [string, string];
  game: Game | null;
  /** Shown after loading a saved game: the phone may have changed hands, so cover the base first. */
  gate: PlayerIndex | null;
  view: "mine" | "target";
  aim: { x: number; y: number } | null;
  /** After the winning shot the shooter looks at the result first, then taps through to the end screen. */
  endShown: boolean;
  turnKey: string;
  popover: "you" | "enemy" | null;
  tip: string;
}

const ui: Ui = {
  screen: "menu",
  names: ["", ""],
  game: null,
  gate: null,
  view: "mine",
  aim: null,
  endShown: false,
  turnKey: "",
  popover: null,
  tip: "",
};

const other = (p: PlayerIndex): PlayerIndex => (p === 0 ? 1 : 0);

function stage(): HTMLElement {
  return document.getElementById("stage") as HTMLElement;
}

function setGame(game: Game): void {
  ui.game = game;
  saveGame(game);
  render();
}

function goFullscreen(): void {
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) {
      void root
        .requestFullscreen()
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
        .catch(() => {});
    }
  } catch {
    // Not every browser allows this; the game works without it.
  }
}

function seedFor(): number {
  const fromUrl = Number(new URLSearchParams(location.search).get("seed"));
  if (Number.isInteger(fromUrl) && new URLSearchParams(location.search).has("seed")) return fromUrl >>> 0;
  return Math.floor(Math.random() * 2 ** 32);
}

export function render(): void {
  const root = stage();
  let screenName: string = ui.screen;
  let node: HTMLElement;
  const game = ui.game;
  if (ui.screen !== "game" || !game) {
    node = ui.screen === "howto" ? howToScreen() : ui.screen === "setup" ? setupScreen() : menuScreen();
  } else if (ui.gate !== null) {
    screenName = "handoff";
    node = handoffScreen(game.players[ui.gate].name, () => {
      ui.gate = null;
      render();
    });
  } else if (game.phase === "handoff" && game.handoff) {
    screenName = "handoff";
    node = handoffScreen(game.players[game.handoff.to].name, () => {
      const r = confirmHandoff(game);
      if (r.ok) setGame(r.game);
    });
  } else if (game.phase === "build") {
    screenName = "build";
    node = buildScreen(game);
  } else if (game.phase === "turn" || (game.phase === "over" && !ui.endShown)) {
    screenName = "battle";
    node = battleScreen(game);
  } else {
    screenName = "over";
    node = gameOverScreen(game);
  }
  document.body.dataset.screen = screenName;
  root.replaceChildren(node);
}

// ---------------------------------------------------------------------------
// Menu, setup and How to play

function menuScreen(): HTMLElement {
  const saved = loadGame();
  const canContinue = !!saved && saved.phase !== "over";
  return el(
    "div",
    { class: "screen center", "data-testid": "menu" },
    el("h1", { class: "title" }, "Pencil Army Base"),
    el("p", { class: "subtitle" }, "Two players. One phone. Hide your army, find theirs."),
    el(
      "div",
      { class: "menu-buttons" },
      el(
        "button",
        {
          class: "btn primary",
          "data-testid": "new-game",
          onclick: () => {
            goFullscreen();
            ui.names = ["", ""];
            ui.screen = "setup";
            render();
          },
        },
        "New game",
      ),
      canContinue &&
        el(
          "button",
          {
            class: "btn",
            "data-testid": "continue",
            onclick: () => {
              goFullscreen();
              resume(saved);
            },
          },
          "Continue",
        ),
      el("button", { class: "btn", "data-testid": "how-to-play", onclick: () => ((ui.screen = "howto"), render()) }, "How to play"),
    ),
  );
}

function resume(game: Game): void {
  ui.game = game;
  ui.screen = "game";
  ui.turnKey = "";
  ui.endShown = false;
  ui.gate = game.phase === "build" ? game.building : game.phase === "turn" ? game.current : null;
  render();
}

function howToScreen(): HTMLElement {
  return el(
    "div",
    { class: "screen howto", "data-testid": "how-to-play-screen" },
    el("button", { class: "btn back", onclick: () => ((ui.screen = "menu"), render()) }, "Back"),
    el(
      "div",
      { class: "howto-scroll" },
      el("h2", {}, "How to play"),
      HOW_TO_PLAY.map((s) => [el("h3", {}, s.heading), s.body.map((t) => el("p", {}, t))]),
    ),
  );
}

function setupScreen(): HTMLElement {
  const input = (i: 0 | 1) =>
    el("input", {
      class: "name-input",
      type: "text",
      maxlength: 20,
      placeholder: "Random pencil officer",
      value: ui.names[i],
      "data-testid": `name-${i + 1}`,
      "aria-label": `Player ${i + 1} name`,
      oninput: (e: Event) => (ui.names[i] = (e.target as HTMLInputElement).value),
    });
  return el(
    "div",
    { class: "screen center", "data-testid": "setup" },
    el("h2", {}, "Who's playing?"),
    el("p", { class: "subtitle" }, "Type a name, or leave it blank and the game picks one. Who shoots first is chosen at random."),
    el("div", { class: "setup-row" }, el("label", {}, "Player 1", input(0)), el("label", {}, "Player 2", input(1))),
    el(
      "div",
      { class: "menu-buttons row" },
      el("button", { class: "btn", onclick: () => ((ui.screen = "menu"), render()) }, "Back"),
      el(
        "button",
        {
          class: "btn primary",
          "data-testid": "start-game",
          onclick: () => {
            ui.screen = "game";
            ui.turnKey = "";
            ui.endShown = false;
            ui.gate = null;
            ui.view = "mine";
            ui.aim = null;
            setGame(createGame({ seed: seedFor(), names: [ui.names[0], ui.names[1]] }));
          },
        },
        "Start",
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Black handoff screen

function handoffScreen(name: string, onStart: () => void): HTMLElement {
  return el(
    "div",
    { class: "screen center handoff", "data-testid": "handoff" },
    el("h1", { class: "handoff-title" }, `Pass to ${name}`),
    el("p", { class: "handoff-note" }, "No peeking. Tap Start when only you can see the screen."),
    el("button", { class: "btn handoff-start", "data-testid": "start", onclick: onStart }, "Start"),
  );
}

// ---------------------------------------------------------------------------
// Build screen

const PROBLEM_TIP: Record<Failure, string> = {
  out_of_bounds: "That doesn't fit on the grid.",
  overlap: "Something is already there.",
  upright_only_for_walls: "Only walls can stand upright.",
  upright_not_beside_fort: "Walls only stand upright beside the fort.",
  wrong_phase: "",
  unknown_unit: "",
  army_incomplete: "",
  shot_already_fired: "",
  shot_not_fired: "",
};

/** How far above the finger a dragged unit floats, in squares, so the finger does not hide it. */
const TOUCH_LIFT = 0.8;

function buildScreen(game: Game): HTMLElement {
  const player = game.building;
  const units = game.players[player].units;
  const board = createBoard({ tint: "own", testid: "board" });
  const tip = el("p", { class: "tip", "data-testid": "tip" }, ui.tip);
  let dragId: string | null = null;

  const drawUnits = () => {
    board.units.replaceChildren();
    for (const u of units) drawUnit(board.units, { ...u, state: "normal" }, SQ, { opacity: u.id === dragId ? 0.25 : 1 });
  };
  drawUnits();

  /** The unit under a point, smallest first so infantry beside a wall can still be picked up. */
  const unitAt = (x: number, y: number): Unit | undefined =>
    [...units]
      .sort((a, b) => rectArea(a) - rectArea(b))
      .find((u) => {
        const r = rectOf(u);
        return x >= r.x - 0.2 && x <= r.x + r.w + 0.2 && y >= r.y - 0.2 && y <= r.y + r.h + 0.2;
      });

  const startDrag = (e: PointerEvent, id: string, type: UnitType, fromGrid: boolean, capture: Element) => {
    e.preventDefault();
    capture.setPointerCapture(e.pointerId);
    const lift = e.pointerType === "mouse" ? 0 : TOUCH_LIFT;
    const others = units.filter((u) => u.id !== id);
    const fort = others.find((u) => u.type === "fort");
    let cand: Candidate | null = null;
    let valid = false;
    let inGrid = false;
    dragId = fromGrid ? id : null;
    if (fromGrid) drawUnits();

    const update = (ev: PointerEvent) => {
      const g = board.toGrid(ev);
      const cx = g.x;
      const cy = g.y - lift;
      inGrid = cx >= 0 && cx <= GRID_W && cy >= 0 && cy <= GRID_H;
      const size = sizeOf(type, false);
      cand = { type, upright: false, x: Math.round(cx - size.w / 2), y: Math.round(cy - size.h / 2) };
      if (type === "wall" && fort) cand = snapWall(fort, cx, cy) ?? cand;
      valid = placementProblem(others, cand) === null;
      board.overlay.replaceChildren();
      if (!inGrid) return;
      const r = rectOf(cand);
      board.overlay.append(
        sv("rect", {
          x: r.x * SQ,
          y: r.y * SQ,
          width: r.w * SQ,
          height: r.h * SQ,
          class: valid ? "ghost-ok" : "ghost-bad",
        }),
      );
      drawUnit(board.overlay, { id: "ghost", ...cand, state: "normal" }, SQ, { opacity: 0.85 });
    };

    const finish = (ev: PointerEvent) => {
      capture.removeEventListener("pointermove", update as EventListener);
      capture.removeEventListener("pointerup", finish as EventListener);
      capture.removeEventListener("pointercancel", cancel as EventListener);
      update(ev);
      board.overlay.replaceChildren();
      dragId = null;
      ui.tip = "";
      if (cand && inGrid && valid) {
        const r = placeUnit(game, player, id, cand.x, cand.y, cand.upright);
        if (r.ok) return setGame(r.game);
      } else if (cand && inGrid && !valid) {
        ui.tip = PROBLEM_TIP[placementProblem(others, cand) as Failure] ?? "";
      } else if (fromGrid && !inGrid) {
        const r = removeUnit(game, player, id);
        if (r.ok) return setGame(r.game);
      }
      render();
    };
    const cancel = () => {
      capture.removeEventListener("pointermove", update as EventListener);
      capture.removeEventListener("pointerup", finish as EventListener);
      capture.removeEventListener("pointercancel", cancel as EventListener);
      dragId = null;
      render();
    };
    capture.addEventListener("pointermove", update as EventListener);
    capture.addEventListener("pointerup", finish as EventListener);
    capture.addEventListener("pointercancel", cancel as EventListener);
    update(e);
  };

  board.svg.addEventListener("pointerdown", (e) => {
    const g = board.toGrid(e);
    const u = unitAt(g.x, g.y);
    if (u) startDrag(e, u.id, u.type, true, board.svg);
  });

  const placedCount = (t: UnitType) => units.filter((u) => u.type === t).length;
  const tray = el(
    "div",
    { class: "tray" },
    UNIT_TYPES.map((type) => {
      const left = ARMY[type] - placedCount(type);
      const nextId = ARMY_SLOTS.find((s) => s.type === type && !units.some((u) => u.id === s.id))?.id;
      return el(
        "div",
        {
          class: `tray-item${left === 0 ? " empty" : ""}`,
          "data-testid": `tray-${type}`,
          "data-left": left,
          onpointerdown: (e: PointerEvent) => {
            if (nextId) startDrag(e, nextId, type, false, e.currentTarget as Element);
          },
        },
        el("img", { src: unitArt(type, "normal"), alt: "", draggable: "false" }),
        el("span", {}, `${UNIT_LABEL[type]} `, el("b", {}, `×${left}`)),
      );
    }),
  );

  const complete = isArmyComplete(units);
  const panel = el(
    "div",
    { class: "panel" },
    el("div", { class: "panel-name", "data-testid": "builder" }, game.players[player].name),
    el("div", { class: "panel-sub" }, "Build your base"),
    tray,
    tip,
    !complete && !ui.tip && el("p", { class: "tip calm" }, `Place ${ARMY_SLOTS.length - units.length} more`),
    el("div", { class: "spacer" }),
    el(
      "button",
      { class: "btn", "data-testid": "random-layout", onclick: () => ((ui.tip = ""), setGame(randomLayout(game, player))) },
      "Random layout",
    ),
    el(
      "button",
      {
        class: "btn primary",
        "data-testid": "done",
        disabled: !complete,
        onclick: () => {
          const r = finishBuild(game, player);
          if (r.ok) setGame(r.game);
        },
      },
      "Done",
    ),
  );
  return layout(board.svg, panel);
}

const rectArea = (u: Unit): number => {
  const r = rectOf(u);
  return r.w * r.h;
};

// ---------------------------------------------------------------------------
// Battle screen

function battleScreen(game: Game): HTMLElement {
  const me = game.current;
  const foe = other(me);
  const key = `${game.turn}`;
  if (ui.turnKey !== key) {
    ui.turnKey = key;
    ui.view = "mine";
    ui.aim = null;
    ui.popover = null;
  }
  const mine = game.players[me];
  const theirs = game.players[foe];
  const lastShot = mine.shots.at(-1);
  const justFired = game.shotFired ? lastShot : undefined;
  const over = game.phase === "over";

  let board: Board;
  let fireButton: HTMLButtonElement | null = null;
  let status: HTMLElement;
  const statusLines: (string | HTMLElement)[] = [];

  if (ui.view === "mine") {
    board = createBoard({ tint: "own", testid: "board" });
    for (const u of mine.units) drawUnit(board.units, { ...u, state: unitState(u) }, SQ);
    const incoming = theirs.shots;
    incoming.forEach((s, i) => {
      drawShot(board.marks, { x: s.x, y: s.y, hit: s.hits.length > 0 }, SQ);
      if (i === incoming.length - 1) {
        board.marks.append(sv("circle", { cx: s.x * SQ, cy: s.y * SQ, r: 0.95 * SQ, class: "last-shot" }));
      }
    });
    const last = incoming.at(-1);
    statusLines.push(
      last && !game.shotFired ? `Their last shot ${describeIncoming(last)}.` : last ? "Viewing your base." : "No shots fired at you yet.",
    );
    if (!game.shotFired) statusLines.push("Switch to Target to fire.");
  } else {
    const view = targetView(game, me);
    const untouched = view.shots.length === 0;
    board = createBoard({ tint: "target", label: untouched ? `${theirs.name}'s base (hidden)` : undefined, testid: "board" });
    for (const u of view.revealed) drawUnit(board.units, { ...u, state: u.state }, SQ);
    for (const s of view.shots) drawShot(board.marks, { x: s.x, y: s.y, hit: s.hits.length > 0 }, SQ);
    if (justFired) {
      board.marks.append(sv("circle", { cx: justFired.x * SQ, cy: justFired.y * SQ, r: 0.95 * SQ, class: "last-shot" }));
      statusLines.push(el("b", { "data-testid": "result" }, describeShot(justFired)));
    } else {
      statusLines.push(ui.aim ? "Tap Fire when ready." : "Tap the paper to aim.");
    }
  }

  const warning = el("p", { class: "tip", "data-testid": "warning" });
  const drawAim = () => {
    board.overlay.replaceChildren();
    if (!ui.aim) return;
    drawMagnifier(board, ui.aim.x, ui.aim.y);
    warning.textContent = isRepeatOfMiss(game, me, ui.aim.x, ui.aim.y) ? "That spot was empty last time." : "";
    if (fireButton) fireButton.disabled = false;
  };

  if (ui.view === "target" && !game.shotFired) {
    let aiming = false;
    const setAim = (e: PointerEvent) => {
      const g = board.toGrid(e);
      ui.aim = { x: Math.max(0, Math.min(GRID_W, g.x)), y: Math.max(0, Math.min(GRID_H, g.y)) };
      drawAim();
    };
    board.svg.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      board.svg.setPointerCapture(e.pointerId);
      aiming = true;
      setAim(e);
    });
    board.svg.addEventListener("pointermove", (e) => aiming && setAim(e));
    board.svg.addEventListener("pointerup", () => (aiming = false));
    board.svg.addEventListener("pointercancel", () => (aiming = false));
    drawAim();
  }

  status = el("div", { class: "status" }, statusLines.map((l) => (typeof l === "string" ? el("p", {}, l) : el("p", {}, l))), warning);

  const toggle = el(
    "div",
    { class: "toggle", role: "group", "aria-label": "View" },
    el(
      "button",
      { class: `toggle-btn${ui.view === "mine" ? " on" : ""}`, "data-testid": "view-mine", onclick: () => ((ui.view = "mine"), render()) },
      "My base",
    ),
    el(
      "button",
      { class: `toggle-btn${ui.view === "target" ? " on" : ""}`, "data-testid": "view-target", onclick: () => ((ui.view = "target"), render()) },
      "Target",
    ),
  );

  const myLeft = unitsLeft(mine.units);
  const foeLeft = unitsLeft(theirs.units);
  const counter = (label: string, n: number, which: "you" | "enemy") =>
    el(
      "button",
      { class: "counter", "data-testid": `counter-${which}`, onclick: () => ((ui.popover = ui.popover === which ? null : which), render()) },
      el("span", {}, label),
      el("b", {}, `${n} / ${FIGHTING_UNITS}`),
    );

  let action: HTMLButtonElement;
  if (!game.shotFired) {
    fireButton = el(
      "button",
      {
        class: "btn danger",
        "data-testid": "fire",
        disabled: !ui.aim,
        onclick: () => {
          if (!ui.aim) return;
          const r = fire(game, ui.aim.x, ui.aim.y);
          if (!r.ok) return;
          ui.aim = null;
          ui.view = "target";
          if (r.result.destroyed.length > 0) navigator.vibrate?.(60);
          setGame(r.game);
        },
      },
      "Fire",
    );
    action = fireButton;
  } else if (over) {
    action = el("button", { class: "btn primary", "data-testid": "see-results", onclick: () => ((ui.endShown = true), render()) }, "See results");
  } else {
    action = el(
      "button",
      {
        class: "btn primary",
        "data-testid": "end-turn",
        onclick: () => {
          const r = endTurn(game);
          if (r.ok) setGame(r.game);
        },
      },
      "End turn",
    );
  }

  const panel = el(
    "div",
    { class: "panel" },
    toggle,
    el("div", { class: "panel-name", "data-testid": "shooter" }, mine.name),
    el("div", { class: "panel-sub", "data-testid": "turn" }, `Turn ${game.turn}`),
    el("div", { class: "rule" }),
    counter("You", myLeft.total, "you"),
    counter("Enemy", foeLeft.total, "enemy"),
    el("div", { class: "rule" }),
    status,
    el("div", { class: "spacer" }),
    action,
  );

  const root = layout(board.svg, panel);
  if (justFired && ui.view === "target") {
    root.append(el("div", { class: "banner", "data-testid": "banner" }, describeShot(justFired)));
  }
  if (ui.popover) {
    const left = ui.popover === "you" ? myLeft : foeLeft;
    const owner = ui.popover === "you" ? "Your army" : `${theirs.name}'s army`;
    root.append(
      el(
        "div",
        { class: "popover", "data-testid": "breakdown", onclick: () => ((ui.popover = null), render()) },
        el("h3", {}, owner),
        el(
          "ul",
          {},
          el("li", {}, `Fort: ${left.byType.fort}${left.fortDamaged ? " (damaged)" : ""}`),
          el("li", {}, `Tanks: ${left.byType.tank}`),
          el("li", {}, `Artillery: ${left.byType.artillery}`),
          el("li", {}, `Infantry: ${left.byType.infantry}`),
          el("li", { class: "muted" }, `Walls left: ${left.wallsLeft}`),
        ),
        el("p", { class: "muted" }, "Tap to close"),
      ),
    );
  }
  return root;
}

// ---------------------------------------------------------------------------
// Game over

function gameOverScreen(game: Game): HTMLElement {
  const winner = game.winner ?? 0;
  const side = (p: PlayerIndex) => {
    const b = createBoard({ sq: 20, tint: "own" });
    for (const u of game.players[p].units) drawUnit(b.units, { ...u, state: unitState(u) }, 20);
    for (const s of game.players[other(p)].shots) drawShot(b.marks, { x: s.x, y: s.y, hit: s.hits.length > 0 }, 20);
    const left = unitsLeft(game.players[p].units).total;
    return el(
      "div",
      { class: "mini" },
      el("div", { class: "mini-title" }, `${game.players[p].name}'s base`, el("span", {}, ` ${left} / ${FIGHTING_UNITS} left`)),
      b.svg,
    );
  };
  const stat = (p: PlayerIndex) => {
    const s = shotStats(game.players[p]);
    return `${game.players[p].name} hit with ${s.hits} of ${s.shots} shots`;
  };
  return el(
    "div",
    { class: "screen over", "data-testid": "game-over" },
    el("h2", { class: "winner", "data-testid": "winner" }, `${game.players[winner].name} wins!`),
    el("div", { class: "minis" }, side(0), side(1)),
    el("p", { class: "stats" }, `${game.turn} turns. ${stat(0)}. ${stat(1)}.`),
    el(
      "div",
      { class: "menu-buttons row" },
      el(
        "button",
        {
          class: "btn primary",
          "data-testid": "play-again",
          onclick: () => {
            clearGame();
            ui.game = null;
            ui.names = ["", ""];
            ui.screen = "setup";
            render();
          },
        },
        "Play again",
      ),
      el(
        "button",
        {
          class: "btn",
          onclick: () => {
            clearGame();
            ui.game = null;
            ui.screen = "menu";
            render();
          },
        },
        "Main menu",
      ),
    ),
  );
}

// ---------------------------------------------------------------------------

function layout(board: SVGSVGElement, panel: HTMLElement): HTMLElement {
  return el("div", { class: "screen game" }, el("div", { class: "board-wrap" }, board), panel);
}
