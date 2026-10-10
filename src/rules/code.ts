import { MODE_IDS, MODES, modeOf, type ModeId } from "./modes.ts";
import { placementProblem } from "./placement.ts";
import { armySlots, type Unit } from "./units.ts";
import type { Game, Outcome, PlayerIndex } from "./game.ts";

/**
 * Layout codes: a whole base packed into a short string, for Copy layout / Paste layout.
 *
 * Bytes: mode, then each unit's square (y * board width + x) in army order, then a bitmask of
 * which walls stand upright, then a 16-bit check value. The bytes are scrambled with a fixed key
 * so the code doesn't read at a glance, then written as URL-safe base64 after "PAB1-".
 * It is not secret: anyone reading this file can decode it.
 */
const PREFIX = "PAB1-";
const KEY = [0x5a, 0xc3, 0x17, 0x8e, 0x2b, 0xf4, 0x61, 0x9d];

export type CodeProblem = "empty" | "bad_code" | "wrong_mode" | "bad_placement";

export type DecodeResult = { ok: true; mode: ModeId; units: Unit[] } | { ok: false; reason: CodeProblem };

/** 16-bit FNV-1a, enough to catch typos and a pasted half of a code. */
function check(bytes: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return (h ^ (h >>> 16)) & 0xffff;
}

const scramble = (bytes: number[]): number[] => bytes.map((b, i) => b ^ (KEY[i % KEY.length] as number) ^ ((i * 37) & 0xff));

function toBase64Url(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): number[] | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    return [...atob(text.replace(/-/g, "+").replace(/_/g, "/"))].map((c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The code for a complete base. Returns null if the army is not complete. */
export function encodeLayout(modeId: ModeId, units: readonly Unit[]): string | null {
  const mode = modeOf(modeId);
  const bytes = [MODE_IDS.indexOf(mode.id)];
  let upright = 0;
  let wall = 0;
  for (const slot of armySlots(mode.army)) {
    const u = units.find((v) => v.id === slot.id);
    if (!u) return null;
    bytes.push(u.y * mode.grid.w + u.x);
    if (slot.type === "wall") {
      if (u.upright) upright |= 1 << wall;
      wall++;
    }
  }
  bytes.push(upright);
  const c = check(bytes);
  bytes.push(c >> 8, c & 0xff);
  return PREFIX + toBase64Url(scramble(bytes));
}

/** Turns a code back into a base, checking every unit against the placement rules. Never throws. */
export function decodeLayout(text: string): DecodeResult {
  const trimmed = text.replace(/\s+/g, "");
  if (!trimmed) return { ok: false, reason: "empty" };
  if (trimmed.slice(0, PREFIX.length).toUpperCase() !== PREFIX) return { ok: false, reason: "bad_code" };
  const raw = fromBase64Url(trimmed.slice(PREFIX.length));
  if (!raw || raw.length < 4) return { ok: false, reason: "bad_code" };
  const bytes = scramble(raw);
  const body = bytes.slice(0, -2);
  if (check(body) !== ((bytes.at(-2) as number) << 8 | (bytes.at(-1) as number))) return { ok: false, reason: "bad_code" };

  const modeId = MODE_IDS[body[0] as number];
  if (!modeId) return { ok: false, reason: "bad_code" };
  const mode = MODES[modeId];
  const slots = armySlots(mode.army);
  if (body.length !== slots.length + 2) return { ok: false, reason: "bad_code" };

  const upright = body.at(-1) as number;
  const units: Unit[] = [];
  let wall = 0;
  for (const [i, slot] of slots.entries()) {
    const sq = body[i + 1] as number;
    const isUpright = slot.type === "wall" && (upright & (1 << wall++)) !== 0;
    const u: Unit = { id: slot.id, type: slot.type, x: sq % mode.grid.w, y: Math.floor(sq / mode.grid.w), upright: isUpright, hits: 0 };
    // Army order puts the fort first, so upright walls can be checked against it.
    if (placementProblem(units, u, mode.grid)) return { ok: false, reason: "bad_placement" };
    units.push(u);
  }
  return { ok: true, mode: modeId, units };
}

/** Paste layout: replaces the builder's base with the one in the code, or says why it can't. */
export function pasteLayout(game: Game, player: PlayerIndex, text: string): Outcome | { ok: false; reason: CodeProblem; mode?: ModeId } {
  if (game.phase !== "build" || game.building !== player) return { ok: false, reason: "wrong_phase" };
  const d = decodeLayout(text);
  if (!d.ok) return d;
  if (d.mode !== modeOf(game.mode).id) return { ok: false, reason: "wrong_mode", mode: d.mode };
  const g = structuredClone(game);
  g.players[player].units = d.units;
  return { ok: true, game: g };
}
