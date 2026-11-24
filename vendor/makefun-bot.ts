// agent-fun/replay/v2 protocol shim for this entry, re-authored for the
// fixed strategy in ../strategy.ts.
//
// The harness talks JSON-lines: it sends one `hello`, then one `batch`
// per slot, then a final `done`, and expects exactly one `reply` line
// per batch on stdout. This file owns that conversation plus the
// bookkeeping a strategy needs (cash, positions, curves, pending
// orders), so the strategy itself stays a pure function of its inputs.
//
// Hard rules the harness grades on, kept here:
// - no clock, no environment, no Math.random: an entry runs twice and
//   the two action logs must match byte for byte; hello.seed is the
//   only sanctioned randomness and this shim never even needs it.
// - erasable TypeScript only (no enums, no namespaces, no parameter
//   properties): the grader runs `node /bot/main.ts` with no build step.

export const PROTOCOL = 'agent-fun/replay/v2';
/** Largest harness -> bot line, in UTF-8 bytes without the newline (1 MiB). */
export const MAX_HARNESS_LINE_BYTES = 1_048_576;
/** Largest bot -> harness line, in UTF-8 bytes without the newline (64 KiB). */
export const MAX_BOT_LINE_BYTES = 65_536;
export const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const LAMPORTS_PER_SOL = 1_000_000_000n;
/** 10_000 bps = 100%. */
export const BPS = 10_000n;
export const U64_MAX = 18_446_744_073_709_551_615n;

// ------------------------------------------------------------------ types

/** A u64 rendered as a canonical decimal string; parse with BigInt. */
export type U64 = string;
/** An i64 rendered as a canonical decimal string. */
export type I64 = string;
/** A base58 Solana address. */
export type Pubkey = string;

export interface Universe {
  program: typeof PUMP_PROGRAM_ID;
  quote: 'SOL';
  mayhem: 'excluded';
  exclude_cashback: true;
  /** A mint belongs iff sha256(mint) as a big-endian integer, mod modulus, equals residue. */
  sample: { hash: 'sha256'; modulus: number; residue: number };
}

export interface Caps {
  max_open_positions: number;
  /** Per mint and reply, buys together may spend at most this bps share of its real SOL reserve. */
  max_order_bps_of_real_reserve: number;
  /** Orders past this many in one reply are rejected (max_orders_per_batch). */
  max_orders_per_batch: number;
  shorts: false;
  leverage: false;
}

export interface Fees {
  protocol_bps_fallback: number;
  creator_bps_fallback: number;
  base_fee_lamports: U64;
  priority_fee_lamports: U64;
  /** Seeded share of transactions that fail outright, in bps. */
  failed_tx_bps: number;
}

export interface Hello {
  type: 'hello';
  protocol: typeof PROTOCOL;
  seed: U64;
  universe: Universe;
  capital: { lamports: U64 };
  caps: Caps;
  /** An order decided on the batch for slot s lands at slot s + latency_slots. */
  latency_slots: number;
  fees: Fees;
}

export interface Shareholder {
  address: Pubkey;
  share_bps: number;
}

/** Fields the collector stamps on every decoded event. */
export interface ChainMeta {
  slot: number;
  signature: string;
  block_time: number | null;
  /** Position of the event in its own mint's chain, 0-based. */
  chain_seq: number;
}

/** A trade against a curve; reserves are post-trade, and on SOL curves the *_quote_* pair rules. */
export interface TradeEventRecord extends ChainMeta {
  event: 'TradeEvent';
  mint: Pubkey;
  sol_amount: U64;
  token_amount: U64;
  is_buy: boolean;
  user: Pubkey;
  timestamp: I64;
  virtual_sol_reserves: U64;
  virtual_token_reserves: U64;
  real_sol_reserves: U64;
  real_token_reserves: U64;
  fee_recipient: Pubkey;
  fee_basis_points: U64;
  fee: U64;
  creator: Pubkey;
  creator_fee_basis_points: U64;
  creator_fee: U64;
  track_volume: boolean;
  total_unclaimed_tokens: U64;
  total_claimed_tokens: U64;
  current_sol_volume: U64;
  last_update_timestamp: I64;
  ix_name: string;
  mayhem_mode: boolean;
  cashback_fee_basis_points: U64;
  cashback: U64;
  buyback_fee_basis_points: U64;
  buyback: U64;
  shareholders: Shareholder[];
  quote_mint: Pubkey;
  quote_amount: U64;
  virtual_quote_reserves: U64;
  real_quote_reserves: U64;
  holder_rewards_bps: U64;
  holder_rewards: U64;
  creator_fee_unclaimed: U64;
}

