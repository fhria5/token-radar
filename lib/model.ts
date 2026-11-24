// Token Radar's value model: one snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never
// a ceiling) and adds pre-token protocols below the floor, by TVL, as the
// early radar. A protocol is pre-token when its record carries no token:
// no market cap, no CoinGecko id, no symbol. Token-trading protocols are
// kept apart in the Live view and shown at the market's own value, never
// mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, through four
// named functions the dashboard quotes and recomputes:
//
//   comparableRatio(category)  the mcap/TVL ratio a token like this one
//     would carry: the median mcap/TVL of the tokenized protocols in the
//     same category, shrunk toward the global median when the category has
//     few comparables, clamped so no category escapes the market's range.
//   growthMultiplier(change_7d)  a damped log response to seven-day TVL
//     growth: a hot week lifts the value, but the log cap means one hot
//     week can never dominate the ranking.
//   ageMultiplier(age_days)  pent-up value: the longer a protocol has run
//     with no token on record, the more value its launch would unlock,
//     rising with an exponential approach to a cap, never unbounded.
//   chainMultiplier(chains)  breadth: a protocol live on more chains
//     reaches more users, worth a small premium per extra chain.
//
//   implied_value_usd = round(tvl_usd x ratio x growth x age x chains)
//
// No protocol name is ever special-cased: the same four functions score
// every row, and the comparables table is computed from the snapshot at
// runtime, so the model is the snapshot's own market speaking.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard. */
export interface ModelConstants {
  shrink_weight: number;
  ratio_floor: number;
  ratio_cap: number;
  growth_scale: number;
  growth_cap_pct: number;
  growth_floor_pct: number;
  growth_strength: number;
  age_base: number;
  age_strength: number;
  age_halflife_days: number;
  age_cap: number;
  unknown_age_multiplier: number;
  chain_step: number;
  chain_max_steps: number;
  no_category_penalty: number;
}

export const MODEL: ModelConstants = {
  shrink_weight: 8,
  ratio_floor: 0.02,
  ratio_cap: 2.5,
  growth_scale: 25,
  growth_cap_pct: 200,
  growth_floor_pct: -60,
  growth_strength: 0.45,
  age_base: 0.75,
  age_strength: 0.45,
  age_halflife_days: 730,
  age_cap: 1.2,
  unknown_age_multiplier: 0.9,
  chain_step: 0.03,
  chain_max_steps: 4,
  no_category_penalty: 0.96,
};

export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 200;

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One comparables row: a category's tokenized protocols and their median ratio. */
export interface ComparableRow {
  category: string;
  n: number;
  median_ratio: number;
  ratio_used: number;
}

/** The comparables table the model computed from this snapshot. */
export interface Comparables {
  global_median_ratio: number;
  tokenized_count: number;
  categories: ComparableRow[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    ratio_used: number;
    category_comparables: number;
    category_median_ratio: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    chain_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  ratio_used: number;
  category_comparables: number;
  category_median_ratio: number;
  growth_multiplier: number;
  age_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the comparables, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  comparables: Comparables;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted list of numbers; the middle value, or the mean of the middle two. */
export function medianOf(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The comparables table: every tokenized protocol's mcap/TVL, grouped by
 * category. The global median anchors categories with too few tokenized
 * peers to speak for themselves.
 */
export function buildComparables(snapshot: Snapshot, model: ModelConstants = MODEL): Comparables {
  // A comparable needs a real market cap: a recorded mcap of zero is no
  // market at all, so it never enters a category's median.
  const tokenized = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const allRatios = tokenized.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const global = medianOf(allRatios);
  const byCategory = new Map<string, number[]>();
  for (const p of tokenized) {
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }
  const categories: ComparableRow[] = [...byCategory.entries()]
    .map(([category, ratios]) => {
      ratios.sort((a, b) => a - b);
      const med = medianOf(ratios);
      return { category, n: ratios.length, median_ratio: round4(med), ratio_used: round4(comparableRatioFor(category, med, ratios.length, global, model)) };
    })
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global_median_ratio: round4(global), tokenized_count: tokenized.length, categories };
}

/**
 * comparableRatio: the mcap/TVL ratio a protocol of this category would
 * carry. A category with many tokenized peers speaks for itself; a thin
 * category is shrunk toward the global median (weight `shrink_weight`
 * pseudo-observations at the global median); a category with no peers at
 * all takes the global median. Clamped to the market's own range.
 */
export function comparableRatioFor(category: string | null, categoryMedian: number, n: number, globalMedian: number, model: ModelConstants = MODEL): number {
  if (category === null || n === 0) return clampRatio(globalMedian, model);
  const shrunk = (n * categoryMedian + model.shrink_weight * globalMedian) / (n + model.shrink_weight);
  return clampRatio(shrunk, model);
}

function clampRatio(ratio: number, model: ModelConstants): number {
  return Math.min(model.ratio_cap, Math.max(model.ratio_floor, ratio));
}

/**
 * growthMultiplier: the damped response to seven-day TVL growth. The
 * change is clamped, then passed through log1p so a 200% week lifts the
 * value by at most `growth_strength` and a hot week can never dominate:
 * growth of 25% earns about half the maximum lift, 200% earns all of it.
 */
export function growthMultiplier(change7d: number | null, model: ModelConstants = MODEL): number {
  const g = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, finite(change7d, 0)));
  const span = Math.log1p(model.growth_cap_pct / model.growth_scale);
  const damped = (Math.sign(g) * Math.log1p(Math.abs(g) / model.growth_scale)) / span;
  return 1 + model.growth_strength * damped;
}

