import type { ShotResult } from "../rules/shots.ts";
import { UNIT_LABEL } from "./art.ts";

function destroyedNames(r: ShotResult): string[] {
  return r.hits.filter((h) => h.after === "destroyed").map((h) => UNIT_LABEL[h.type]);
}

/** The banner shown after you fire. */
export function describeShot(r: ShotResult): string {
  switch (r.outcome) {
    case "miss":
      return "Miss";
    case "wall":
      return "Wall hit";
    case "damaged":
      return "Fort damaged";
    case "destroyed":
      return `Destroyed: ${destroyedNames(r).join(", ")}`;
  }
}

/** What the enemy's last shot did to you, shown when your turn starts. */
export function describeIncoming(r: ShotResult): string {
  switch (r.outcome) {
    case "miss":
      return "missed";
    case "wall":
      return "hit one of your walls";
    case "damaged":
      return "damaged your fort";
    case "destroyed":
      return `destroyed your ${destroyedNames(r).join(", ").toLowerCase()}`;
  }
}

export const HOW_TO_PLAY: { heading: string; body: string[] }[] = [
  {
    heading: "The goal",
    body: [
      "Wipe out your opponent's army before they wipe out yours. Each of you builds a secret base, then you take turns firing one shot at a time at the other's base.",
    ],
  },
  {
    heading: "Game modes",
    body: [
      "Pick a mode when you start a game. Skirmish (the default) is a small army on a small board. Battle is the full army on the full board. Score attack is the full army with 20 shots each, and the most points wins.",
    ],
  },
  {
    heading: "Your army",
    body: [
      "In Battle and Score attack both players get the same 17 units: 1 fort (3 x 3 squares, takes 2 hits), 3 tanks and 3 artillery (2 x 2 squares), 6 infantry (1 square) and 4 walls (2 x 1 squares). Bigger units are easier for your opponent to hit.",
      "Skirmish uses 1 fort, 1 tank, 1 artillery, 2 infantry and 2 walls.",
      "Walls don't count. Walls are there to protect your army, not to fight. They are not included in the units-left counter, and you don't need to destroy them to win. The counter starts at 13: your fort, tanks, artillery and infantry.",
    ],
  },
  {
    heading: "Building your base",
    body: [
      "Hold the phone sideways. Your base fills the screen. Drag each unit from the tray onto the grid and it snaps into place.",
      "Drag a wall next to your fort and it snaps against the fort, standing upright on the sides. Use all four to surround your fort.",
      "Drag a unit off the grid to remove it. Tap Random layout if you want the game to place everything for you. When every unit is placed, tap Done.",
    ],
  },
  {
    heading: "Taking your turn",
    body: [
      "Tap Start on the black screen. You'll see your own base, with your opponent's last shot marked.",
      "Flip the switch to Target to see your opponent's base. It looks like blank paper, apart from the results of your earlier shots.",
      "Tap where you want to aim. A magnifier ring with a crosshair appears on the spot, and you can drag to adjust. Then tap Fire. You get one shot per turn.",
      "See the result straight away. Flip back to My base if you want to look again. Tap End turn and pass the phone.",
    ],
  },
  {
    heading: "Hits, misses and walls",
    body: [
      "Your shot is a circle a little bigger than one infantry square. Anything it touches is hit, so one lucky shot can hit more than one unit.",
      "Miss: a pencil mark stays on the paper so you know that spot is empty. Destroyed: the unit appears with a red cross through it. Fort damaged: your first hit on the fort shows it cracked, and one more hit destroys it. Wall hit: the wall takes the blow and is destroyed. Anything else under that shot is safe and stays hidden.",
      "All your earlier shots stay on the Target view for the rest of the game, so use them to work out where the enemy is hiding.",
    ],
  },
  {
    heading: "Passing the phone",
    body: [
      "You share one phone, so keep your eyes off the screen when it isn't your turn. After every turn the screen goes black and shows who to pass to. Nothing appears until that player taps Start.",
    ],
  },
  {
    heading: "Winning",
    body: [
      "In Skirmish and Battle, the first player to destroy the other side's fort and every tank and artillery wins. Infantry are optional, but they still score points. Score attack: after 20 shots each, the higher score wins. Walls left standing never matter. When the game ends, both bases are revealed so you can see the near misses.",
      "Points show on the side panel in every mode. Each hit scores: infantry 1, tank 3, artillery 3, fort 5 (on each of its two hits), walls 0.",
      "Tips: spread your infantry out so one shot can't catch several. Walls protect the edges of your fort, but a sharp shot aimed at its centre can still get through.",
    ],
  },
];