/** A curve is born: initial reserves, with real SOL still 0. */
export interface CreateEventRecord extends ChainMeta {
  event: 'CreateEvent';
  name: string;
  symbol: string;
  uri: string;
  mint: Pubkey;
  bonding_curve: Pubkey;
  user: Pubkey;
  creator: Pubkey;
  timestamp: I64;
  virtual_token_reserves: U64;
  virtual_sol_reserves: U64;
  real_token_reserves: U64;
  token_total_supply: U64;
  token_program: Pubkey;
  is_mayhem_mode: boolean;
  is_cashback_enabled: boolean;
  quote_mint: Pubkey;
  virtual_quote_reserves: U64;
  creator_fee_bps: U64;
  is_holder_reward: boolean;
  depth: number;
}

/** A curve completed (migrated): trading is over and held positions get closed by the harness. */
export interface CompleteEventRecord extends ChainMeta {
  event: 'CompleteEvent';
  user: Pubkey;
  mint: Pubkey;
  bonding_curve: Pubkey;
  timestamp: I64;
  quote_mint: Pubkey;
}

export type ChainEvent = TradeEventRecord | CreateEventRecord | CompleteEventRecord;

/** Freshest known reserves for a mint the bot holds or has an order open on. */
export interface Mark {
  mint: Pubkey;
  slot: number;
  virtual_token_reserves: U64;
  virtual_quote_reserves: U64;
  real_token_reserves: U64;
  real_quote_reserves: U64;
}

export interface Position {
  mint: Pubkey;
  token_amount: U64;
  /** Lamports the still-held tokens cost, fees included. */
  cost_lamports: U64;
}

export interface Account {
  cash_lamports: U64;
  positions: Position[];
}

export type Side = 'buy' | 'sell';

export const REJECT_REASONS = [
  'max_slippage',
  'max_open_positions',
  'max_order_size',
  'max_orders_per_batch',
  'insufficient_cash',
  'insufficient_tokens',
  'not_in_universe',
  'token_complete',
  'zero_amount',
  'duplicate_client_id',
  'after_end',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/**
 * The fate of one order: filled, rejected (free) or failed (the tx fee
 * was paid, nothing traded). The harness also reports its own forced
 * closes as sell fills, under client ids `_complete_<n>`, `_flatten_<n>`
 * and `_writeoff_<n>`.
 */
export interface Fill {
  client_id: string;
  mint: Pubkey;
  side: Side;
  status: 'filled' | 'rejected' | 'failed';
  reason: RejectReason | null;
  decided_slot: number;
  slot: number;
  quote_lamports: U64;
  token_amount: U64;
  fee_lamports: U64;
  tx_fee_lamports: U64;
  fee_fallback: boolean;
}

export interface Batch {
  type: 'batch';
  seq: number;
  slot: number;
  events: ChainEvent[];
  marks: Mark[];
  fills: Fill[];
  account: Account;
}

export interface Done {
  type: 'done';
  seq: number;
  reason: 'end_of_data' | 'aborted';
  account: Account;
}

export type HarnessMessage = Hello | Batch | Done;

export interface BuyOrder {
  side: 'buy';
  client_id: string;
  mint: Pubkey;
  quote_lamports: U64;
  max_slippage_bps: number;
}

export interface SellOrder {
  side: 'sell';
  client_id: string;
  mint: Pubkey;
  token_amount: U64;
  max_slippage_bps: number;
}

export type Order = BuyOrder | SellOrder;

export interface Reply {
  type: 'reply';
  seq: number;
  orders: Order[];
}

// ------------------------------------------------------- what onBatch returns

/** An amount the shim accepts: bigint, canonical decimal string, or non-negative safe integer. */
export type Amount = bigint | string | number;

export interface BuyInput {
  side: 'buy';
  mint: Pubkey;
  quote_lamports: Amount;
  max_slippage_bps: number;
  /** Optional; 1-64 chars of [A-Za-z0-9_-], never starting with `_`. Assigned (o1, o2, ...) when omitted. */
  client_id?: string;
}

export interface SellInput {
  side: 'sell';
  mint: Pubkey;
  token_amount: Amount;
  max_slippage_bps: number;
  client_id?: string;
}

export type OrderInput = BuyInput | SellInput;

// ------------------------------------------------------------------ errors

/** The harness broke the protocol (bad line, wrong order, wrong protocol string). */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** The strategy returned something the harness would treat as a protocol violation. */
export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderError';
  }
}