/**
 * ageMultiplier: pent-up value from time listed with no token on record.
 * Rises from `age_base` toward `age_base + age_strength` with an
 * exponential approach (half-life `age_halflife_days`), capped at
 * `age_cap`. An unknown listing date takes the neutral
 * `unknown_age_multiplier`.
 */
export function ageMultiplier(ageDays: number | null, model: ModelConstants = MODEL): number {
  if (ageDays === null) return model.unknown_age_multiplier;
  const approached = model.age_base + model.age_strength * (1 - Math.exp(-Math.max(ageDays, 0) / model.age_halflife_days));
  return Math.min(model.age_cap, approached);
}

/**
 * chainMultiplier: breadth premium, `chain_step` per extra chain up to
 * `chain_max_steps` steps, times a small penalty when the snapshot names
 * no category at all (an unclassified protocol is harder to price).
 */
export function chainMultiplier(chains: string[], category: string | null, model: ModelConstants = MODEL): number {
  const extra = Math.min(Math.max(chains.length - 1, 0), model.chain_max_steps);
  const breadth = 1 + model.chain_step * extra;
  return category === null ? breadth * model.no_category_penalty : breadth;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comparables: Comparables,
  model: ModelConstants = MODEL,
): { implied: number; ratio: number; categoryN: number; categoryMedian: number; growthPct: number; growthMult: number; ageMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const cat = protocol.category === null ? null : comparables.categories.find((c) => c.category === protocol.category);
  const categoryMedian = cat === undefined || cat === null ? comparables.global_median_ratio : cat.median_ratio;
  const categoryN = cat === undefined || cat === null ? 0 : cat.n;
  const ratio = comparableRatioFor(protocol.category, categoryMedian, categoryN, comparables.global_median_ratio, model);
  const growthPct = Math.min(model.growth_cap_pct, Math.max(model.growth_floor_pct, finite(protocol.change_7d, 0)));
  const growthMult = growthMultiplier(protocol.change_7d, model);
  const ageMult = ageMultiplier(age, model);
  const chainMult = chainMultiplier(protocol.chains, protocol.category, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * ratio * growthMult * ageMult * chainMult));
  return { implied, ratio, categoryN, categoryMedian, growthPct, growthMult, ageMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const comparables = buildComparables(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a replacement
  // for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, comparables, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      ratio_used: round4(s.v.ratio),
      category_comparables: s.v.categoryN,
      category_median_ratio: round4(s.v.categoryMedian),
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      age_multiplier: round4(s.v.ageMult),
      chain_multiplier: round4(s.v.chainMult),
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain when the protocol spans one, else the first again. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the lending position open.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and let it auto-compound.`;
  if (c.includes('liquid restaking') || c.includes('restak')) return `Restake $${capital} of liquid-staked ETH through ${name} on ${chain} and hold the receipt token.`;
  if (c.includes('liquid staking')) return `Stake $${capital} of ETH through ${name} on ${chain} and hold the liquid staking receipt.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name} on ${chain}.`;
  if (c.includes('onchain capital allocator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it for the full term.`;
  if (c.includes('basis trading')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and hold the shares.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('nft')) return `List or buy one item worth about $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('gaming')) return `Deposit $${capital} of the game's asset into ${name} on ${chain} and play one full session.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, chain-specific qualifying action for protocols that span two chains. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${Math.round(capital / 2)} of USDC back through ${name} to ${chain} so both directions are on record.`;
  if (c.includes('dex') || c.includes('yield')) return `Swap $${Math.round(capital / 2)} of USDC for the pool's other asset on ${name} on ${chain} and add it to the pool.`;
  if (c.includes('lend') || c.includes('cdp')) return `Borrow $${Math.round(capital / 4)} of USDC against your ${name} position on ${chain} and repay it within a week.`;
  return `Repeat the main position with $${Math.round(capital / 2)} of USDC on ${name} on ${chain} so a second chain shows activity.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains,
 * TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with ${p.name}, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
  ];
  if (second !== null) {
    steps.push({
      text: secondActionFor(p, capital, second),
      cost: `about $${Math.round(capital / 2)} of capital and $2 of gas`,
      time: '10 minutes',
    });
  } else {
    steps.push({
      text: `Make one qualifying action on ${nameOf(p)} this week, such as a deposit, a borrow, a swap or a vote on ${chain}.`,
      cost: 'about $2 of gas',
      time: '10 minutes a week',
    });
  }
  steps.push(
    {
      text: `Do one qualifying action each week on ${p.name}, such as a deposit, a borrow, a swap or a vote on ${chain}.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  );
  return steps;
}

function nameOf(p: SnapshotProtocol): string {
  return p.name;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    ratio_used: row.model.ratio_used,
    category_comparables: row.model.category_comparables,
    category_median_ratio: row.model.category_median_ratio,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comparables = buildComparables(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    comparables,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
