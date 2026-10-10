import { type Game, type PlayerIndex, isArmyComplete } from "./game.ts";
import { MODES, modeOf, type Mode } from "./modes.ts";
import { placementProblem, snapWall, type Candidate } from "./placement.ts";
import { Rng } from "./rng.ts";
import { armySlots, sizeOf, type Unit } from "./units.ts";

/** Build a complete valid army at random: the fort first, walls hugging it (mostly), the rest anywhere free. */
export function randomUnits(rng: Rng, mode: Mode = MODES.battle): Unit[] {
  const slots = armySlots(mode.army);
  for (let attempt = 0; attempt < 200; attempt++) {
    const units: Unit[] = [];
    const add = (id: string, c: Candidate) => units.push({ id, ...c, hits: 0 });
    const tryPlace = (id: string, c: Candidate) => {
      if (placementProblem(units, c, mode.grid)) return false;
      add(id, c);
      return true;
    };
    const free = (id: string, type: Unit["type"]) => {
      const { w, h } = sizeOf(type, false);
      for (let i = 0; i < 400; i++) {
        const c = { type, upright: false, x: rng.int(0, mode.grid.w - w), y: rng.int(0, mode.grid.h - h) };
        if (tryPlace(id, c)) return true;
      }
      return false;
    };

    if (!free("fort-1", "fort")) continue;
    const fort = units[0] as Unit;
    let ok = true;
    for (const slot of slots) {
      if (slot.type === "fort") continue;
      if (slot.type === "wall" && rng.next() < 0.6) {
        // Aim a drop point somewhere around the fort and let the wall snap to it.
        const px = fort.x + 1.5 + rng.int(-3, 3);
        const py = fort.y + 1.5 + rng.int(-3, 3);
        const snapped = snapWall(fort, px, py);
        if (snapped && tryPlace(slot.id, snapped)) continue;
      }
      if (!free(slot.id, slot.type)) {
        ok = false;
        break;
      }
    }
    if (ok && isArmyComplete(units, mode)) return units;
  }
  throw new Error("Could not find a random layout");
}

/** The "Random layout" button: replaces whatever the player had placed. */
export function randomLayout(game: Game, player: PlayerIndex): Game {
  if (game.phase !== "build" || game.building !== player) return game;
  const g = structuredClone(game);
  const rng = new Rng(g.rngState);
  g.players[player].units = randomUnits(rng, modeOf(g.mode));
  g.rngState = rng.state;
  return g;
}