// ------------------------------------------------------------------- state

/** One curve as last seen: reserves, how many trades printed, whether it completed. */
export interface Curve {
  readonly mint: Pubkey;
  /** CreateEvent slot; null when the mint was first met through a trade or a mark. */
  created_slot: number | null;
  virtual_token_reserves: bigint;
  virtual_quote_reserves: bigint;
  real_token_reserves: bigint;
  real_quote_reserves: bigint;
  /** Slot of the trade these reserves follow (the create slot until one prints). */
  reserves_slot: number;
  trades: number;
  complete: boolean;
}

/** One open position, in bigints, as the newest account snapshot reports it. */
export interface Holding {
  token_amount: bigint;
  cost_lamports: bigint;
}

/** An order on its way: sent, not yet answered by a fill. */
export interface PendingOrder {
  readonly order: Order;
  readonly seq: number;
  readonly decided_slot: number;
}

const U64_TEXT = /^(0|[1-9][0-9]{0,19})$/;
const PUBKEY_TEXT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Client ids: 1-64 of [A-Za-z0-9_-] and never a leading `_` (those are the harness's own closes). */
const CLIENT_ID_TEXT = /^[A-Za-z0-9-][A-Za-z0-9_-]{0,63}$/;

/**
 * The bot's whole view of the run, refreshed by runBot ahead of every
 * callback. It can also be driven by hand in a test:
 * `const s = new BotState(hello); s.applyBatch(batch); onBatch(s, batch)`.
 */
export class BotState {
  readonly hello: Hello;
  seq = -1;
  slot = -1;
  account: Account;
  /** Cash from the newest snapshot; pending orders are NOT deducted here (see freeCashLamports). */
  cash: bigint;
  readonly positions = new Map<Pubkey, Holding>();
  readonly curves = new Map<Pubkey, Curve>();
  readonly pending = new Map<string, PendingOrder>();
  #issued = new Set<string>();
  #counter = 1;

  constructor(hello: Hello) {
    this.hello = hello;
    this.account = { cash_lamports: hello.capital.lamports, positions: [] };
    this.cash = BigInt(hello.capital.lamports);
  }

  /** The next unused client id in this run: o1, o2, ... */
  clientId(): string {
    const id = this.#mintId(null);
    this.#issued.add(id);
    return id;
  }

  /** What every order costs to send at all: base fee plus priority fee. */
  txFeeLamports(): bigint {
    return BigInt(this.hello.fees.base_fee_lamports) + BigInt(this.hello.fees.priority_fee_lamports);
  }

  /** The most this reply's buys on one mint may spend in total; 0n for an unknown or completed mint. */
  maxBuyLamports(mint: Pubkey): bigint {
    const c = this.curves.get(mint);
    if (c === undefined || c.complete) return 0n;
    return (c.real_quote_reserves * BigInt(this.hello.caps.max_order_bps_of_real_reserve)) / BPS;
  }

  /** Held mints plus mints with a buy in flight: the count caps.max_open_positions is charged on. */
  committedPositionCount(): number {
    const mints = new Set<Pubkey>(this.positions.keys());
    for (const p of this.pending.values()) if (p.order.side === 'buy') mints.add(p.order.mint);
    return mints.size;
  }

  /** Cash less what pending orders would consume if they all filled (amounts and tx fees). */
  freeCashLamports(): bigint {
    const tx = this.txFeeLamports();
    let free = this.cash;
    for (const p of this.pending.values()) {
      free -= tx;
      if (p.order.side === 'buy') free -= BigInt(p.order.quote_lamports);
    }
    return free;
  }

  /** Absorb one batch: drop answered pendings, take the account, then marks, then events. */
  applyBatch(batch: Batch): void {
    this.seq = batch.seq;
    this.slot = batch.slot;
    for (const f of batch.fills) this.pending.delete(f.client_id);
    this.#takeAccount(batch.account);
    for (const m of batch.marks) {
      const known = this.curves.get(m.mint);
      if (known !== undefined && m.slot < known.reserves_slot) continue;
      const curve = known ?? this.#openCurve(m.mint, null, m.slot);
      curve.virtual_token_reserves = BigInt(m.virtual_token_reserves);
      curve.virtual_quote_reserves = BigInt(m.virtual_quote_reserves);
      curve.real_token_reserves = BigInt(m.real_token_reserves);
      curve.real_quote_reserves = BigInt(m.real_quote_reserves);
      curve.reserves_slot = m.slot;
    }
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        const curve = this.#openCurve(e.mint, e.slot, e.slot);
        curve.virtual_token_reserves = BigInt(e.virtual_token_reserves);
        curve.virtual_quote_reserves = BigInt(e.virtual_quote_reserves);
        curve.real_token_reserves = BigInt(e.real_token_reserves);
        curve.real_quote_reserves = 0n;
      } else if (e.event === 'TradeEvent') {
        const curve = this.curves.get(e.mint) ?? this.#openCurve(e.mint, null, e.slot);
        curve.virtual_token_reserves = BigInt(e.virtual_token_reserves);
        curve.virtual_quote_reserves = BigInt(e.virtual_quote_reserves);
        curve.real_token_reserves = BigInt(e.real_token_reserves);
        curve.real_quote_reserves = BigInt(e.real_quote_reserves);
        curve.reserves_slot = e.slot;
        curve.trades += 1;
      } else {
        const curve = this.curves.get(e.mint) ?? this.#openCurve(e.mint, null, e.slot);
        curve.complete = true;
      }
    }
  }

  /** Absorb the final account carried by `done`. */
  applyDone(done: Done): void {
    this.seq = done.seq;
    this.#takeAccount(done.account);
  }

  /**
   * Check a strategy's answer and turn it into wire orders, filling in
   * any missing client ids. Throws OrderError on anything the harness
   * would reject as a violation, including more orders than the cap.
   * Records nothing; recordOrders does that once the reply is written.
   */
  toOrders(result: unknown): Order[] {
    if (result === undefined || result === null) return [];
    if (!Array.isArray(result)) throw new OrderError(`batch ${this.seq}: onBatch must return an array of orders, got ${describe(result)}`);
    const cap = this.hello.caps.max_orders_per_batch;
    if (result.length > cap) {
      throw new OrderError(
        `batch ${this.seq}: onBatch returned ${result.length} orders, over hello.caps.max_orders_per_batch (${cap}); ` +
          `the harness rejects the orders past the cap and fails the run on a reply far over it, so send at most ${cap} per batch`,
      );
    }
    const checked = result.map((o: unknown, i: number) => checkOrder(o, `batch ${this.seq} order ${i}`));
    const reserved = new Set<string>();
    for (const o of checked) if (o.client_id !== undefined) reserved.add(o.client_id);
    return checked.map((o) => {
      const client_id = o.client_id ?? this.#mintId(reserved);
      reserved.add(client_id);
      return o.side === 'buy'
        ? { side: 'buy', client_id, mint: o.mint, quote_lamports: o.amount, max_slippage_bps: o.max_slippage_bps }
        : { side: 'sell', client_id, mint: o.mint, token_amount: o.amount, max_slippage_bps: o.max_slippage_bps };
    });
  }

  /** Mark orders as sent on the current batch; they stay pending until a fill names them. */
  recordOrders(orders: readonly Order[]): void {
    for (const order of orders) {
      this.#issued.add(order.client_id);
      this.pending.set(order.client_id, { order, seq: this.seq, decided_slot: this.slot });
    }
  }

  #mintId(reserved: Set<string> | null): string {
    for (;;) {
      const id = `o${this.#counter++}`;
      if (!this.#issued.has(id) && (reserved === null || !reserved.has(id))) return id;
    }
  }

  #openCurve(mint: Pubkey, created: number | null, slot: number): Curve {
    const curve: Curve = {
      mint,
      created_slot: created,
      virtual_token_reserves: 0n,
      virtual_quote_reserves: 0n,
      real_token_reserves: 0n,
      real_quote_reserves: 0n,
      reserves_slot: slot,
      trades: 0,
      complete: false,
    };
    this.curves.set(mint, curve);
    return curve;
  }

  #takeAccount(account: Account): void {
    this.account = account;
    this.cash = BigInt(account.cash_lamports);
    this.positions.clear();
    for (const p of account.positions) {
      const tokens = BigInt(p.token_amount);
      if (tokens > 0n) this.positions.set(p.mint, { token_amount: tokens, cost_lamports: BigInt(p.cost_lamports) });
    }
  }
}

