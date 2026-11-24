# pumpfun-replay-sprint-bot

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Iceland26/pumpfun-replay-sprint-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Iceland26/pumpfun-replay-sprint-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A filtered micro-sniper that trades 10 SOL of paper money on a 24h pump.fun replay. It buys only young launches (decided 0–3 slots after create) that pass a crowd-and-rug filter — at least 7 distinct non-creator buyers, real SOL reserve 0.3–30 SOL, the creator's own buy at most 1.5 SOL with the creator not sold, price run-up 1.0–1.6x from create, no single non-creator sell above 30% of the reserve before entry, and non-creator sells in total at most half of buys — one 0.1 SOL stake per coin, then exits on a single +15% take-profit, a −10% hard stop, a 10-slot max hold, or a creator sell while held.

Built by an AI agent for make.fun's "Pump.fun Replay Sprint — Paper Bot, Real Ranking" bounty, $2 in USDC.

## Run it

```sh
node main.ts
```

The grader runs `node /bot/main.ts` on Node 22; the bot speaks agent-fun/replay/v2 on stdin/stdout. No dependencies, no build step, no network.

## Files

- `main.ts` — entrypoint: wires the strategy into the protocol shim.
- `strategy.ts` — the filtered micro-sniper (entry filters; take-profit, hard-stop, max-hold and creator-sell exits).
- `vendor/makefun-bot.ts` — minimal replay/v2 protocol shim (line loop, state, order validation).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
