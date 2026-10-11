# Pencil Army Base

**Play it now: [mbwamkali.github.io/pencil-army-base](https://mbwamkali.github.io/pencil-army-base/)**

A phone-friendly battle game inspired by a pencil-and-paper game from childhood. Each player secretly builds an army base, then you take turns firing one shot at a time at the enemy base until one army is beaten.

## The paper game it comes from

Two kids would fold a sheet of paper in half. Each drew a base on their half: forts, tanks, infantry, artillery and walls. To attack, you made a heavy pencil mark on your side, folded the page and rubbed it, and whatever the smudge landed on across the fold was destroyed.

The digital version keeps the spirit (two hidden bases, one shot per turn, guessing where the enemy is, the notebook-and-pencil look) and fixes what paper couldn't: results are instant and fair, the enemy base really is hidden, shots land exactly where you aim, and the game keeps score for you.

## How to play

1. **Build your base.** Place your ready-made units on the grid: a fort, tanks, artillery, infantry and walls. Or tap Random layout.
2. **Pass the phone.** A black handoff screen sits between turns so nobody peeks at the other base.
3. **Fire.** Switch to the enemy base, tap where you want to aim, and fire. You see straight away whether you missed, hit a wall, damaged the fort or destroyed something.
4. **Win.** Destroy the enemy fort and every tank and artillery piece. Infantry only add points.

A few rules worth knowing:

- The fort takes two hits; everything else takes one.
- One shot can destroy several units.
- Walls absorb a shot: if your shot touches a wall, the wall is destroyed and anything else under the shot is safe.
- You only ever see enemy units you have destroyed.

## Game modes

| Mode | Army | Goal |
| --- | --- | --- |
| Skirmish (default) | 1 fort, 1 tank, 1 artillery, 2 infantry, 2 walls on a small board | Destroy the fort, tanks and artillery |
| Battle | Full army of 17 units on a 20 x 10 board | Destroy the fort, tanks and artillery |
| Score attack | Full army | Highest score after 20 shots each |

Points: infantry 1, tank 3, artillery 3, fort 5 per hit, walls 0.

Play with a friend on one phone, or against the computer.

## Platforms

- **Web:** works in any modern browser and is designed for a phone held sideways. Android Chrome (tested on a Pixel 9) is the main target; iPhones work but are less polished.
- **Install:** add it to your home screen to play full screen and offline.
- **Android app:** in testing.

## Development

```
npm ci
npm run dev           # play it at http://localhost:5173
npm test              # rules tests
npm run test:e2e      # browser tests on a simulated Pixel 9
npm run build         # production build in dist/
```

The game is TypeScript drawn with SVG, with no game engine. Rules live in `src/rules/` and the screens in `src/ui/`. Every push to `main` that passes CI deploys to GitHub Pages.