interface CheckedOrder {
  side: Side;
  client_id: string | undefined;
  mint: Pubkey;
  amount: U64;
  max_slippage_bps: number;
}

const BUY_KEYS = new Set(['side', 'client_id', 'mint', 'quote_lamports', 'max_slippage_bps']);
const SELL_KEYS = new Set(['side', 'client_id', 'mint', 'token_amount', 'max_slippage_bps']);

function checkOrder(value: unknown, where: string): CheckedOrder {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new OrderError(`${where}: expected an order object, got ${describe(value)}`);
  const o = value as Record<string, unknown>;
  if (o.side !== 'buy' && o.side !== 'sell') throw new OrderError(`${where}: side must be "buy" or "sell", got ${describe(o.side)}`);
  const allowed = o.side === 'buy' ? BUY_KEYS : SELL_KEYS;
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) throw new OrderError(`${where}: unknown key "${k}" on a ${o.side} order`);
  }
  if (typeof o.mint !== 'string' || !PUBKEY_TEXT.test(o.mint)) throw new OrderError(`${where}: mint must be a base58 address, got ${describe(o.mint)}`);
  const amountKey = o.side === 'buy' ? 'quote_lamports' : 'token_amount';
  const amount = toU64(o[amountKey], `${where}: ${amountKey}`);
  const bps = o.max_slippage_bps;
  if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new OrderError(`${where}: max_slippage_bps must be an integer 0..10000, got ${describe(bps)}`);
  }
  let client_id: string | undefined;
  if (o.client_id !== undefined) {
    if (typeof o.client_id !== 'string' || !CLIENT_ID_TEXT.test(o.client_id)) {
      throw new OrderError(`${where}: client_id must be 1-64 of [A-Za-z0-9_-] not starting with _ (reserved for the harness's closes), got ${describe(o.client_id)}`);
    }
    client_id = o.client_id;
  }
  return { side: o.side, client_id, mint: o.mint, amount, max_slippage_bps: bps };
}

