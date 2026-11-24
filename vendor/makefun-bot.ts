// agent-fun/replay/v2 protocol shim, written for this entry.
//
// Wire shape: the harness sends one JSON line per message on stdin —
// a `hello`, one `batch` per slot, a closing `done` — and expects one
// `reply` line per batch on stdout. This module runs that conversation
// and keeps the run's bookkeeping (cash, positions, curves, orders in
// flight) so ../strategy.ts can stay a pure function of its inputs.
//
// Two harness rules shape everything below:
// - Determinism. An entry is executed twice and the action logs must
//   match byte for byte, so nothing here reads a clock, the
//   environment or Math.random.
// - No build step. The grader runs `node /bot/main.ts` directly, so
//   the TypeScript must be erasable: no enums, namespaces or parameter
//   properties anywhere in the entry.

export const PROTOCOL = 'agent-fun/replay/v2';
/** Longest line the harness may send, UTF-8 bytes excluding the newline. */
export const MAX_HARNESS_LINE_BYTES = 1_048_576;
/** Longest line the bot may send, UTF-8 bytes excluding the newline. */
export const MAX_BOT_LINE_BYTES = 65_536;
export const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
/** Denominator for every basis-point figure in the protocol. */
export const BPS = 10_000n;
export const U64_MAX = 18_446_744_073_709_551_615n;

// Amounts on the wire are decimal strings; parse them with BigInt.
export type U64 = string;
export type I64 = string;
export type Pubkey = string;

export interface Universe {
  program: typeof PUMP_PROGRAM_ID;
  quote: 'SOL';
  mayhem: 'excluded';
  exclude_cashback: true;
  sample: { hash: 'sha256'; modulus: number; residue: number };
}

export interface Caps {
  max_open_positions: number;
  max_order_bps_of_real_reserve: number;
  max_orders_per_batch: number;
  shorts: false;
  leverage: false;
}

export interface Fees {
  protocol_bps_fallback: number;
  creator_bps_fallback: number;
  base_fee_lamports: U64;
  priority_fee_lamports: U64;
  failed_tx_bps: number;
}

export interface Hello {
  type: 'hello';
  protocol: typeof PROTOCOL;
  seed: U64;
  universe: Universe;
  capital: { lamports: U64 };
  caps: Caps;
  latency_slots: number;
  fees: Fees;
}

// Event records, trimmed to the fields this entry reads. Reserves are
// post-trade; on SOL-quoted curves the *_quote_* pair is authoritative.
interface EventBase {
  slot: number;
  signature: string;
  block_time: number | null;
  chain_seq: number;
}

export interface TradeEventRecord extends EventBase {
  event: 'TradeEvent';
  mint: Pubkey;
  sol_amount: U64;
  token_amount: U64;
  is_buy: boolean;
  user: Pubkey;
  virtual_sol_reserves: U64;
  virtual_token_reserves: U64;
  real_sol_reserves: U64;
  real_token_reserves: U64;
  fee_basis_points: U64;
  creator: Pubkey;
  creator_fee_basis_points: U64;
  quote_mint: Pubkey;
  virtual_quote_reserves: U64;
  real_quote_reserves: U64;
}

export interface CreateEventRecord extends EventBase {
  event: 'CreateEvent';
  mint: Pubkey;
  bonding_curve: Pubkey;
  user: Pubkey;
  creator: Pubkey;
  virtual_token_reserves: U64;
  virtual_sol_reserves: U64;
  real_token_reserves: U64;
  quote_mint: Pubkey;
  virtual_quote_reserves: U64;
  is_mayhem_mode: boolean;
  is_cashback_enabled: boolean;
}

export interface CompleteEventRecord extends EventBase {
  event: 'CompleteEvent';
  user: Pubkey;
  mint: Pubkey;
  bonding_curve: Pubkey;
  quote_mint: Pubkey;
}

export type ChainEvent = TradeEventRecord | CreateEventRecord | CompleteEventRecord;

/** Latest reserves for a mint the bot holds or has an order open on. */
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
  cost_lamports: U64;
}

export interface Account {
  cash_lamports: U64;
  positions: Position[];
}

export type Side = 'buy' | 'sell';

export type RejectReason =
  | 'max_slippage'
  | 'max_open_positions'
  | 'max_order_size'
  | 'max_orders_per_batch'
  | 'insufficient_cash'
  | 'insufficient_tokens'
  | 'not_in_universe'
  | 'token_complete'
  | 'zero_amount'
  | 'duplicate_client_id'
  | 'after_end';

/**
 * How one order ended. `failed` still paid its tx fee. The harness's
 * own forced closes also arrive as sell fills, under the reserved ids
 * `_complete_<n>`, `_flatten_<n>` and `_writeoff_<n>`.
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

/** What a strategy may hand back per order: bigint, string or safe integer amounts. */
export type Amount = bigint | string | number;

