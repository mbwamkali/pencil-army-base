/**
 * Writes the golden game fixtures in tests/golden/. Run only when the rules are changed on purpose:
 *   node scripts/make-golden.ts
 * Each fixture holds a recorded game and the outcome it must always produce.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  confirmHandoff, createGame, endTurn, finishBuild, fire, placeUnit, replay, unitsLeft,
  type Game, type GameRecord, type Placement, type PlayerIndex,
} from "../src/rules/index.ts";
import { rectOf, type Unit } from "../src/rules/index.ts";

const LAYOUT_A: Placement[] = [
  { id: "fort-1", x: 8, y: 3 }, { id: "wall-1", x: 7, y: 3, upright: true }, { id: "wall-2", x: 11, y: 4, upright: true },
  { id: "wall-3", x: 8, y: 2 }, { id: "wall-4", x: 9, y: 6 }, { id: "tank-1", x: 0, y: 0 }, { id: "tank-2", x: 14, y: 0 },
  { id: "tank-3", x: 16, y: 7 }, { id: "artillery-1", x: 2, y: 7 }, { id: "artillery-2", x: 5, y: 0 }, { id: "artillery-3", x: 13, y: 8 },
  { id: "infantry-1", x: 18, y: 0 }, { id: "infantry-2", x: 18, y: 4 }, { id: "infantry-3", x: 15, y: 4 },
  { id: "infantry-4", x: 3, y: 4 }, { id: "infantry-5", x: 12, y: 1 }, { id: "infantry-6", x: 0, y: 9 },
];
// A second army: fort low on the left with walls hugging it, units spread differently.
const LAYOUT_B: Placement[] = [
  { id: "fort-1", x: 3, y: 5 }, { id: "wall-1", x: 2, y: 6, upright: true }, { id: "wall-2", x: 6, y: 5, upright: true },
  { id: "wall-3", x: 4, y: 4 }, { id: "wall-4", x: 14, y: 9 }, { id: "tank-1", x: 10, y: 0 }, { id: "tank-2", x: 17, y: 2 },
  { id: "tank-3", x: 9, y: 6 }, { id: "artillery-1", x: 0, y: 0 }, { id: "artillery-2", x: 13, y: 3 }, { id: "artillery-3", x: 17, y: 7 },
  { id: "infantry-1", x: 6, y: 1 }, { id: "infantry-2", x: 8, y: 9 }, { id: "infantry-3", x: 12, y: 6 },
  { id: "infantry-4", x: 19, y: 0 }, { id: "infantry-5", x: 15, y: 5 }, { id: "infantry-6", x: 11, y: 8 },
];

const centre = (layout: Placement[], id: string) => {
  const p = layout.find((l) => l.id === id)!;
  const r = rectOf({ type: id.replace(/-\d+$/, "") as Unit["type"], x: p.x, y: p.y, upright: p.upright ?? false });
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};

type Plan = { name: string; seed: number; layouts: [Placement[], Placement[]];
  /** Where the first shooter aims, in order, then where the second shooter aims (cycled). */
  decoy: { x: number; y: number }[]; huntFirst: boolean;
  /** Open with two shots at the fort's left edge: the first is absorbed by the wall there, the second reaches the fort. */
  wallOpening?: boolean };

function build(plan: Plan): GameRecord {
  const base = createGame({ seed: plan.seed });
  const record: GameRecord = { seed: plan.seed, layouts: plan.layouts, shots: [] };
  // Find who shoots first, then play: the "hunter" player works through plan.hunter, the other uses the decoy list.
  let g: Game = base;
  const first = g.firstShooter;
  const hunterIs: PlayerIndex = plan.huntFirst ? first : first === 0 ? 1 : 0;
  for (const p of [0, 1] as PlayerIndex[]) {
    for (const u of plan.layouts[p]) { const r = placeUnit(g, p, u.id, u.x, u.y, u.upright ?? false); if (!r.ok) throw new Error(`${u.id} ${r.reason}`); g = r.game; }
    const f = finishBuild(g, p); if (!f.ok) throw new Error(f.reason); g = f.game;
    const c = confirmHandoff(g); if (!c.ok) throw new Error(c.reason); g = c.game;
  }
  let di = 0, hunts = 0;
  while (g.phase === "turn" && record.shots.length < 400) {
    // The hunter aims at the centre of the first enemy fighting unit still standing; the other player cycles fixed spots.
    const target = plan.layouts[hunterIs === 0 ? 1 : 0];
    const enemy = g.players[hunterIs === 0 ? 1 : 0].units;
    const next = target.find((p) => !p.id.startsWith("wall") && enemy.find((u) => u.id === p.id)!.hits < (p.id === "fort-1" ? 2 : 1));
    const fortPlace = target.find((p) => p.id === "fort-1")!;
    const edge = { x: fortPlace.x + 0.2, y: fortPlace.y + 1.5 };
    const aim = g.current === hunterIs && plan.wallOpening && hunts < 2 ? (hunts++, edge) : g.current === hunterIs ? centre(target, next!.id) : plan.decoy[di++ % plan.decoy.length]!;
    const r = fire(g, aim.x, aim.y); if (!r.ok) throw new Error(r.reason);
    record.shots.push(aim); g = r.game;
    if (g.phase === "over") break;
    g = (confirmHandoff((endTurn(g) as { game: Game }).game) as { game: Game }).game;
  }
  return record;
}

const plans: Plan[] = [
  { name: "first-shooter-sweeps-b", seed: 11, layouts: [LAYOUT_A, LAYOUT_B], decoy: [{ x: 5.5, y: 5.5 }, { x: 12.5, y: 9.5 }, { x: 1.5, y: 5.5 }], huntFirst: true },
  { name: "second-shooter-sweeps-a", seed: 12, layouts: [LAYOUT_A, LAYOUT_B], decoy: [{ x: 4.5, y: 9.5 }, { x: 7.5, y: 7.5 }], huntFirst: false },
  // Layouts swapped, so the other player's base is the one being hunted.
  { name: "swapped-bases-first-shooter-hunts", seed: 13, layouts: [LAYOUT_B, LAYOUT_A], decoy: [{ x: 5.5, y: 5.5 }], huntFirst: true, wallOpening: true },
];

mkdirSync("tests/golden", { recursive: true });
for (const plan of plans) {
  const record = build(plan);
  const { game, results } = replay(record);
  const loser: PlayerIndex = game.winner === 0 ? 1 : 0;
  const expected = {
    firstShooter: createGame({ seed: record.seed }).firstShooter,
    winner: game.winner,
    turns: game.turn,
    shots: record.shots.length,
    outcomes: results.map((r) => r.outcome),
    destroyedInOrder: results.flatMap((r) => r.destroyed),
    loserFightingLeft: unitsLeft(game.players[loser].units).total,
    loserWallsLeft: unitsLeft(game.players[loser].units).wallsLeft,
  };
  writeFileSync(`tests/golden/${plan.name}.json`, JSON.stringify({ record, expected }, null, 1) + "\n");
  console.log(plan.name, expected.winner, "turns", expected.turns, "shots", expected.shots, "outcomes", expected.outcomes.join(","));
}
