import type { UnitType } from "../rules/constants.ts";
import type { UnitState } from "../rules/units.ts";

const base = import.meta.env.BASE_URL;

export const artUrl = (name: string): string => `${base}art/${name}.svg`;

export function unitArt(type: UnitType, state: UnitState): string {
  if (state === "destroyed") return artUrl(`${type}-destroyed`);
  if (state === "damaged" && type === "fort") return artUrl("fort-damaged");
  return artUrl(type);
}

export const UNIT_LABEL: Record<UnitType, string> = {
  fort: "Fort",
  tank: "Tank",
  artillery: "Artillery",
  infantry: "Infantry",
  wall: "Wall",
};