export interface BuyInput {
  side: 'buy';
  mint: Pubkey;
  quote_lamports: Amount;
  max_slippage_bps: number;
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

/** The harness broke the protocol: bad line, wrong protocol, wrong order. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** The strategy produced an order the harness would call a violation. */
export class OrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderError';
  }
}

// ---------------------------------------------------------------- state

/** A curve's last known shape. */
export interface Curve {
  readonly mint: Pubkey;
  created_slot: number | null;
  virtual_token_reserves: bigint;
  virtual_quote_reserves: bigint;
  real_token_reserves: bigint;
  real_quote_reserves: bigint;
  reserves_slot: number;
  trades: number;
  complete: boolean;
}

/** An open position in bigints, exactly as the newest account states it. */
export interface Holding {
  token_amount: bigint;
  cost_lamports: bigint;
}

/** An order that has been sent and not yet answered by a fill. */
export interface PendingOrder {
  readonly order: Order;
  readonly seq: number;
  readonly decided_slot: number;
}

const U64_PATTERN = /^(0|[1-9][0-9]{0,19})$/;
const PUBKEY_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Ids are 1-64 chars of [A-Za-z0-9_-]; a leading underscore is reserved.
const CLIENT_ID_PATTERN = /^[A-Za-z0-9-][A-Za-z0-9_-]{0,63}$/;

/**
 * Everything the bot knows mid-run. runBot refreshes it before every
 * strategy call; tests can drive it directly the same way.
 */
export class BotState {
  readonly hello: Hello;
  seq = -1;
  slot = -1;
  account: Account;
  cash: bigint;
  readonly positions = new Map<Pubkey, Holding>();
  readonly curves = new Map<Pubkey, Curve>();
  readonly pending = new Map<string, PendingOrder>();
  #seenIds = new Set<string>();
  #idCounter = 1;

  constructor(hello: Hello) {
    this.hello = hello;
    this.account = { cash_lamports: hello.capital.lamports, positions: [] };
    this.cash = BigInt(hello.capital.lamports);
  }

  /** Per-order network cost: base fee plus priority fee, paid either way. */
  txFeeLamports(): bigint {
    return BigInt(this.hello.fees.base_fee_lamports) + BigInt(this.hello.fees.priority_fee_lamports);
  }

  /** Ceiling on what one reply's buys may spend on this mint; 0n if unknown or complete. */
  maxBuyLamports(mint: Pubkey): bigint {
    const curve = this.curves.get(mint);
    if (curve === undefined || curve.complete) return 0n;
    return (curve.real_quote_reserves * BigInt(this.hello.caps.max_order_bps_of_real_reserve)) / BPS;
  }

  /** Mints held plus mints with a buy in flight — the max_open_positions meter. */
  committedPositionCount(): number {
    const mints = new Set<Pubkey>(this.positions.keys());
    for (const p of this.pending.values()) if (p.order.side === 'buy') mints.add(p.order.mint);
    return mints.size;
  }

  /** Cash minus everything pending orders would consume if they all filled. */
  freeCashLamports(): bigint {
    const fee = this.txFeeLamports();
    let free = this.cash;
    for (const p of this.pending.values()) {
      free -= fee;
      if (p.order.side === 'buy') free -= BigInt(p.order.quote_lamports);
    }
    return free;
  }