/** Normalize an amount to a canonical u64 decimal string; OrderError when it cannot be one. */
export function toU64(value: unknown, what = 'amount'): U64 {
  let n: bigint | null = null;
  if (typeof value === 'bigint') n = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) n = BigInt(value);
  else if (typeof value === 'string' && U64_TEXT.test(value)) n = BigInt(value);
  if (n === null || n < 0n || n > U64_MAX) {
    throw new OrderError(`${what} must be a u64 (bigint, decimal string or safe integer), got ${describe(value)}`);
  }
  return n.toString();
}

function describe(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value);
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
}

// -------------------------------------------------------------- the wire loop

/**
 * Turn a byte stream into lines: split on `\n`, drop a trailing `\r`,
 * decode as strict UTF-8. A line past maxBytes is a ProtocolError, and
 * a final line without its newline is still yielded.
 */
export async function* readLines(input: AsyncIterable<Uint8Array | string>, maxBytes = MAX_HARNESS_LINE_BYTES): AsyncGenerator<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pieces: Uint8Array[] = [];
  let size = 0;
  let lineNo = 0;
  const emit = (last: Uint8Array): string => {
    let bytes: Uint8Array = last;
    if (pieces.length > 0) {
      bytes = new Uint8Array(size);
      let at = 0;
      for (const p of [...pieces, last]) {
        bytes.set(p, at);
        at += p.byteLength;
      }
    }
    pieces = [];
    size = 0;
    lineNo++;
    if (bytes.byteLength > 0 && bytes[bytes.byteLength - 1] === 0x0d) bytes = bytes.subarray(0, bytes.byteLength - 1);
    try {
      return decoder.decode(bytes);
    } catch {
      throw new ProtocolError(`input line ${lineNo} is not valid UTF-8`);
    }
  };
  const overflow = (n: number) => new ProtocolError(`input line ${lineNo + 1} is over ${maxBytes} bytes (${n} so far)`);
  for await (const chunk of input) {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    let start = 0;
    for (;;) {
      const nl = bytes.indexOf(0x0a, start);
      if (nl === -1) break;
      const piece = bytes.subarray(start, nl);
      if (size + piece.byteLength > maxBytes) throw overflow(size + piece.byteLength);
      size += piece.byteLength;
      yield emit(piece);
      start = nl + 1;
    }
    if (start < bytes.byteLength) {
      const rest = new Uint8Array(bytes.subarray(start));
      size += rest.byteLength;
      if (size > maxBytes) throw overflow(size);
      pieces.push(rest);
    }
  }
  if (size > 0) yield emit(new Uint8Array(0));
}

