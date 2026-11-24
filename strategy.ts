// Filtered micro-sniper for agent-fun/replay/v2 (pump.fun bonding curves).
//
// The bot watches every coin from its CreateEvent and reads the first
// slots of its tape: how many distinct wallets bought in, whether the
// creator has already sold, how much real SOL the curve holds, how far
// price has run from the create price, and whether early selling
// already looks like a dump — one wallet unloading a large share of
// the reserve, or sellers together outweighing half of what buyers
// paid in. A launch must pass every filter; the bot then stakes once
// and leaves on the first of: +15% take-profit, -10% hard stop,
// 10 slots held, or the creator selling while held. No clock, no
// randomness, no I/O: the same batches always give the same orders.
//
// Deliberately absent, each measured harmful or dead on the dev
// window before being dropped: a buy-slippage cap (under the 2-slot
// fill latency it rejects exactly the fast runners this design lives
// on, so buy slippage stays uncapped on purpose), a trailing stop
// (the +15% take-profit always fires first, so a trail can never
// bind), a stale-tape exit and a recent-flow gate (at decision ages
// of 0-3 slots neither ever bound).
//
// Tuning discipline: parameters were fitted on the dev window only,
// then checked untouched on the window's second half and on the 20
// rebuilt stress copies from grade-local. The shipped set is the best
// measured variant — several times the old dev score, positive on the
// second half, still positive at double fees — while the stress
// copies still lean negative. It is a least-bad honest set, not a
// proven edge.

import { BPS, type BotState, type Batch, type OrderInput, type Pubkey } from './vendor/makefun-bot.ts';

/** One step of the take-profit ladder: at `bps` over cost, sell `partBps` of what is then held. */
export interface TpRung {
  bps: number;
  partBps: number;
}

export interface Params {
  /** First slot age at which a buy may be decided. */
  minAge: number;
  /** Last slot age at which a first buy may still be decided. */
  maxAge: number;
  /** Lamports aimed per coin (each order is still capped at 1% of the real reserve). */
  stakeLamports: number;
  /** Smallest buy worth its transaction fee. */
  minBuyLamports: number;
  /** Real SOL reserve window at decision time, lamports. */
  minRealSol: number;
  maxRealSol: number;
  /** The creator's create-slot buys, lamports window. */
  minDevBuy: number;
  maxDevBuy: number;
  /** Distinct non-creator buyers required before entry. */
  minBuyers: number;
  /** Others' sold lamports over bought lamports, bps ceiling. */
  maxSellRatioBps: number;
  /** Largest single non-creator sell, bps of the reserve just before it, ceiling. */
  maxBigSellBps: number;
  /** Price over the create price as a bps ratio: window (10000 = 1.00x). */
  minRunupBps: number;
  maxRunupBps: number;
  /** A creator who already sold disqualifies the coin. */
  skipDevSold: boolean;
  /** Buy slippage tolerance in bps; kept at the maximum for the measured reason in the header. */
  buySlippageBps: number;
  /** Take-profit ladder, ascending; the shipped set has a single full-exit rung. */
  tpRungs: TpRung[];
  /** Hard stop: exit at this many bps under cost. */
  hardStopBps: number;
  /** Longest a position may be held, in slots. */
  maxHold: number;
  /** Exit a held coin as soon as its creator sells. */
  exitOnDevSell: boolean;
}

export const DEFAULT_PARAMS: Params = {
  minAge: 0,
  maxAge: 3,
  stakeLamports: 100_000_000,
  minBuyLamports: 5_000_000,
  minRealSol: 300_000_000,
  maxRealSol: 30_000_000_000,
  minDevBuy: 0,
  maxDevBuy: 1_500_000_000,
  minBuyers: 7,
  maxSellRatioBps: 5_000,
  maxBigSellBps: 3_000,
  minRunupBps: 10000,
  maxRunupBps: 16000,
  skipDevSold: true,
  buySlippageBps: 10_000,
  tpRungs: [{ bps: 1500, partBps: 10000 }],
  hardStopBps: 1000,
  maxHold: 10,
  exitOnDevSell: true,
};

