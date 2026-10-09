import {
  confirmHandoff,
  createGame,
  finishBuild,
  placeUnit,
  rectOf,
  type Game,
  type Placement,
  type PlayerIndex,
  type Unit,
} from "../src/rules/index.ts";
import { GRID_W } from "../src/rules/constants.ts";

/**
 * A hand-made valid army. Fort at x8-10 y3-5 with four walls around it; every other unit well apart.
 * Squares are listed as (x, y) top-left.
 */
export const LAYOUT_A: Placement[] = [
  { id: "fort-1", x: 8, y: 3 },
  { id: "wall-1", x: 7, y: 3, upright: true }, // left of the fort, rows 3-4
  { id: "wall-2", x: 11, y: 4, upright: true }, // right of the fort, rows 4-5
  { id: "wall-3", x: 8, y: 2 }, // above the fort, columns 8-9
  { id: "wall-4", x: 9, y: 6 }, // below the fort, columns 9-10
  { id: "tank-1", x: 0, y: 0 },
  { id: "tank-2", x: 14, y: 0 },
  { id: "tank-3", x: 16, y: 7 },
  { id: "artillery-1", x: 2, y: 7 },
  { id: "artillery-2", x: 5, y: 0 },
  { id: "artillery-3", x: 13, y: 8 },
  { id: "infantry-1", x: 18, y: 0 },
  { id: "infantry-2", x: 18, y: 4 },
  { id: "infantry-3", x: 15, y: 4 },
  { id: "infantry-4", x: 3, y: 4 },
  { id: "infantry-5", x: 12, y: 1 },
  { id: "infantry-6", x: 0, y: 9 },
];

/** The same army flipped left to right, for a second player with a different base. */
export function mirror(layout: Placement[]): Placement[] {
  return layout.map((p) => {
    const type = p.id.replace(/-\d+$/, "") as Unit["type"];
    const { w } = rectOf({ type, x: 0, y: 0, upright: p.upright ?? false });
    return { ...p, x: GRID_W - p.x - w };
  });
}

/** A square that is empty in LAYOUT_A (and clear of the shot radius around anything). */
export const EMPTY_SPOT_A = { x: 5.5, y: 5.5 };

export function centreOf(layout: Placement[], id: string): { x: number; y: number } {
  const p = layout.find((l) => l.id === id)!;
  const type = id.replace(/-\d+$/, "") as Unit["type"];
  const r = rectOf({ type, x: p.x, y: p.y, upright: p.upright ?? false });
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function placeAll(game: Game, player: PlayerIndex, layout: Placement[]): Game {
  let g = game;
  for (const u of layout) {
    const r = placeUnit(g, player, u.id, u.x, u.y, u.upright ?? false);
    if (!r.ok) throw new Error(`could not place ${u.id}: ${r.reason}`);
    g = r.game;
  }
  return g;
}

function ok(r: { ok: boolean; game?: Game; reason?: string }): Game {
  if (!r.ok) throw new Error(r.reason);
  return r.game!;
}

/** A game with both armies built, both handoffs done, ready for the first shot. */
export function gameInBattle(seed = 1, a = LAYOUT_A, b = LAYOUT_A): Game {
  let g = createGame({ seed });
  g = placeAll(g, 0, a);
  g = ok(finishBuild(g, 0));
  g = ok(confirmHandoff(g));
  g = placeAll(g, 1, b);
  g = ok(finishBuild(g, 1));
  return ok(confirmHandoff(g));
}
