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
      return "Blocked by wall";
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
      return "was blocked by one of your walls";
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
    heading: "Playing the computer",
    body: [
      "After New game, choose vs Computer to play alone, or Share device to play a friend on one phone. The computer builds its own secret base and fires back after each of your turns. It plays fair: it only knows where its own shots hit or missed.",
    ],
  },
  {
    heading: "Your army",
    body: [
      "In Battle and Score attack both players get the same 17 units: 1 fort (3 x 3 squares, takes 2 hits), 3 tanks and 3 artillery (2 x 2 squares), 6 infantry (1 square) and 4 walls (2 x 1 squares). Bigger units are easier for your opponent to hit.",
      "Skirmish uses 1 fort, 1 tank, 1 artillery, 2 infantry and 2 walls.",
      "Walls don't count. Walls are there to protect your army, not to fight. You don't need to destroy them to win. The counter shows the fort, tanks and artillery you still have to destroy, with the infantry beneath it. In Score attack it counts every fighting unit.",
    ],
  },
  {
    heading: "Building your base",
    body: [
      "Hold the phone sideways. Your base fills the screen. Drag each unit from the tray onto the grid and it snaps into place. Or tap a unit in the tray, then tap the grid to put it there.",
      "Drag a wall next to your fort and it snaps against the fort, standing upright on the sides. Tap a placed wall to turn it. Use all four to surround your fort.",
      "Drag a unit off the grid to remove it. Tap Random layout if you want the game to place everything for you. When every unit is placed, tap Done.",
    ],
  },
  {
    heading: "Taking your turn",
    body: [
      "Tap Start on the black screen. You'll see your own base, with your opponent's last shot marked.",
      "Each turn starts with a quick look at where the last enemy shot hit your base, then moves to the Enemy base. It looks like blank paper, apart from the results of your earlier shots.",
      "Tap where you want to aim. A magnifier ring with a crosshair appears on the spot, and you can drag to adjust. Then tap Fire, or tap the same spot again quickly. You get one shot per turn.",
      "See the result straight away. Flip back to My base if you want to look again. Tap End turn and pass the phone.",
    ],
  },
  {
    heading: "Hits, misses and walls",
    body: [
      "Your shot is a circle a little bigger than one infantry square. Anything it touches is hit, so one lucky shot can hit more than one unit.",
      "Miss: a pencil mark stays on the paper so you know that spot is empty. Destroyed: the unit appears with a red cross through it. Fort damaged: your first hit on the fort shows it cracked, and one more hit destroys it. Blocked by wall: the wall takes the whole shot and is destroyed, and a shield marks the spot. Anything else under that shot is safe and stays hidden, even if the circle touched it.",
      "All your earlier shots stay on the Enemy base view for the rest of the game, so use them to work out where the enemy is hiding.",
    ],
  },
  {
    heading: "Passing the phone",
    body: [
      "You share one phone, so keep your eyes off the screen when it isn't your turn. After every turn the screen goes black and shows who to pass to. Nothing appears until that player taps Start.",
    ],
  },
  {
    heading: "Strategic (test build)",
    body: [
      "A try-out of a bigger game, for two players on one phone. Each base lands at a random spot in its own half of a large paper map hidden by fog of war: you only see the ground near your own units, and nobody knows where the enemy base is, so you have to find it. Drag to pan, pinch to zoom, and tap Whole map or the mini-map to get around. On your turn, tap a tank, your artillery or the truck to give it orders. A tank can move up to 3 squares and then fire at an enemy it can see within 2 squares. A tank or truck that runs into an enemy hidden in the fog stops beside it. Artillery stays put and lobs a shell anywhere at least 3 squares away; the shell drifts a little up close and at most 2 squares across the map (the dashed circle around your aim shows how far), and you only see what it hit if that ground is in sight. The truck moves 5 squares and carries up to 4 infantry standing next to it, who get off on the side the truck was heading; infantry beside your truck wait for the lift instead of marching off.",
      "Infantry act on their own at the start of your turn: they attack anything next to them, close in on enemies they can see, and otherwise march toward the enemy half. From your second turn, your fort sends out one new infantry a turn, on the side facing the middle of the map. Units take hits: a fort stands 6 damage, a tank 3, artillery and the truck 2, infantry and walls 1. A shell does 3, a tank shot 2 and infantry 1, and a shell that touches a wall is spent on the wall. Destroy the enemy fort to win. End turn passes the phone.",
      "When you pick up the phone you first see what your units saw of the enemy's turn; tap Start my turn to skip it. When a fort falls the fog lifts and dotted lines show where every unit went; tap Watch the match to see the whole game again, turn by turn.",
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

/** The About screen: who made the game, what it uses, and what happens to your data (nothing leaves the device). */
export const ABOUT: { heading: string; body: string[] }[] = [
  {
    heading: "Credits",
    body: [
      "A digital version of a two-player paper game from childhood: hide an army on one half of a page, then hunt for the other player's units with pencil marks.",
      "Game design and testing by the Pencil Army Base project. Built with Claude, an AI assistant made by Anthropic. The pencil drawings were made for this game. The handwriting font is Patrick Hand by Patrick Wagesreiter, used under the SIL Open Font License.",
    ],
  },
  {
    heading: "Privacy",
    body: [
      "This game collects nothing. There are no accounts, no ads and no tracking, and nothing you do is sent anywhere. Your game in progress and your accessibility choices are saved only on this device, and Play again or New game clears the saved game.",
    ],
  },
];
