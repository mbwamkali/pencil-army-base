import { describe, expect, it } from "vitest";
import { Rng, confirmHandoff, createGame, finishBuild, randomLayout, rectOf, type PlayerIndex } from "../src/rules/index.ts";
import {
  BASE_GRID,
  CENTRE_GAP,
  NEW_GAME_MAP_IDS,
  isBlocked,
  mapOf,
  oppositeSpot,
  placeBases,
  startStrategic,
  validBaseSpots,
  type Point,
  type StrategicMap,
} from "../src/strategic/rules/index.ts";
import { MEDIUM_BASES, builtGame, mapOfGame, medium, ok } from "./strategic-fixtures.ts";

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

/** A blank 60 x 30 map, the Large size, with whatever terrain a test gives it. */
const blank = (terrain: StrategicMap["terrain"] = []): StrategicMap => ({ id: "test-blank", name: "Blank", size: "large", w: 60, h: 30, terrain });

/**
 * Every placement rule checked square by square, independently of validBaseSpots: the base lies in
 * the player's half with CENTRE_GAP clear columns before the centre line, one square from every
 * edge, and no terrain inside it or touching it. Returns the rules it breaks.
 */
function brokenRules(map: StrategicMap, player: PlayerIndex, spot: Point): string[] {
  const broken: string[] = [];
  const half = map.w / 2;
  const right = spot.x + BASE_GRID.w - 1;
  if (player === 0 ? right > half - 1 : spot.x < half) broken.push("own half");
  if (player === 0 ? half - 1 - right < CENTRE_GAP : spot.x - half < CENTRE_GAP) broken.push("centre gap");
  if (spot.x < 1 || spot.y < 1 || spot.x + BASE_GRID.w > map.w - 1 || spot.y + BASE_GRID.h > map.h - 1) broken.push("edge");
  for (let y = spot.y - 1; y <= spot.y + BASE_GRID.h; y++) {
    for (let x = spot.x - 1; x <= spot.x + BASE_GRID.w; x++) if (isBlocked(map, x, y)) broken.push(`terrain at ${x},${y}`);
  }
  return broken;
}

/** Which third of the map, top (0), middle (1) or bottom (2), a base's middle row falls in. */
const thirdOf = (map: StrategicMap, spot: Point): number => Math.min(2, Math.floor((3 * (spot.y + BASE_GRID.h / 2)) / map.h));

describe("validBaseSpots", () => {
  it("lists Medium 1's eight spots in each half in reading order, the stage 3 spots among them", () => {
    const row = (y: number, xs: number[]) => xs.map((x) => ({ x, y }));
    expect(validBaseSpots(medium, 0)).toEqual([...row(6, [1, 2, 3, 4]), ...row(7, [1, 2, 3, 4])]);
    expect(validBaseSpots(medium, 1)).toEqual([...row(7, [24, 25, 26, 27]), ...row(8, [24, 25, 26, 27])]);
    expect(validBaseSpots(medium, 0)).toContainEqual(MEDIUM_BASES[0]);
    expect(validBaseSpots(medium, 1)).toContainEqual(MEDIUM_BASES[1]);
  });

  it("on open ground keeps a square from each edge and CENTRE_GAP columns from the centre line", () => {
    expect(CENTRE_GAP).toBe(4);
    const map = blank();
    const left = validBaseSpots(map, 0);
    const right = validBaseSpots(map, 1);
    // Player 1: x 1 to 14 (columns 26 to 29 stay clear); player 2: x 34 to 47; y 1 to 23 for both.
    expect(left).toHaveLength(14 * 23);
    expect(right).toHaveLength(14 * 23);
    expect(left[0]).toEqual({ x: 1, y: 1 });
    expect(left.at(-1)).toEqual({ x: 14, y: 23 });
    expect(right[0]).toEqual({ x: 34, y: 1 });
    expect(right.at(-1)).toEqual({ x: 47, y: 23 });
    // The nearest two bases can be: columns 26 to 33 between them, 8 in all.
    expect(right[0]!.x - (14 + BASE_GRID.w)).toBe(8);
    for (const p of [0, 1] as PlayerIndex[]) for (const spot of validBaseSpots(map, p)) expect(brokenRules(map, p, spot)).toEqual([]);
  });

  it("leaves out every spot whose base would touch terrain or sit on it", () => {
    // A 3 x 3 hill at x 20-22, y 10-12.
    const map = blank([{ kind: "hill", cx: 21.5, cy: 11.5, rx: 1.6, ry: 1.6 }]);
    const spots = validBaseSpots(map, 0);
    const has = (x: number, y: number) => spots.some((s) => s.x === x && s.y === y);
    expect(has(8, 10)).toBe(false); // the base reaches column 19, touching the hill
    expect(has(7, 10)).toBe(true); // up to column 18, one clear column: fine
    expect(has(14, 4)).toBe(false); // rows 4 to 9, touching the hill's top row
    expect(has(14, 3)).toBe(true);
    expect(has(14, 14)).toBe(true); // rows 14 to 19, one clear row below the hill
    expect(has(14, 13)).toBe(false);
    expect(spots.length).toBeLessThan(14 * 23);
    for (const spot of spots) expect(brokenRules(map, 0, spot)).toEqual([]);
    // Every spot the rule leaves out really breaks a rule.
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w / 2; x++) if (!has(x, y)) expect(brokenRules(map, 0, { x, y })).not.toEqual([]);
  });

  it("finds nothing on a map with no room", () => {
    const tiny: StrategicMap = { ...blank(), id: "test-tiny", w: 20, h: 6 };
    expect(validBaseSpots(tiny, 0)).toEqual([]);
    expect(validBaseSpots(tiny, 1)).toEqual([]);
  });

  it("every map new games are drawn from has room for both bases", () => {
    for (const id of NEW_GAME_MAP_IDS) {
      const map = mapOf(id);
      expect(map.id).toBe(id);
      for (const p of [0, 1] as PlayerIndex[]) expect(validBaseSpots(map, p).length, `${id} player ${p + 1}`).toBeGreaterThan(0);
    }
  });
});

