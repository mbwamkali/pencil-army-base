import { confirmHandoff, createGame, endTurn, finishBuild, fire, placeUnit, type Game, type PlayerIndex } from "./game.ts";
import type { ShotResult } from "./shots.ts";

export interface Placement {
  id: string;
  x: number;
  y: number;
  upright?: boolean;
}

/** A recorded game: everything needed to play it again exactly. Shots alternate, starting with the first shooter. */
export interface GameRecord {
  seed: number;
  names?: [string?, string?];
  layouts: [Placement[], Placement[]];
  shots: { x: number; y: number }[];
}

function must<T extends { ok: boolean }>(o: T, what: string): Extract<T, { ok: true }> {
  if (!o.ok) throw new Error(`Replay failed at ${what}: ${(o as unknown as { reason: string }).reason}`);
  return o as Extract<T, { ok: true }>;
}

/** Play a recorded game through the rules from start to finish (or until the shots run out). */
export function replay(record: GameRecord): { game: Game; results: ShotResult[] } {
  let game = createGame({ seed: record.seed, names: record.names });
  for (const p of [0, 1] as PlayerIndex[]) {
    for (const u of record.layouts[p]) {
      game = must(placeUnit(game, p, u.id, u.x, u.y, u.upright ?? false), `placing ${u.id}`).game;
    }
    game = must(finishBuild(game, p), `finishing build ${p}`).game;
    game = must(confirmHandoff(game), "handoff").game;
  }
  const results: ShotResult[] = [];
  for (const [i, s] of record.shots.entries()) {
    if (game.phase === "over") throw new Error(`Replay has ${record.shots.length - i} shots after the game ended`);
    const fired = must(fire(game, s.x, s.y), `shot ${i + 1}`);
    results.push(fired.result);
    game = fired.game;
    if (game.phase === "over") break;
    game = must(endTurn(game), "end turn").game;
    game = must(confirmHandoff(game), "handoff").game;
  }
  return { game, results };
}
