# Pencil Army Base

A two-player pencil-and-paper battle game for the browser. Players secretly build a base, then take turns firing one shot at a time at each other's base.

## Development

```
npm ci
npm run dev           # play it at http://localhost:5173 (add ?seed=7 for a repeatable game)
npm test              # rules tests and golden games
npm run typecheck
npm run test:e2e      # plays whole games in a simulated Pixel 9 (needs: npx playwright install chromium)
npm run build         # production build in dist/
```

The game rules live in `src/rules/` and know nothing about the screen; the screens are in `src/ui/`.
`node scripts/make-golden.ts` regenerates the golden game fixtures; only run it when the rules change on purpose.