/** Per-coin tape, accumulated from its events. */
interface Coin {
  mint: Pubkey;
  createSlot: number;
  creator: Pubkey;
  /** Reserves at create; the run-up is measured against these. */
  birthQuote: bigint;
  birthTokens: bigint;
  creatorBuyIn: bigint;
  crowd: Set<Pubkey>;
  buyLamports: bigint;
  sellLamports: bigint;
  worstSellBps: bigint;
  creatorSold: boolean;
  /** Settled for good: bought, filtered out permanently, or completed. */
  closed: boolean;
  finished: boolean;
}

/** Bookkeeping for one open position. */
interface Held {
  entrySlot: number;
  feesPaid: bigint;
  creatorSoldAtEntry: boolean;
  rungIndex: number;
}

export interface Strategy {
  onBatch(state: BotState, batch: Batch): OrderInput[];
}

const CURVE_FEE_BPS = 125n;

/** Lamports a sale of `tokens` into (quote, tokens) reserves nets after the 95 + 30 bps curve fees. */
function netSellQuote(tokens: bigint, quote: bigint, poolTokens: bigint): bigint {
  if (tokens <= 0n || poolTokens <= 0n) return 0n;
  const gross = (tokens * quote) / (poolTokens + tokens);
  return gross - (gross * CURVE_FEE_BPS + BPS - 1n) / BPS;
}