/** A reply sink: process.stdout normally; a false return means wait for 'drain' when once() exists. */
export interface LineWriter {
  write(chunk: string): unknown;
  once?(event: 'drain', listener: () => void): unknown;
}

export interface BotIO {
  input?: AsyncIterable<Uint8Array | string>;
  output?: LineWriter;
}

export type OrdersResult = readonly OrderInput[] | void | null | undefined;

export interface Bot {
  /** Called once, after hello and before the first batch. */
  onHello?(state: BotState): void | Promise<void>;
  /** Called once per batch, after the state absorbed it: return the orders to send, or nothing. */
  onBatch(state: BotState, batch: Batch): OrdersResult | Promise<OrdersResult>;
  /** Called once with the flattened final account already applied; no reply follows. */
  onDone?(state: BotState, done: Done): void | Promise<void>;
}

export interface RunResult {
  state: BotState;
  done: Done;
  batches: number;
}

/**
 * Run the conversation until `done`, then resolve. Rejects with
 * ProtocolError, OrderError or whatever a callback threw; left
 * unhandled that ends the process at exit code 1, as the harness wants.
 */
export async function runBot(bot: Bot, io: BotIO = {}): Promise<RunResult> {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const encoder = new TextEncoder();
  let state: BotState | null = null;
  let batches = 0;
  let lineNo = 0;
  for await (const line of readLines(input)) {
    lineNo++;
    if (line.trim() === '') continue;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      throw new ProtocolError(`input line ${lineNo} is not JSON`);
    }
    const type = typeof msg === 'object' && msg !== null && !Array.isArray(msg) ? (msg as { type?: unknown }).type : undefined;
    if (type === 'hello') {
      const hello = msg as Hello;
      if (state !== null) throw new ProtocolError(`input line ${lineNo}: a second hello`);
      if (hello.protocol !== PROTOCOL) throw new ProtocolError(`the harness speaks ${describe(hello.protocol)}; this shim speaks ${PROTOCOL}`);
      state = new BotState(hello);
      await bot.onHello?.(state);
    } else if (type === 'batch') {
      const batch = msg as Batch;
      if (state === null) throw new ProtocolError(`input line ${lineNo}: a batch before hello`);
      checkBatch(batch, lineNo);
      state.applyBatch(batch);
      const orders = state.toOrders(await bot.onBatch(state, batch));
      const reply: Reply = { type: 'reply', seq: batch.seq, orders };
      const text = JSON.stringify(reply);
      const bytes = encoder.encode(text).byteLength;
      if (bytes > MAX_BOT_LINE_BYTES) {
        throw new OrderError(`batch ${batch.seq}: the reply is ${bytes} bytes (max ${MAX_BOT_LINE_BYTES}); send fewer orders (caps.max_orders_per_batch is ${state.hello.caps.max_orders_per_batch})`);
      }
      state.recordOrders(orders);
      await writeLine(output, `${text}\n`);
      batches++;
    } else if (type === 'done') {
      const done = msg as Done;
      if (state === null) throw new ProtocolError(`input line ${lineNo}: done before hello`);
      state.applyDone(done);
      await bot.onDone?.(state, done);
      return { state, done, batches };
    } else {
      throw new ProtocolError(`input line ${lineNo}: unknown message type ${describe(type)}`);
    }
  }
  throw new ProtocolError(state === null ? 'input ended before hello' : `input ended before done (after ${batches} batches)`);
}

function checkBatch(batch: Batch, lineNo: number): void {
  const ok =
    Number.isSafeInteger(batch.seq) &&
    Number.isSafeInteger(batch.slot) &&
    Array.isArray(batch.events) &&
    Array.isArray(batch.marks) &&
    Array.isArray(batch.fills) &&
    typeof batch.account === 'object' &&
    batch.account !== null &&
    Array.isArray(batch.account.positions);
  if (!ok) throw new ProtocolError(`input line ${lineNo}: malformed batch`);
}

function writeLine(output: LineWriter, text: string): Promise<void> | void {
  const ok = output.write(text);
  if (ok === false && typeof output.once === 'function') {
    const once = output.once.bind(output);
    return new Promise<void>((resolve) => {
      once('drain', resolve);
    });
  }
}
