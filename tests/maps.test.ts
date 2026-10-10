import { describe, expect, it } from "vitest";
import {
  FLIPS,
  MODES,
  MODE_IDS,
  Rng,
  SAVED_MAPS,
  computerBase,
  createGame,
  decodeLayout,
  encodeLayout,
  finishBuild,
  flipUnits,
  mapsFor,
  placementProblem,
  randomLayout,
  randomUnits,
  type Unit,
} from "../src/rules/index.ts";

const legal = (units: readonly Unit[], grid: { w: number; h: number }) =>
  units.every((u, i) => placementProblem(units.slice(0, i), u, grid) === null);

const key = (units: readonly Unit[]) => JSON.stringify([...units].sort((a, b) => a.id.localeCompare(b.id)));

/** Every base the computer could get in Skirmish: each saved map, each of the four ways. */
const skirmishFaces = () =>
  new Set(mapsFor(MODES.skirmish).flatMap((m) => FLIPS.map((f) => key(flipUnits(m, MODES.skirmish.grid, f)))));

describe("saved maps", () => {
  it("every saved map decodes to a legal base", () => {
    expect(SAVED_MAPS.length).toBeGreaterThan(0);
    for (const code of SAVED_MAPS) {
      const d = decodeLayout(code);
      expect(d.ok, code).toBe(true);
      if (d.ok) expect(legal(d.units, MODES[d.mode].grid)).toBe(true);
    }
  });

  it("only maps that fit the mode are offered, and a Battle map also serves Score attack", () => {
    expect(mapsFor(MODES.skirmish).length).toBeGreaterThan(0);
    expect(mapsFor(MODES.battle).length).toBeGreaterThan(0);
    expect(mapsFor(MODES.score)).toEqual(mapsFor(MODES.battle));
    const battle = encodeLayout("battle", randomUnits(new Rng(4), MODES.battle))!;
    expect(mapsFor(MODES.battle, [battle])).toHaveLength(1);
    expect(mapsFor(MODES.score, [battle])).toHaveLength(1);
    expect(mapsFor(MODES.skirmish, [battle])).toHaveLength(0);
  });

  it("bad codes are skipped instead of breaking the game", () => {
    expect(mapsFor(MODES.skirmish, ["", "hello", "PAB1-AAAA", ...SAVED_MAPS])).toEqual(mapsFor(MODES.skirmish));
  });
});

describe("flipping", () => {
  it("moves a unit to the mirrored squares", () => {
    const tank: Unit = { id: "tank-1", type: "tank", x: 0, y: 1, upright: false, hits: 0 };
    const grid = { w: 12, h: 6 };
    expect(flipUnits([tank], grid, { x: true, y: false })[0]).toMatchObject({ x: 10, y: 1 });
    expect(flipUnits([tank], grid, { x: false, y: true })[0]).toMatchObject({ x: 0, y: 3 });
    expect(flipUnits([tank], grid, { x: true, y: true })[0]).toMatchObject({ x: 10, y: 3 });
  });

  it("keeps every base legal, upright walls included, and flipping twice gives it back", () => {
    for (const id of MODE_IDS) {
      const mode = MODES[id];
      for (let seed = 1; seed <= 40; seed++) {
        const units = randomUnits(new Rng(seed), mode);
        for (const flip of FLIPS) {
          const flipped = flipUnits(units, mode.grid, flip);
          expect(legal(flipped, mode.grid), `${id} seed ${seed}`).toBe(true);
          expect(flipUnits(flipped, mode.grid, flip)).toEqual(units);
        }
      }
    }
  });

  it("gives four different bases for a saved map", () => {
    const [map] = mapsFor(MODES.skirmish);
    const faces = new Set(FLIPS.map((f) => key(flipUnits(map!, MODES.skirmish.grid, f))));
    expect(faces.size).toBe(4);
  });
});

describe("the computer's base", () => {
  it("uses every saved map, turned each of the four ways across games", () => {
    const faces = skirmishFaces();
    expect(faces.size).toBe(4 * mapsFor(MODES.skirmish).length);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const k = key(computerBase(new Rng(seed), MODES.skirmish));
      expect(faces.has(k)).toBe(true);
      seen.add(k);
    }
    expect(seen.size).toBe(faces.size);
  });

  it("quietly builds a random base when no map fits", () => {
    const units = computerBase(new Rng(3), MODES.battle, []);
    expect(units).toHaveLength(17);
    expect(legal(units, MODES.battle.grid)).toBe(true);
  });

  it("is the same for the same seed", () => {
    expect(computerBase(new Rng(9), MODES.skirmish)).toEqual(computerBase(new Rng(9), MODES.skirmish));
  });

  it("a single player Skirmish game gives the computer a saved map", () => {
    const faces = skirmishFaces();
    let g = createGame({ seed: 5, mode: "skirmish", vsComputer: true });
    g = randomLayout(g, 0);
    const r = finishBuild(g, 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(faces.has(key(r.game.players[1].units))).toBe(true);
  });
});
