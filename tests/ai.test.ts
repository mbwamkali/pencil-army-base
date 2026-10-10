import { describe, expect, it } from "vitest";
import {
  AI_MIN_GAP,
  AI_NAME,
  MODES,
  MODE_IDS,
  Rng,
  chooseEasyShot,
  createGame,
  endTurn,
  finishBuild,
  fire,
  pasteLayout,
  playComputerTurn,
  randomUnits,
  type Game,
  type ModeId,
} from "../src/rules/index.ts";

/** A single player game with the human's base built at random, ready for the first turn. */
function start(seed: number, mode: ModeId = "skirmish", layoutSeed = 99): Game {
  let g = createGame({ seed, mode, vsComputer: true });
  g = { ...g, players: [{ ...g.players[0], units: randomUnits(new Rng(layoutSeed), MODES[mode]) }, g.players[1]] };
  const r = finishBuild(g, 0);
  if (!r.ok) throw new Error(r.reason);
  return r.game;
}

/** Plays the game out: the human fires at random spots, the computer takes its turns, until it ends. */
function playOut(g: Game, rng = new Rng(5), maxTurns = 400): { game: Game; aiShots: number; humanShots: number } {
  let aiShots = 0;
  let humanShots = 0;
  const grid = MODES[g.mode].grid;
  for (let i = 0; i < maxTurns && g.phase !== "over"; i++) {
    if (g.current === 1) {
      const before = g.players[1].shots.length;
      const r = playComputerTurn(g);
      if (!r.ok) throw new Error(r.reason);
      expect(r.game.players[1].shots.length).toBe(before + 1);
      g = r.game;
      aiShots++;
    } else {
      const f = fire(g, rng.next() * grid.w, rng.next() * grid.h);
      if (!f.ok) throw new Error(f.reason);
      humanShots++;
      g = f.game;
      if (g.phase === "over") break;
      const e = endTurn(g);
      if (!e.ok) throw new Error(e.reason);
      g = e.game;
    }
  }
  return { game: g, aiShots, humanShots };
}

describe("single player setup", () => {
  it("makes player 2 the computer, with its own name", () => {
    const g = createGame({ seed: 1, vsComputer: true, names: ["Jared"] });
    expect(g.ai).toBe(1);
    expect(g.players[0].name).toBe("Jared");
    expect(g.players[1].name).toBe(AI_NAME);
  });

  it("leaves two player games alone", () => {
    expect(createGame({ seed: 1 }).ai).toBeUndefined();
  });

  it("builds the computer's base at once and starts play with no handoff screen", () => {
    for (const mode of MODE_IDS) {
      const g = start(3, mode);
      expect(g.phase).toBe("turn");
      expect(g.handoff).toBeNull();
      expect(g.players[1].units).toHaveLength(Object.values(MODES[mode].army).reduce((a, b) => a + b, 0));
    }
  });

  it("works with a pasted layout for the human", () => {
    let g = createGame({ seed: 4, mode: "skirmish", vsComputer: true });
    const p = pasteLayout(g, 0, "PAB1-WvVn4q1quIhwLs4");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const r = finishBuild(p.game, 0);
    expect(r.ok && r.game.phase).toBe("turn");
  });
});

describe("the computer's turn", () => {
  it("fires exactly once, only on its own turn, then hands the turn straight back", () => {
    let g = start(7);
    if (g.current === 0) {
      expect(playComputerTurn(g).ok).toBe(false);
      g = (endTurn((fire(g, 0.5, 0.5) as { game: Game }).game) as { game: Game }).game;
    }
    expect(g.current).toBe(1);
    const r = playComputerTurn(g);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.game.players[1].shots).toHaveLength(1);
    expect(r.game.current).toBe(0);
    expect(r.game.phase).toBe("turn");
    expect(r.game.shotFired).toBe(false);
    expect(r.game.handoff).toBeNull();
    expect(playComputerTurn(r.game).ok).toBe(false);
  });

  it("never fires twice at the same spot, and every shot lands on the board", () => {
    for (const mode of MODE_IDS) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const { game } = playOut(start(seed, mode));
        const shots = game.players[1].shots;
        const grid = MODES[mode].grid;
        for (const [i, s] of shots.entries()) {
          expect(s.x).toBeGreaterThanOrEqual(0);
          expect(s.x).toBeLessThanOrEqual(grid.w);
          expect(s.y).toBeGreaterThanOrEqual(0);
          expect(s.y).toBeLessThanOrEqual(grid.h);
          for (const t of shots.slice(0, i)) expect(Math.hypot(s.x - t.x, s.y - t.y)).toBeGreaterThanOrEqual(AI_MIN_GAP);
        }
      }
    }
  });

  it("only uses what its Enemy base view shows: the human's hidden base doesn't change where it aims", () => {
    const aimsFor = (layoutSeed: number) => {
      let g = start(11, "battle", layoutSeed);
      const aims: string[] = [];
      for (let i = 0; i < 12 && g.phase !== "over"; i++) {
        if (g.current === 1) {
          const r = playComputerTurn(g);
          if (!r.ok) throw new Error(r.reason);
          aims.push(`${r.result.x.toFixed(4)},${r.result.y.toFixed(4)}`);
          g = r.game;
        } else {
          g = (endTurn((fire(g, 0.5, 0.5) as { game: Game }).game) as { game: Game }).game;
        }
      }
      return aims;
    };
    expect(aimsFor(1)).toEqual(aimsFor(2));
  });

  it("fires the same shots for the same seed", () => {
    const a = playOut(start(21)).game.players[1].shots.map((s) => [s.x, s.y]);
    const b = playOut(start(21)).game.players[1].shots.map((s) => [s.x, s.y]);
    expect(a).toEqual(b);
  });

  it("doesn't freeze or crash when most of the board has been shot", () => {
    const grid = MODES.skirmish.grid;
    const shots = [];
    for (let y = 0.5; y < grid.h; y++) for (let x = 0.5; x < grid.w; x++) shots.push({ x, y });
    const aim = chooseEasyShot(shots, grid, new Rng(1));
    expect(aim.x).toBeGreaterThanOrEqual(0);
    expect(aim.y).toBeLessThanOrEqual(grid.h);
  });

  it("finishes every game without errors, in every mode", () => {
    for (const mode of MODE_IDS) {
      for (const seed of [31, 32, 33]) {
        const { game } = playOut(start(seed, mode));
        expect(game.phase).toBe("over");
      }
    }
  });

  it("stops after 20 shots each in Score attack", () => {
    const { game } = playOut(start(41, "score"));
    expect(game.phase).toBe("over");
    expect(game.players[0].shots.length).toBeLessThanOrEqual(20);
    expect(game.players[1].shots.length).toBe(game.players[0].shots.length);
  });
});