describe("startStrategic placement over 300 seeds", () => {
  const games = SEEDS.map((seed) => ({ seed, game: builtGame(seed) }));

  it("draws a map new games are played on, and every one of them across the seeds", () => {
    const drawn = new Set<string>();
    for (const { game } of games) {
      expect(NEW_GAME_MAP_IDS).toContain(game.strategic!.map);
      drawn.add(game.strategic!.map);
    }
    expect([...drawn].sort()).toEqual([...NEW_GAME_MAP_IDS].sort());
  });

  it("puts each base at a valid spot of its own half, with every unit inside it", () => {
    for (const { seed, game } of games) {
      const s = game.strategic!;
      const map = mapOfGame(game);
      for (const p of [0, 1] as PlayerIndex[]) {
        const base = s.bases[p];
        expect(brokenRules(map, p, base), `seed ${seed} player ${p + 1}`).toEqual([]);
        expect(validBaseSpots(map, p)).toContainEqual(base);
        for (const u of game.players[p].units) {
          const r = rectOf(u);
          const inside = r.x >= base.x && r.y >= base.y && r.x + r.w <= base.x + BASE_GRID.w && r.y + r.h <= base.y + BASE_GRID.h;
          expect(inside, `seed ${seed} ${p} ${u.id}`).toBe(true);
        }
      }
    }
  });

  it("gives the same game for the same seed and draws map, player 1's spot, then player 2's", () => {
    for (const seed of [1, 2, 77, 300]) {
      const a = builtGame(seed);
      expect(builtGame(seed)).toEqual(a);
      expect(startStrategic(a)).toBe(a);
    }
    // Rebuilt by hand from the Rng: three draws in order, then the bases dropped as drawn.
    let pre = createGame({ seed: 9, mode: "strategic" });
    pre = randomLayout(pre, 0);
    pre = ok(confirmHandoff(ok(finishBuild(pre, 0))));
    pre = randomLayout(pre, 1);
    const started = startStrategic(pre);
    const rng = new Rng(pre.rngState);
    const map = mapOf(rng.pick(NEW_GAME_MAP_IDS));
    const bases: [Point, Point] = [rng.pick(validBaseSpots(map, 0)), rng.pick(validBaseSpots(map, 1))];
    expect(started).toEqual(placeBases({ ...pre, rngState: rng.state }, map.id, bases));
  });

  it("draws player 2's spot on its own: it is player 1's turned round only about as often as chance says", () => {
    let mirrored = 0;
    let chance = 0;
    for (const { game } of games) {
      const s = game.strategic!;
      const map = mapOfGame(game);
      const opposite = oppositeSpot(s.bases[0], map);
      const spots = validBaseSpots(map, 1);
      if (spots.some((p) => p.x === opposite.x && p.y === opposite.y)) chance += 1 / spots.length;
      if (s.bases[1].x === opposite.x && s.bases[1].y === opposite.y) mirrored++;
    }
    // Stage 3 mirrored every game (300 of 300); drawn apart it is rare (a handful in 300 on the Large maps).
    expect(mirrored).toBeLessThanOrEqual(Math.max(5, 3 * chance));
    expect(mirrored).toBeLessThan(SEEDS.length / 5);
  });

  it("lands both players in every third of the map that has room for a base", () => {
    for (const p of [0, 1] as PlayerIndex[]) {
      const possible = new Set(NEW_GAME_MAP_IDS.flatMap((id) => validBaseSpots(mapOf(id), p).map((spot) => thirdOf(mapOf(id), spot))));
      const landed = new Set(games.map(({ game }) => thirdOf(mapOfGame(game), game.strategic!.bases[p])));
      expect([...landed].sort(), `player ${p + 1}`).toEqual([...possible].sort());
    }
  });
});
