# 🎰 Lucky Reels — Provably Fair Video Slot

A 5-reel, 3-row, 10-payline casino slot that runs in the browser. It has wilds, scatter pays, a free-spins bonus, and a commit-reveal RNG, so every spin can be checked independently. There are no dependencies and no build step.

> **Demo credits only.** This is a game and math prototype. Read [Production notes](#production-notes) before you connect it to real money.

## Quick start

```bash
npm start          # http://127.0.0.1:8080  (Node ≥ 20, no npm install needed)
npm test           # engine, RNG and game-session unit tests
npm run simulate   # Monte Carlo RTP report (default 2M spins)
npm run simulate -- 20000000
```

Controls: **SPIN** or the space bar spins. Press SPIN again during a spin to slam-stop the reels. You can also set autoplay to 10–100 spins and turn on turbo mode.

## Game features

| Feature | Detail |
|---|---|
| Layout | 5 reels × 3 rows, 10 fixed paylines, left-to-right line pays |
| Wild ⭐ | Substitutes for every symbol except Scatter. Has its own pay (5× = 2,500× line bet) |
| Scatter 💎 | Pays anywhere as a multiple of the total bet: 3 → ×3, 4 → ×15, 5 → ×100 |
| Free spins | 3+ scatters award 10 spins at the triggering bet, with all wins ×2. Can retrigger, capped at 100 spins per bonus |
| Bets | 0.10 – 10.00. All amounts are integer cents, so there is no floating-point drift |
| UX | Animated reels, win-line overlay, Big/Mega win splash, synthesized sound, paytable that updates with your bet, mobile layout, reduced-motion support |

## Game math (from 20M simulated spins)

| Metric | Value |
|---|---|
| **RTP** | **95.76%** (95% CI ±0.17%) |
| Base line pays / scatter pays / free spins | 65.0% / 5.8% / 24.9% |
| Hit frequency | 49.6% |
| Bonus frequency | 1 in ~67 spins |
| Volatility (SD) | ~3.9× bet (medium) |

To tune the game, edit `REEL_COMPOSITION`, `PAYTABLE`, `SCATTER_PAYS` or `FREE_SPINS` in `src/config.js`, then run `npm run simulate`. The reel strips are laid out with a fixed-seed shuffle, so they are identical on every load and can be audited.

## Provably fair RNG

1. The game generates a random 256-bit server seed and publishes only its **SHA-256 hash** before you play.
2. You choose a **client seed**, and each spin increments a **nonce**.
3. Reel stops = `HMAC-SHA256(serverSeed, "clientSeed:nonce")`. The digest is split into 32-bit words, one per reel, and each word is scaled onto that reel's strip length. The bias from this scaling is under 1e-8.
4. **Rotate seed & reveal** publishes the old server seed. The 🛡️ panel then recomputes any past spin and confirms that the seed matches the hash committed before play.

## Architecture

```
index.html, styles.css   UI shell (strict CSP-compatible: no inline scripts/styles)
src/config.js            symbols, reel strips, paylines, paytable, bet levels
src/engine.js            PURE math: stops → grid → line/scatter evaluation
src/fair.js              commit-reveal RNG (Web Crypto; works in browser and Node)
src/game.js              session state machine: balance, bet validation, free spins
src/ui.js                DOM rendering, animation, controls, fairness panel
src/audio.js             WebAudio synth (no audio assets)
scripts/simulate.js      Monte Carlo RTP / volatility report
scripts/serve.js         static server with CSP + path-traversal protection
test/engine.test.js      node:test suite
```

The engine is deterministic and has no side effects: the same stops always produce the same result. This lets tests, the simulator and the verifier all run the exact code that pays the player.

## Production notes

This demo runs entirely client-side. That is fine for play money, but it is **not** acceptable for real-money gaming. Before a real launch:

- **Server-authoritative outcomes.** Move the seed pair, nonce, balance and `SlotGame` to a server. The client should only animate results the server returns.
- **Certified RNG and math.** Get independent lab certification (e.g. GLI-11/GLI-19, eCOGRA, BMM) for the RNG and the published RTP. Keep a PAR sheet for each configuration.
- **Transactional wallet.** Debit the bet and credit the win in one atomic transaction, with idempotency keys and an append-only audit log of spins (seed hash, nonce, stops, bet, win).
- **Licensing and compliance.** Complete KYC/AML checks, and add responsible-gambling controls (deposit and loss limits, reality checks, self-exclusion) as your jurisdiction requires (e.g. UKGC RTS).
- **Security.** Rate limiting, anti-bot measures, TLS everywhere, and the CSP headers `scripts/serve.js` already sends.
