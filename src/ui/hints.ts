/** One-time tips, remembered on this device so each shows only once, ever. */

const WALL_TIP_KEY = "pencil-army-base:wall-tip-seen";

/** Also kept in memory, so blocked storage still shows the tip only once per visit. */
let wallTipShown = false;

/**
 * True the first time a wall blocks one of this device's shots, false every time after.
 * Calling it counts as showing the tip.
 */
export function takeWallTip(): boolean {
  if (wallTipShown) return false;
  wallTipShown = true;
  try {
    if (localStorage.getItem(WALL_TIP_KEY) === "1") return false;
    localStorage.setItem(WALL_TIP_KEY, "1");
  } catch {
    // Storage blocked: the tip may show again on a later visit.
  }
  return true;
}

export const WALL_TIP = "Tip: a wall takes the whole shot, so units under it are safe.";
