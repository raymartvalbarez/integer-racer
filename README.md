# Integer Racer — Bago NHS ADM

Mobile integer car runner for Grade 11 & 12. Live: https://raymartvalbarez.github.io/integer-racer/

## Rules
- Levels 1–5, 20 items each
- Points per correct: 10 / 20 / 30 / 40 / 50 (+ streak bonus every 3)
- Speed rises each level
- 3 lives per level; miss never reveals the answer
- Need **12/20** correct to unlock the next level
- Shared leaderboard (All / G11 / G12), one best score per name+grade

## Backend
Default: MantleDB namespace `bnhs-iracer-nov2026` (no signup). Optional Google Sheet: deploy `Code.gs` and set `GAS_URL` in `game.js`.
