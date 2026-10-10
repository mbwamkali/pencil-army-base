import { ARMY, FOOTPRINT, HITS_TO_DESTROY, UNIT_TYPES, type UnitType } from "./constants.ts";

export type UnitState = "normal" | "damaged" | "destroyed";

export interface Unit {
  id: string;
  type: UnitType;
  /** Top-left grid square. */
  x: number;
  y: number;
  /** Only walls beside the fort may stand upright (1 wide, 2 deep). */
  upright: boolean;
  hits: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Every unit in an army, with a stable id, in tray order. */
export const ARMY_SLOTS: readonly { id: string; type: UnitType }[] = UNIT_TYPES.flatMap((type) =>
  Array.from({ length: ARMY[type] }, (_, i) => ({ id: `${type}-${i + 1}`, type })),
);

/** Every unit in the army of the given size, with a stable id, in tray order. */
export function armySlots(army: Record<UnitType, number>): { id: string; type: UnitType }[] {
  return UNIT_TYPES.flatMap((type) => Array.from({ length: army[type] }, (_, i) => ({ id: `${type}-${i + 1}`, type })));
}

/** The unit type an id belongs to ("tank-2" is a tank), or undefined if it is not a unit id. */
export function typeOfId(id: string): UnitType | undefined {
  const [type, n] = id.split("-");
  return UNIT_TYPES.find((t) => t === type) && /^[1-9]\d*$/.test(n ?? "") ? (type as UnitType) : undefined;
}

export function sizeOf(type: UnitType, upright: boolean): { w: number; h: number } {
  const { w, h } = FOOTPRINT[type];
  return upright && type === "wall" ? { w: h, h: w } : { w, h };
}

export function rectOf(u: Pick<Unit, "type" | "x" | "y" | "upright">): Rect {
  const { w, h } = sizeOf(u.type, u.upright);
  return { x: u.x, y: u.y, w, h };
}

export function unitState(u: Pick<Unit, "type" | "hits">): UnitState {
  const need = HITS_TO_DESTROY[u.type];
  if (u.hits >= need) return "destroyed";
  return u.hits > 0 ? "damaged" : "normal";
}

export function isFighting(u: Pick<Unit, "type">): boolean {
  return u.type !== "wall";
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