  /** Fold a batch in: fills clear pendings, then account, marks and events land in that order. */
  applyBatch(batch: Batch): void {
    this.seq = batch.seq;
    this.slot = batch.slot;
    for (const f of batch.fills) this.pending.delete(f.client_id);
    this.#absorbAccount(batch.account);
    for (const m of batch.marks) {
      const known = this.curves.get(m.mint);
      if (known !== undefined && m.slot < known.reserves_slot) continue;
      const curve = known ?? this.#trackCurve(m.mint, null, m.slot);
      curve.virtual_token_reserves = BigInt(m.virtual_token_reserves);
      curve.virtual_quote_reserves = BigInt(m.virtual_quote_reserves);
      curve.real_token_reserves = BigInt(m.real_token_reserves);
      curve.real_quote_reserves = BigInt(m.real_quote_reserves);
      curve.reserves_slot = m.slot;
    }
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        const curve = this.#trackCurve(e.mint, e.slot, e.slot);
        curve.virtual_token_reserves = BigInt(e.virtual_token_reserves);
        curve.virtual_quote_reserves = BigInt(e.virtual_quote_reserves);
        curve.real_token_reserves = BigInt(e.real_token_reserves);
        curve.real_quote_reserves = 0n;
      } else if (e.event === 'TradeEvent') {
        const curve = this.curves.get(e.mint) ?? this.#trackCurve(e.mint, null, e.slot);
        curve.virtual_token_reserves = BigInt(e.virtual_token_reserves);
        curve.virtual_quote_reserves = BigInt(e.virtual_quote_reserves);
        curve.real_token_reserves = BigInt(e.real_token_reserves);
        curve.real_quote_reserves = BigInt(e.real_quote_reserves);
        curve.reserves_slot = e.slot;
        curve.trades += 1;
      } else {
        const curve = this.curves.get(e.mint) ?? this.#trackCurve(e.mint, null, e.slot);
        curve.complete = true;
      }
    }
  }

  /** Fold in the final account that `done` carries. */
  applyDone(done: Done): void {
    this.seq = done.seq;
    this.#absorbAccount(done.account);
  }

  /**
   * Validate a strategy's answer and normalize it into wire orders,
   * assigning o1, o2, ... ids where the strategy left them out. Throws
   * OrderError on anything invalid, including answering with more
   * orders than the per-batch cap. Nothing is recorded here.
   */
  toOrders(result: unknown): Order[] {
    if (result === undefined || result === null) return [];
    if (!Array.isArray(result)) throw new OrderError(`batch ${this.seq}: onBatch must return an array of orders, got ${describeValue(result)}`);
    const cap = this.hello.caps.max_orders_per_batch;
    if (result.length > cap) {
      throw new OrderError(
        `batch ${this.seq}: onBatch returned ${result.length} orders, over hello.caps.max_orders_per_batch (${cap}); ` +
          `the harness rejects the orders past the cap and fails the run on a reply far over it, so send at most ${cap} per batch`,
      );
    }
    const checked = result.map((o: unknown, i: number) => validateOrder(o, `batch ${this.seq} order ${i}`));
    const claimed = new Set<string>();
    for (const o of checked) if (o.client_id !== undefined) claimed.add(o.client_id);
    return checked.map((o) => {
      const client_id = o.client_id ?? this.#freshId(claimed);
      claimed.add(client_id);
      return o.side === 'buy'
        ? { side: 'buy', client_id, mint: o.mint, quote_lamports: o.amount, max_slippage_bps: o.max_slippage_bps }
        : { side: 'sell', client_id, mint: o.mint, token_amount: o.amount, max_slippage_bps: o.max_slippage_bps };
    });
  }

  /** Remember sent orders as pending; a fill naming their id clears them. */
  recordOrders(orders: readonly Order[]): void {
    for (const order of orders) {
      this.#seenIds.add(order.client_id);
      this.pending.set(order.client_id, { order, seq: this.seq, decided_slot: this.slot });
    }
  }

  #freshId(claimed: Set<string> | null): string {
    for (;;) {
      const id = `o${this.#idCounter++}`;
      if (!this.#seenIds.has(id) && (claimed === null || !claimed.has(id))) return id;
    }
  }

  #trackCurve(mint: Pubkey, created: number | null, slot: number): Curve {
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

  #absorbAccount(account: Account): void {
    this.account = account;
    this.cash = BigInt(account.cash_lamports);
    this.positions.clear();
    for (const p of account.positions) {
      const tokens = BigInt(p.token_amount);
      if (tokens > 0n) this.positions.set(p.mint, { token_amount: tokens, cost_lamports: BigInt(p.cost_lamports) });
    }
  }
}

interface ValidOrder {
  side: Side;
  client_id: string | undefined;
  mint: Pubkey;
  amount: U64;
  max_slippage_bps: number;
}

const BUY_FIELDS = new Set(['side', 'client_id', 'mint', 'quote_lamports', 'max_slippage_bps']);
const SELL_FIELDS = new Set(['side', 'client_id', 'mint', 'token_amount', 'max_slippage_bps']);

function validateOrder(value: unknown, where: string): ValidOrder {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new OrderError(`${where}: expected an order object, got ${describeValue(value)}`);
  const o = value as Record<string, unknown>;
  if (o.side !== 'buy' && o.side !== 'sell') throw new OrderError(`${where}: side must be "buy" or "sell", got ${describeValue(o.side)}`);
  const fields = o.side === 'buy' ? BUY_FIELDS : SELL_FIELDS;
  for (const k of Object.keys(o)) {
    if (!fields.has(k)) throw new OrderError(`${where}: unknown key "${k}" on a ${o.side} order`);
  }
  if (typeof o.mint !== 'string' || !PUBKEY_PATTERN.test(o.mint)) throw new OrderError(`${where}: mint must be a base58 address, got ${describeValue(o.mint)}`);
  const amountKey = o.side === 'buy' ? 'quote_lamports' : 'token_amount';
  const amount = toU64(o[amountKey], `${where}: ${amountKey}`);
  const bps = o.max_slippage_bps;
  if (typeof bps !== 'number' || !Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new OrderError(`${where}: max_slippage_bps must be an integer 0..10000, got ${describeValue(bps)}`);
  }
  let client_id: string | undefined;
  if (o.client_id !== undefined) {
    if (typeof o.client_id !== 'string' || !CLIENT_ID_PATTERN.test(o.client_id)) {
      throw new OrderError(`${where}: client_id must be 1-64 of [A-Za-z0-9_-] not starting with _ (reserved for the harness's closes), got ${describeValue(o.client_id)}`);
    }
    client_id = o.client_id;
  }
  return { side: o.side, client_id, mint: o.mint, amount, max_slippage_bps: bps };
}