export function createStrategy(params: Params = DEFAULT_PARAMS): Strategy {
  const P = params;
  const coins = new Map<Pubkey, Coin>();
  const held = new Map<Pubkey, Held>();
  /** Mints whose sell order is still in flight. */
  const selling = new Set<Pubkey>();

  function absorbEvents(batch: Batch): void {
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        coins.set(e.mint, {
          mint: e.mint,
          createSlot: e.slot,
          creator: e.creator,
          birthQuote: BigInt(e.virtual_quote_reserves),
          birthTokens: BigInt(e.virtual_token_reserves),
          creatorBuyIn: 0n,
          crowd: new Set(),
          buyLamports: 0n,
          sellLamports: 0n,
          worstSellBps: 0n,
          creatorSold: false,
          closed: false,
          finished: false,
        });
      } else if (e.event === 'TradeEvent') {
        const c = coins.get(e.mint);
        if (c === undefined) continue;
        const sol = BigInt(e.sol_amount);
        const isCreator = e.user === c.creator;
        if (e.is_buy) {
          c.buyLamports += sol;
          if (isCreator && e.slot === c.createSlot) c.creatorBuyIn += sol;
          else if (!isCreator) c.crowd.add(e.user);
        } else if (isCreator) {
          c.creatorSold = true;
        } else {
          c.sellLamports += sol;
          const reserveBefore = BigInt(e.real_quote_reserves) + sol;
          if (reserveBefore > 0n) {
            const share = (sol * BPS) / reserveBefore;
            if (share > c.worstSellBps) c.worstSellBps = share;
          }
        }
      } else {
        const c = coins.get(e.mint);
        if (c !== undefined) {
          c.finished = true;
          c.closed = true;
        }
      }
    }
  }

  function buyInFlight(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'buy') return true;
    return false;
  }

  function sellInFlight(state: BotState, mint: Pubkey): boolean {
    for (const p of state.pending.values()) if (p.order.mint === mint && p.order.side === 'sell') return true;
    return false;
  }

  return {
    onBatch(state, batch) {
      absorbEvents(batch);
      const orders: OrderInput[] = [];
      const cap = state.hello.caps.max_orders_per_batch;
      const txFee = state.txFeeLamports();
      const marks = new Map<Pubkey, { vq: bigint; vt: bigint }>();
      for (const m of batch.marks) marks.set(m.mint, { vq: BigInt(m.virtual_quote_reserves), vt: BigInt(m.virtual_token_reserves) });

      // Settle the fills that came back with this batch.
      for (const f of batch.fills) {
        if (f.client_id.startsWith('_')) {
          held.delete(f.mint);
          selling.delete(f.mint);
          continue;
        }
        const h = held.get(f.mint);
        if (f.status !== 'rejected' && h !== undefined) h.feesPaid += BigInt(f.tx_fee_lamports);
        if (f.side === 'buy' && f.status === 'filled' && h === undefined) {
          held.set(f.mint, { entrySlot: f.slot, feesPaid: BigInt(f.tx_fee_lamports), creatorSoldAtEntry: coins.get(f.mint)?.creatorSold ?? false, rungIndex: 0 });
        }
      }
      for (const mint of [...selling]) if (!sellInFlight(state, mint)) selling.delete(mint);
      for (const mint of [...held.keys()]) {
        if (!state.positions.has(mint) && !selling.has(mint) && !buyInFlight(state, mint)) held.delete(mint);
      }

      // Exits before entries, so a freed slot and its cash can be reused.
      for (const [mint, pos] of state.positions) {
        if (orders.length >= cap) break;
        if (selling.has(mint)) continue;
        const c = coins.get(mint);
        let h = held.get(mint);
        if (h === undefined) {
          h = { entrySlot: state.slot, feesPaid: txFee, creatorSoldAtEntry: c?.creatorSold ?? false, rungIndex: 0 };
          held.set(mint, h);
        }
        let mark = marks.get(mint);
        if (mark === undefined) {
          const curve = state.curves.get(mint);
          if (curve === undefined) continue;
          mark = { vq: curve.virtual_quote_reserves, vt: curve.virtual_token_reserves };
        }
        const value = netSellQuote(pos.token_amount, mark.vq, mark.vt) - txFee;
        const basis = pos.cost_lamports + h.feesPaid;
        if (basis <= 0n) continue;
        const rung = P.tpRungs[h.rungIndex];
        if (rung !== undefined && value * BPS >= basis * (BPS + BigInt(rung.bps))) {
          const part = (pos.token_amount * BigInt(rung.partBps)) / BPS;
          if (part > 0n && part < pos.token_amount) {
            orders.push({ side: 'sell', mint, token_amount: part, max_slippage_bps: 10_000 });
            selling.add(mint);
            h.rungIndex += 1;
            continue;
          }
          orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
          selling.add(mint);
          if (c !== undefined) c.closed = true;
          continue;
        }
        let leave = false;
        if (value * BPS <= basis * (BPS - BigInt(P.hardStopBps))) leave = true;
        if (state.slot - h.entrySlot >= P.maxHold) leave = true;
        if (c !== undefined && P.exitOnDevSell && c.creatorSold && !h.creatorSoldAtEntry) leave = true;
        if (!leave) continue;
        orders.push({ side: 'sell', mint, token_amount: pos.token_amount, max_slippage_bps: 10_000 });
        selling.add(mint);
        if (c !== undefined) c.closed = true;
      }

      // Entries: one stake per coin, never a second helping.
      let cash = state.freeCashLamports() - txFee * BigInt(orders.length);
      let openCount = state.committedPositionCount();
      for (const c of coins.values()) {
        if (orders.length >= cap) break;
        if (c.closed || c.finished) continue;
        const age = state.slot - c.createSlot;
        if (age > P.maxAge) {
          c.closed = true;
          continue;
        }
        if (age < P.minAge) continue;
        if (openCount >= state.hello.caps.max_open_positions) continue;
        const curve = state.curves.get(c.mint);
        if (curve === undefined || curve.complete) continue;
        if (c.creatorSold && P.skipDevSold) {
          c.closed = true;
          continue;
        }
        const reserve = curve.real_quote_reserves;
        if (reserve < BigInt(P.minRealSol) || reserve > BigInt(P.maxRealSol)) continue;
        if (c.creatorBuyIn < BigInt(P.minDevBuy) || c.creatorBuyIn > BigInt(P.maxDevBuy)) continue;
        if (c.crowd.size < P.minBuyers) continue;
        if (c.buyLamports > 0n && c.sellLamports * BPS > c.buyLamports * BigInt(P.maxSellRatioBps)) continue;
        if (c.worstSellBps > BigInt(P.maxBigSellBps)) continue;
        const runup = (curve.virtual_quote_reserves * c.birthTokens * BPS) / (curve.virtual_token_reserves * c.birthQuote);
        if (runup > BigInt(P.maxRunupBps) || runup < BigInt(P.minRunupBps)) continue;
        const ceiling = state.maxBuyLamports(c.mint);
        const amount = BigInt(P.stakeLamports) < ceiling ? BigInt(P.stakeLamports) : ceiling;
        if (amount < BigInt(P.minBuyLamports)) continue;
        if (cash < amount + txFee) continue;
        orders.push({ side: 'buy', mint: c.mint, quote_lamports: amount, max_slippage_bps: P.buySlippageBps });
        cash -= amount + txFee;
        c.closed = true;
        openCount += 1;
      }
      return orders;
    },
  };
}
