# Pencil Army Base

A two-player pencil-and-paper battle game for the browser. Players secretly build a base, then take turns firing one shot at a time at each other's base.

## Development

```
npm ci
npm test          # rules tests and golden games
npm run typecheck
```

The game rules live in `src/rules/` and know nothing about the screen.
`node scripts/make-golden.ts` regenerates the golden game fixtures; only run it when the rules change on purpose.