/** Canonicalize an amount to a u64 decimal string, or throw OrderError. */
export function toU64(value: unknown, what = 'amount'): U64 {
  let n: bigint | null = null;
  if (typeof value === 'bigint') n = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) n = BigInt(value);
  else if (typeof value === 'string' && U64_PATTERN.test(value)) n = BigInt(value);
  if (n === null || n < 0n || n > U64_MAX) {
    throw new OrderError(`${what} must be a u64 (bigint, decimal string or safe integer), got ${describeValue(value)}`);
  }
  return n.toString();
}

function describeValue(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 77)}...` : value);
  if (value === null || typeof value !== 'object') return String(value);
  return Array.isArray(value) ? 'an array' : 'an object';
}

// ------------------------------------------------------------- line pump

/**
 * Split an incoming byte stream into decoded lines. Handles chunks
 * that split anywhere, tolerates a trailing carriage return, enforces
 * the per-line byte cap, and yields a final unterminated line.
 */
export async function* readLines(input: AsyncIterable<Uint8Array | string>, maxBytes = MAX_HARNESS_LINE_BYTES): AsyncGenerator<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let held: Uint8Array[] = [];
  let heldBytes = 0;
  let lineNo = 0;
  const finish = (tail: Uint8Array): string => {
    let bytes: Uint8Array = tail;
    if (held.length > 0) {
      bytes = new Uint8Array(heldBytes);
      let at = 0;
      for (const part of [...held, tail]) {
        bytes.set(part, at);
        at += part.byteLength;
      }
    }
    held = [];
    heldBytes = 0;
    lineNo++;
    if (bytes.byteLength > 0 && bytes[bytes.byteLength - 1] === 0x0d) bytes = bytes.subarray(0, bytes.byteLength - 1);
    try {
      return decoder.decode(bytes);
    } catch {
      throw new ProtocolError(`input line ${lineNo} is not valid UTF-8`);
    }
  };
  const tooLong = (n: number) => new ProtocolError(`input line ${lineNo + 1} is over ${maxBytes} bytes (${n} so far)`);
  for await (const chunk of input) {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    let start = 0;
    for (;;) {
      const nl = bytes.indexOf(0x0a, start);
      if (nl === -1) break;
      const piece = bytes.subarray(start, nl);
      if (heldBytes + piece.byteLength > maxBytes) throw tooLong(heldBytes + piece.byteLength);
      heldBytes += piece.byteLength;
      yield finish(piece);
      start = nl + 1;
    }
    if (start < bytes.byteLength) {
      const rest = new Uint8Array(bytes.subarray(start));
      heldBytes += rest.byteLength;
      if (heldBytes > maxBytes) throw tooLong(heldBytes);
      held.push(rest);
    }
  }
  if (heldBytes > 0) yield finish(new Uint8Array(0));
}

/** Where replies are written; a false write() waits for 'drain' when the sink offers once(). */
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
  onHello?(state: BotState): void | Promise<void>;
  onBatch(state: BotState, batch: Batch): OrdersResult | Promise<OrdersResult>;
  onDone?(state: BotState, done: Done): void | Promise<void>;
}

export interface RunResult {
  state: BotState;
  done: Done;
  batches: number;
}

/**
 * Speak the protocol on stdin/stdout until `done` arrives, then
 * resolve with the final state. Any ProtocolError, OrderError or
 * strategy exception rejects the promise; unhandled, the process
 * exits non-zero, which is how the harness wants a broken bot to end.
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
      if (hello.protocol !== PROTOCOL) throw new ProtocolError(`the harness speaks ${describeValue(hello.protocol)}; this shim speaks ${PROTOCOL}`);
      state = new BotState(hello);
      await bot.onHello?.(state);
    } else if (type === 'batch') {
      const batch = msg as Batch;
      if (state === null) throw new ProtocolError(`input line ${lineNo}: a batch before hello`);
      assertBatchShape(batch, lineNo);
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
      throw new ProtocolError(`input line ${lineNo}: unknown message type ${describeValue(type)}`);
    }
  }
  throw new ProtocolError(state === null ? 'input ended before hello' : `input ended before done (after ${batches} batches)`);
}

function assertBatchShape(batch: Batch, lineNo: number): void {
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
