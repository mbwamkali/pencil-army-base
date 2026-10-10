import { describe, expect, it } from "vitest";
import {
  MODES,
  MODE_IDS,
  Rng,
  createGame,
  decodeLayout,
  encodeLayout,
  finishBuild,
  pasteLayout,
  randomUnits,
  type Unit,
} from "../src/rules/index.ts";
import { LAYOUT_A, placeAll } from "./helpers.ts";

const unit = (id: string, x: number, y: number, upright = false): Unit => ({
  id,
  type: id.replace(/-\d+$/, "") as Unit["type"],
  x,
  y,
  upright,
  hits: 0,
});

/** A hand-made Skirmish base: fort at x4-6 y1-3, one wall standing beside it, one lying above it. */
const SKIRMISH_BASE: Unit[] = [
  unit("fort-1", 4, 1),
  unit("tank-1", 9, 0),
  unit("artillery-1", 0, 4),
  unit("infantry-1", 11, 5),
  unit("infantry-2", 2, 0),
  unit("wall-1", 3, 1, true),
  unit("wall-2", 4, 0),
];
const SKIRMISH_CODE = "PAB1-WvZU0fhPsJpz7gA";

const sorted = (units: readonly Unit[]) => [...units].sort((a, b) => a.id.localeCompare(b.id));

/** Builds a code from raw units without checking them, to test what Paste does with bad ones. */
function rawCode(mode: (typeof MODE_IDS)[number], units: Unit[]): string {
  const code = encodeLayout(mode, units);
  if (!code) throw new Error("army incomplete");
  return code;
}

describe("layout codes", () => {
  it("turn a known base into a known code, and back", () => {
    expect(encodeLayout("skirmish", SKIRMISH_BASE)).toBe(SKIRMISH_CODE);
    const d = decodeLayout(SKIRMISH_CODE);
    expect(d.ok && d.mode).toBe("skirmish");
    expect(d.ok && sorted(d.units)).toEqual(sorted(SKIRMISH_BASE));
  });

  it("are short and don't read at a glance", () => {
    expect(SKIRMISH_CODE).toMatch(/^PAB1-[A-Za-z0-9_-]+$/);
    expect(SKIRMISH_CODE.length).toBeLessThanOrEqual(20);
    const battle = encodeLayout("battle", placeAll(createGame({ seed: 1 }), 0, LAYOUT_A).players[0].units)!;
    expect(battle.length).toBeLessThanOrEqual(34);
    expect(battle).not.toMatch(/fort|tank|wall/i);
  });

  it("round-trip every mode with many random bases", () => {
    const rng = new Rng(42);
    for (const mode of MODE_IDS) {
      for (let i = 0; i < 50; i++) {
        const units = randomUnits(rng, MODES[mode]);
        const d = decodeLayout(encodeLayout(mode, units)!);
        expect(d.ok && d.mode).toBe(mode);
        expect(d.ok && sorted(d.units)).toEqual(sorted(units));
      }
    }
  });

  it("keep the hand-made Battle base exactly, upright walls included", () => {
    const units = placeAll(createGame({ seed: 1 }), 0, LAYOUT_A).players[0].units;
    const d = decodeLayout(encodeLayout("battle", units)!);
    expect(d.ok && sorted(d.units)).toEqual(sorted(units));
  });

  it("can't be made from a base that isn't finished", () => {
    expect(encodeLayout("skirmish", SKIRMISH_BASE.slice(1))).toBeNull();
  });

  it("ignore spaces, line breaks and a lower-case prefix", () => {
    const messy = ` ${SKIRMISH_CODE.slice(0, 8)}\n${SKIRMISH_CODE.slice(8)} `.replace("PAB1", "pab1");
    expect(decodeLayout(messy).ok).toBe(true);
  });
});

describe("bad layout codes", () => {
  const bad = (text: string) => {
    const d = decodeLayout(text);
    return d.ok ? "ok" : d.reason;
  };

  it("are refused with a reason, never a crash", () => {
    expect(bad("")).toBe("empty");
    expect(bad("   ")).toBe("empty");
    expect(bad("hello")).toBe("bad_code");
    expect(bad("PAB1-")).toBe("bad_code");
    expect(bad("PAB1-!!!!")).toBe("bad_code");
    expect(bad("PAB2" + SKIRMISH_CODE.slice(4))).toBe("bad_code");
    expect(bad(SKIRMISH_CODE.slice(0, -3))).toBe("bad_code");
    expect(bad(SKIRMISH_CODE + "AA")).toBe("bad_code");
  });

  it("are caught when any one character is mistyped", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (let i = 5; i < SKIRMISH_CODE.length; i++) {
      for (const c of alphabet) {
        if (c === SKIRMISH_CODE[i]) continue;
        const typo = SKIRMISH_CODE.slice(0, i) + c + SKIRMISH_CODE.slice(i + 1);
        const d = decodeLayout(typo);
        // A change in the last character's unused bits can decode to the same base; anything else is refused.
        if (d.ok) expect(sorted(d.units)).toEqual(sorted(SKIRMISH_BASE));
      }
    }
  });

  it("are refused when units overlap, leave the board or stand upright away from the fort", () => {
    const overlap = SKIRMISH_BASE.map((u) => (u.id === "tank-1" ? { ...u, x: 4, y: 1 } : u));
    expect(bad(rawCode("skirmish", overlap))).toBe("bad_placement");
    const offBoard = SKIRMISH_BASE.map((u) => (u.id === "tank-1" ? { ...u, x: 11, y: 0 } : u));
    expect(bad(rawCode("skirmish", offBoard))).toBe("bad_placement");
    const loneUpright = SKIRMISH_BASE.map((u) => (u.id === "wall-2" ? { ...u, x: 0, y: 0, upright: true } : u));
    expect(bad(rawCode("skirmish", loneUpright))).toBe("bad_placement");
  });

  it("never throw on random junk", () => {
    const rng = new Rng(7);
    const chars = "PAB1-abcxyzXYZ0189-_=+/ !";
    for (let i = 0; i < 2000; i++) {
      const len = rng.int(0, 40);
      const text = (rng.next() < 0.5 ? "PAB1-" : "") + Array.from({ length: len }, () => rng.pick([...chars])).join("");
      expect(() => decodeLayout(text)).not.toThrow();
    }
  });
});

describe("Paste layout", () => {
  it("replaces the builder's base with the pasted one", () => {
    const g = createGame({ seed: 3, mode: "skirmish" });
    const r = pasteLayout(g, 0, SKIRMISH_CODE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sorted(r.game.players[0].units)).toEqual(sorted(SKIRMISH_BASE));
    expect(finishBuild(r.game, 0).ok).toBe(true);
  });

  it("refuses a code from another mode and leaves the base alone", () => {
    const g = createGame({ seed: 3, mode: "battle" });
    const r = pasteLayout(g, 0, SKIRMISH_CODE);
    expect(r).toEqual({ ok: false, reason: "wrong_mode", mode: "skirmish" });
    expect(g.players[0].units).toEqual([]);
  });

  it("only works for the player who is building", () => {
    const g = createGame({ seed: 3, mode: "skirmish" });
    expect(pasteLayout(g, 1, SKIRMISH_CODE).ok).toBe(false);
  });
});
