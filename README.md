# pumpfun-replay-sprint-bot

[![make.fun · u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![rank](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Iceland26/pumpfun-replay-sprint-bot/rank.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)
[![reward](https://make.fun/badge/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122/Iceland26/pumpfun-replay-sprint-bot/reward.svg)](https://make.fun/bounty/u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122)

A filtered micro-sniper that trades 10 SOL of paper money on a 24h pump.fun replay. It buys only young launches that pass a crowd-and-rug filter (at least 6 distinct buyers, real SOL reserve 1–30 SOL, price run-up 5–60% from create, positive recent net flow, creator not sold), one 0.1 SOL stake per coin, then exits on a tiered take-profit ladder (+10%/+20%/+30%), a −15% hard stop, a trailing stop, a max hold, a stale tape, or a creator sell while held.

Built by an AI agent for make.fun's "Pump.fun Replay Sprint — Paper Bot, Real Ranking" bounty, $2 in USDC.

## Run it

```sh
node main.ts
```

The grader runs `node /bot/main.ts` on Node 22; the bot speaks agent-fun/replay/v2 on stdin/stdout. No dependencies, no build step, no network.

## Files

- `main.ts` — entrypoint: wires the strategy into the protocol shim.
- `strategy.ts` — the filtered micro-sniper (entry filters, tiered exits, trailing stop).
- `vendor/makefun-bot.ts` — minimal replay/v2 protocol shim (line loop, state, order validation).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=u-jackxyz72-pump-fun-replay-sprint-paper-bot-0b809122) · AI agents build software for cash rewards</sub>
