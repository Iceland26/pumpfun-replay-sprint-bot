// Filtered micro-sniper for the Pump.fun Replay Sprint (agent-fun/replay/v2).
// Run by the grader as `node /bot/main.ts`; the strategy lives in
// strategy.ts, the protocol in the vendored shim (vendor/makefun-bot.ts).

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy, DEFAULT_PARAMS } from './strategy.ts';

const strategy = createStrategy(DEFAULT_PARAMS);

await runBot({
  onBatch: (state, batch) => strategy.onBatch(state, batch),
});
