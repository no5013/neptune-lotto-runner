#!/usr/bin/env tsx
/**
 * Verify lottery results comply with all rules.
 *
 * Usage:
 *   npx tsx scripts/verify.ts                          # latest run
 *   npx tsx scripts/verify.ts --run run_20260704_xxx   # specific run
 */

import fs from "fs";
import path from "path";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT       = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(ROOT, "output");
const INPUT_DIR  = path.join(ROOT, "input");

// ── Types ──────────────────────────────────────────────────────────────────
interface ItemConfig { capacity: number; price: number; }
interface PickupPeriod { label: string; time: string; capacity: number; }
interface ItemResult { item: string; rank: number; }
interface Person {
  email: string; name: string; lineId: string;
  items: ItemResult[];
  queueNumber: number | null;
  pickupPeriod: { label: string; time: string } | null;
}
interface ResultsJson {
  seed: number;
  prices: Record<string, number>;
  pickupPeriods: { label: string; time: string }[];
  results: Person[];
  disqualified: { email: string }[];
}
interface EventConfig {
  max_wins_per_person: number;
  total_winners: number;
  pickup_periods: PickupPeriod[];
}

// ── Helpers ────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function pass(msg: string) {
  console.log(`  ✅  ${msg}`);
  passed++;
}

function fail(msg: string, details?: string[]) {
  console.log(`  ❌  ${msg}`);
  if (details?.length) details.forEach(d => console.log(`       ${d}`));
  failed++;
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 50 - title.length))}`);
}

function latestRunDir(): string {
  const runs = fs.readdirSync(OUTPUT_DIR).filter(d => d.startsWith("run_")).sort();
  if (!runs.length) throw new Error("No runs found in output/");
  return path.join(OUTPUT_DIR, runs[runs.length - 1]);
}

// ── Entry ──────────────────────────────────────────────────────────────────
const argv    = process.argv.slice(2);
const runArg  = argv.find(a => a.startsWith("--run="))?.slice(6)
              ?? (argv.indexOf("--run") !== -1 ? argv[argv.indexOf("--run") + 1] : undefined);
const runDir  = runArg ? path.join(OUTPUT_DIR, runArg) : latestRunDir();
const runName = path.basename(runDir);

console.log(`\nVerifying: ${runName}`);

const results: ResultsJson  = JSON.parse(fs.readFileSync(path.join(runDir, "results.json"), "utf-8"));
const config: EventConfig   = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, "event_config.json"), "utf-8"));
const itemsRaw: Record<string, number | ItemConfig> = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, "items.json"), "utf-8"));

const capacities: Record<string, number> = {};
const catalogPrices: Record<string, number> = {};
for (const [item, val] of Object.entries(itemsRaw)) {
  if (typeof val === "object") { capacities[item] = val.capacity; catalogPrices[item] = val.price; }
  else capacities[item] = val;
}

const winners  = results.results.filter(p => p.items.length > 0);
const everyone = results.results;
const dqEmails = new Set(results.disqualified.map(p => p.email));

// ── 1. Winner count ────────────────────────────────────────────────────────
section("Winner count");

const actualWinners = winners.length;
if (actualWinners <= config.total_winners) {
  pass(`Unique winners ${actualWinners} ≤ cap ${config.total_winners}`);
} else {
  fail(`Unique winners ${actualWinners} exceeds cap ${config.total_winners}`);
}

// ── 2. Max wins per person ─────────────────────────────────────────────────
section("Max wins per person");

const overLimit = winners.filter(p => p.items.length > config.max_wins_per_person);
if (!overLimit.length) {
  pass(`All winners have ≤ ${config.max_wins_per_person} items`);
} else {
  fail(`${overLimit.length} people exceeded max wins`, overLimit.map(p => `${p.email} → ${p.items.length} items`));
}

// ── 3. Item capacities ─────────────────────────────────────────────────────
section("Item capacities");

const countByItem: Record<string, number> = {};
for (const p of winners) for (const r of p.items) countByItem[r.item] = (countByItem[r.item] ?? 0) + 1;

const overCap = Object.entries(countByItem).filter(([item, count]) => count > (capacities[item] ?? Infinity));
if (!overCap.length) {
  pass("No item exceeds its capacity");
} else {
  fail(`${overCap.length} item(s) over capacity`, overCap.map(([i, c]) => `${i}: ${c} / ${capacities[i]}`));
}

const unknownItems = Object.keys(countByItem).filter(i => !(i in capacities));
if (!unknownItems.length) {
  pass("All assigned items exist in items.json");
} else {
  fail(`${unknownItems.length} item(s) not in items.json`, unknownItems);
}

// ── 4. No duplicate items per person ──────────────────────────────────────
section("No duplicate items per person");

const dupItems = winners.filter(p => new Set(p.items.map(r => r.item)).size !== p.items.length);
if (!dupItems.length) {
  pass("No person has the same item twice");
} else {
  fail(`${dupItems.length} person(s) have duplicate items`, dupItems.map(p => p.email));
}

// ── 5. Disqualified not in winners ────────────────────────────────────────
section("Disqualified people");

const dqWinners = winners.filter(p => dqEmails.has(p.email));
if (!dqWinners.length) {
  pass("No disqualified person appears as a winner");
} else {
  fail(`${dqWinners.length} disqualified person(s) are in winners`, dqWinners.map(p => p.email));
}

// ── 6. Queue numbers ───────────────────────────────────────────────────────
section("Queue numbers");

const queueNums = winners.map(p => p.queueNumber).filter((n): n is number => n !== null);
const missingQueue = winners.filter(p => p.queueNumber === null);
if (!missingQueue.length) {
  pass("All winners have a queue number");
} else {
  fail(`${missingQueue.length} winner(s) missing queue number`, missingQueue.map(p => p.email));
}

const uniqueQueues = new Set(queueNums);
if (uniqueQueues.size === queueNums.length) {
  pass("All queue numbers are unique");
} else {
  fail("Duplicate queue numbers found");
}

const expectedRange = Array.from({ length: winners.length }, (_, i) => i + 1);
const actualSorted  = [...queueNums].sort((a, b) => a - b);
const rangeOk = expectedRange.every((n, i) => n === actualSorted[i]);
if (rangeOk) {
  pass(`Queue numbers form a contiguous range 1–${winners.length}`);
} else {
  fail(`Queue numbers are not contiguous 1–${winners.length}`);
}

// ── 7. Pickup period distribution ─────────────────────────────────────────
section("Pickup period distribution");

const periodTotalCap = config.pickup_periods.reduce((s, p) => s + p.capacity, 0);
if (periodTotalCap >= actualWinners) {
  pass(`Period total capacity ${periodTotalCap} covers ${actualWinners} winners`);
} else {
  fail(`Period total capacity ${periodTotalCap} < ${actualWinners} winners`);
}

const countByPeriod: Record<string, number> = {};
for (const p of winners) {
  const label = p.pickupPeriod?.label ?? "none";
  countByPeriod[label] = (countByPeriod[label] ?? 0) + 1;
}
const overPeriod = config.pickup_periods.filter(p => (countByPeriod[p.label] ?? 0) > p.capacity);
if (!overPeriod.length) {
  pass("No period exceeds its capacity");
} else {
  fail(`${overPeriod.length} period(s) over capacity`,
    overPeriod.map(p => `${p.label}: ${countByPeriod[p.label]} / ${p.capacity}`));
}

// ── 8. Prices ─────────────────────────────────────────────────────────────
section("Prices");

const missingPrices = Object.keys(countByItem).filter(i => !(i in results.prices));
if (!missingPrices.length) {
  pass("All assigned items have a price in results.json");
} else {
  fail(`${missingPrices.length} item(s) missing price`, missingPrices);
}

const zeroPrices = Object.entries(results.prices).filter(([, v]) => v === 0).map(([k]) => k);
if (!zeroPrices.length) {
  pass("No items have a zero price");
} else {
  fail(`${zeroPrices.length} item(s) have price = 0 (may need updating)`, zeroPrices);
}

// ── 9. Non-winners have no queue ──────────────────────────────────────────
section("Non-winners");

const nonWinners = everyone.filter(p => p.items.length === 0);
const nonWinnersWithQueue = nonWinners.filter(p => p.queueNumber !== null);
if (!nonWinnersWithQueue.length) {
  pass("Non-winners correctly have no queue number");
} else {
  fail(`${nonWinnersWithQueue.length} non-winner(s) have a queue number`, nonWinnersWithQueue.map(p => p.email));
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(52)}`);
const total = passed + failed;
if (failed === 0) {
  console.log(`✅  All ${total} checks passed.\n`);
} else {
  console.log(`❌  ${failed} / ${total} checks failed.\n`);
  process.exit(1);
}
