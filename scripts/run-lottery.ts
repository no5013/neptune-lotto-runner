#!/usr/bin/env tsx
/**
 * Neptune Lottery Runner (TypeScript port of run_lottery.py)
 *
 * Usage:
 *   npm run lottery
 *   npm run lottery -- --seed 12345
 *   npm run lottery -- --max-wins 2 --total-winners 60
 */

import fs from "fs";
import path from "path";
import Papa from "papaparse";

// ── Paths ──────────────────────────────────────────────────────────────────
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT       = path.resolve(SCRIPT_DIR, "..");
const INPUT_DIR  = path.join(ROOT, "input");
const OUTPUT_DIR = path.join(ROOT, "output");

// ── Constants ──────────────────────────────────────────────────────────────
const RANKING_PREFIX = "Ranking:";
const EMAIL_COL      = "Email Address";
const NAME_COL       = "ชื่อ (สามารถใช้ชื่ออะไรก็ได้)";
const LINE_COL       = "LINE ID (ลงทะเบียนได้เพียง 1 ครั้งต่อคนเท่านั้น)";
const CHEAT_COL      = "CHEAT";
const ITEM_REGEX     = /\[([^\]]+)\]/;
const RANK_REGEX     = /Rank\s*(\d+)/i;

// ── Types ──────────────────────────────────────────────────────────────────
interface ItemConfig { capacity: number; price: number; }
interface PickupPeriod { label: string; time: string; capacity: number; }
interface EventConfig {
  max_wins_per_person: number;
  total_winners: number | null;
  pickup_periods: PickupPeriod[];
}
interface QueueAssignment { queueNumber: number; pickupPeriod: { label: string; time: string } | null; }
interface WinnerRecord {
  email: string; name: string; lineId: string;
  items: { item: string; rank: number }[];
  queueNumber: number | null;
  pickupPeriod: { label: string; time: string } | null;
}
interface DisqualifiedRecord { email: string; name: string; lineId: string; disqualifiedReason: string; }

// ── Seeded RNG (Mulberry32) ────────────────────────────────────────────────
function makeRng(seed: number) {
  let s = seed >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function extractItemName(col: string): string {
  const m = ITEM_REGEX.exec(col);
  return m ? m[1].trim() : col.trim();
}

function parseRank(val: string): number | null {
  if (!val) return null;
  const m = RANK_REGEX.exec(val);
  return m ? parseInt(m[1], 10) : null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    input:        get("--input")         ?? path.join(INPUT_DIR, "form-submissions.csv"),
    itemsFile:    get("--items-file")    ?? path.join(INPUT_DIR, "items.json"),
    configFile:   get("--config-file")   ?? path.join(INPUT_DIR, "event_config.json"),
    blacklistFile: get("--blacklist-file") ?? path.join(INPUT_DIR, "blacklist.json"),
    outputDir:    get("--output-dir")    ?? null,
    defaultCap:   parseInt(get("--capacity") ?? "20", 10),
    maxWins:      get("--max-wins")      ? parseInt(get("--max-wins")!, 10) : null,
    totalWinners: get("--total-winners") ? parseInt(get("--total-winners")!, 10) : null,
    seed:         get("--seed")          ? parseInt(get("--seed")!, 10) : null,
  };
}

function loadConfig(configFile: string): EventConfig {
  const defaults: EventConfig = { max_wins_per_person: 2, total_winners: null, pickup_periods: [] };
  if (!fs.existsSync(configFile)) return defaults;
  return { ...defaults, ...JSON.parse(fs.readFileSync(configFile, "utf-8")) };
}

function loadBlacklist(blacklistFile: string): Set<string> {
  if (!fs.existsSync(blacklistFile)) return new Set();
  const entries: { lineId: string }[] = JSON.parse(fs.readFileSync(blacklistFile, "utf-8"));
  return new Set(entries.map(e => e.lineId.toLowerCase().replace(/^@/, "")));
}

function loadItems(itemsFile: string, itemNames: string[], defaultCap: number) {
  const capacities: Record<string, number> = {};
  const prices: Record<string, number>     = {};
  for (const n of itemNames) capacities[n] = defaultCap;

  if (!fs.existsSync(itemsFile)) return { capacities, prices };
  const raw: Record<string, number | ItemConfig> = JSON.parse(fs.readFileSync(itemsFile, "utf-8"));
  for (const [item, val] of Object.entries(raw)) {
    if (typeof val === "object") {
      if (item in capacities) capacities[item] = val.capacity;
      prices[item] = val.price;
    } else {
      if (item in capacities) capacities[item] = val;
    }
  }
  return { capacities, prices };
}

function assignQueue(winnerEmails: string[], periods: PickupPeriod[], rng: () => number): Record<string, QueueAssignment> {
  const shuffled = shuffle(winnerEmails, rng);
  const periodMap: PickupPeriod[] = [];
  for (const p of periods) for (let i = 0; i < p.capacity; i++) periodMap.push(p);

  const result: Record<string, QueueAssignment> = {};
  shuffled.forEach((email, i) => {
    const p = periodMap[i] ?? null;
    result[email] = {
      queueNumber: i + 1,
      pickupPeriod: p ? { label: p.label, time: p.time } : null,
    };
  });
  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
  const args   = parseArgs();
  const config = loadConfig(args.configFile);

  const maxWins      = args.maxWins      ?? config.max_wins_per_person;
  const totalWinners = args.totalWinners ?? config.total_winners;
  const periods      = config.pickup_periods;

  const seed = args.seed ?? Date.now();
  const rng  = makeRng(seed);

  const now    = new Date();
  const pad    = (n: number) => String(n).padStart(2, "0");
  const runTs  = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const outDir = args.outputDir ?? path.join(OUTPUT_DIR, `run_${runTs}`);
  fs.mkdirSync(outDir, { recursive: true });

  // ── Parse CSV ─────────────────────────────────────────────────────────────
  const csvText = fs.readFileSync(args.input, "utf-8");
  const { data: rows, meta } = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  const allColumns     = (meta.fields ?? []) as string[];
  const rankingColumns = allColumns.filter(c => c.startsWith(RANKING_PREFIX));
  if (!rankingColumns.length) throw new Error("No ranking columns found in CSV.");

  const itemByColumn: Record<string, string> = {};
  for (const col of rankingColumns) itemByColumn[col] = extractItemName(col);
  const itemNames = rankingColumns.map(c => itemByColumn[c]);

  const { capacities, prices } = loadItems(args.itemsFile, itemNames, args.defaultCap);
  const blacklistedLineIds = loadBlacklist(args.blacklistFile);

  type Req = [email: string, item: string, rank: number];
  const requestsByRank = new Map<number, Req[]>();
  const allEligibleRequests: Req[] = [];
  let skippedCheat = 0;
  let skippedDupRank = 0;
  let skippedDupLineId = 0;
  let skippedBlacklist = 0;
  const eligibleEmails = new Set<string>();
  const profileByEmail = new Map<string, [name: string, lineId: string]>();
  const disqualified: DisqualifiedRecord[] = [];

  const seenLineIds = new Set<string>();

  for (const row of rows) {
    const email = (row[EMAIL_COL] ?? "").trim();
    if (!email) continue;

    const cheat  = (row[CHEAT_COL] ?? "").trim().toLowerCase();
    const name   = (row[NAME_COL]  ?? "").trim();
    const lineId = (row[LINE_COL]  ?? "").trim();

    if (cheat === "yes") {
      skippedCheat++;
      disqualified.push({ email, name, lineId, disqualifiedReason: "cheat_flag" });
      continue;
    }

    const lineIdKey = lineId.toLowerCase().replace(/^@/, "");

    if (lineId && blacklistedLineIds.has(lineIdKey)) {
      skippedBlacklist++;
      continue;
    }
    if (lineId && seenLineIds.has(lineIdKey)) {
      skippedDupLineId++;
      disqualified.push({ email, name, lineId, disqualifiedReason: "duplicate_line_id" });
      continue;
    }
    if (lineId) seenLineIds.add(lineIdKey);

    const rowReqs: Req[] = [];
    const rowRanks: number[] = [];
    for (const col of rankingColumns) {
      const rank = parseRank((row[col] ?? "").trim());
      if (rank === null) continue;
      rowReqs.push([email, itemByColumn[col], rank]);
      rowRanks.push(rank);
    }
    if (!rowReqs.length) continue;

    if (new Set(rowRanks).size !== rowRanks.length) {
      skippedDupRank++;
      disqualified.push({ email, name, lineId, disqualifiedReason: "duplicate_rank" });
      continue;
    }

    eligibleEmails.add(email);
    profileByEmail.set(email, [name, lineId]);
    for (const req of rowReqs) {
      const bucket = requestsByRank.get(req[2]) ?? [];
      bucket.push(req);
      requestsByRank.set(req[2], bucket);
      allEligibleRequests.push(req);
    }
  }

  // ── Allocation ────────────────────────────────────────────────────────────
  const assigned: Req[] = [];
  const assignmentsByEmail = new Map<string, number>();
  const assignmentsByItem  = new Map<string, number>();
  const assignmentsByRank  = new Map<number, number>();
  const assignedPairs      = new Set<string>();
  const uniqueWinnerEmails = new Set<string>();

  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const rank of [...requestsByRank.keys()].sort((a, b) => a - b)) {
    const bucket = shuffle(requestsByRank.get(rank)!, rng);
    for (const [email, item, reqRank] of bucket) {
      if ((assignmentsByEmail.get(email) ?? 0) >= maxWins) continue;
      if ((assignmentsByItem.get(item)   ?? 0) >= (capacities[item] ?? args.defaultCap)) continue;
      if (assignedPairs.has(`${email}|${item}`)) continue;
      if (totalWinners !== null && !uniqueWinnerEmails.has(email) && uniqueWinnerEmails.size >= totalWinners) continue;

      assigned.push([email, item, reqRank]);
      inc(assignmentsByEmail, email);
      inc(assignmentsByItem, item);
      assignmentsByRank.set(reqRank, (assignmentsByRank.get(reqRank) ?? 0) + 1);
      assignedPairs.add(`${email}|${item}`);
      uniqueWinnerEmails.add(email);
    }
  }

  const unallocated = allEligibleRequests.filter(([e, i]) => !assignedPairs.has(`${e}|${i}`));

  // ── Write CSVs ────────────────────────────────────────────────────────────
  const sortedAssigned = [...assigned].sort(([,ia,ra],[,ib,rb]) => ia.localeCompare(ib) || ra - rb);
  const resultRows = sortedAssigned.map(([email, item, rank]) => {
    const [name, lineId] = profileByEmail.get(email) ?? ["",""];
    return [email, name, lineId, item, rank].join(",");
  });
  fs.writeFileSync(path.join(outDir, "allocation_results.csv"),
    ["Email,Name,LINE ID,Item,Assigned From Rank", ...resultRows].join("\n") + "\n", "utf-8");

  const fullItems   = new Set([...assignmentsByItem.entries()].filter(([i,c]) => c >= (capacities[i] ?? 0)).map(([i]) => i));
  const maxedEmails = new Set([...assignmentsByEmail.entries()].filter(([,c]) => c >= maxWins).map(([e]) => e));
  const unallocRows = unallocated.sort(([,ia,ra],[,ib,rb]) => ia.localeCompare(ib) || ra - rb).map(([email, item, rank]) => {
    const [name, lineId] = profileByEmail.get(email) ?? ["",""];
    const reason = maxedEmails.has(email) ? "Email reached max wins"
                 : fullItems.has(item)    ? "Item capacity filled"
                 : "Not selected in random order";
    return [email, name, lineId, item, rank, reason].join(",");
  });
  fs.writeFileSync(path.join(outDir, "unallocated_requests.csv"),
    ["Email,Name,LINE ID,Item,Requested Rank,Reason", ...unallocRows].join("\n") + "\n", "utf-8");

  // ── Summary ───────────────────────────────────────────────────────────────
  const summaryLines = [
    "Lottery Summary",
    "===============",
    `Input file: ${args.input}`,
    `Random seed: ${seed}`,
    `Max wins per person: ${maxWins}`,
    `Total winners cap: ${totalWinners ?? "unlimited"}`,
    `Default item capacity: ${args.defaultCap}`,
    "",
    `Eligible unique emails: ${eligibleEmails.size}`,
    `Skipped rows (CHEAT=Yes): ${skippedCheat}`,
    `Skipped rows (duplicate ranks found): ${skippedDupRank}`,
    `Skipped rows (duplicate LINE ID): ${skippedDupLineId}`,
    `Skipped rows (blacklisted LINE ID): ${skippedBlacklist}`,
    `Total eligible requests: ${allEligibleRequests.length}`,
    `Unique winners: ${uniqueWinnerEmails.size}`,
    `Total assignments: ${assigned.length}`,
    `Total unallocated requests: ${unallocated.length}`,
    "",
    "Assignments by rank:",
    ...[...requestsByRank.keys()].sort((a,b)=>a-b).map(r =>
      `- Rank ${r}: ${assignmentsByRank.get(r) ?? 0} assigned / ${requestsByRank.get(r)!.length} requests`
    ),
    "",
    "Assignments by item:",
    ...Object.keys(capacities).sort().map(item =>
      `- ${item}: ${assignmentsByItem.get(item) ?? 0} / ${capacities[item]}`
    ),
    "",
    `Emails with ${maxWins} wins:`,
    ...[...assignmentsByEmail.entries()]
      .filter(([,c]) => c === maxWins)
      .map(([e]) => e)
      .sort()
      .map(e => `- ${e}`) || ["- None"],
  ];
  fs.writeFileSync(path.join(outDir, "allocation_summary.txt"), summaryLines.join("\n") + "\n", "utf-8");

  // ── Queue assignment ──────────────────────────────────────────────────────
  const queueMap = assignQueue([...uniqueWinnerEmails].sort(), periods, rng);

  // ── results.json ──────────────────────────────────────────────────────────
  const winsByEmail = new Map<string, WinnerRecord>();
  for (const [email, item, rank] of assigned) {
    if (!winsByEmail.has(email)) {
      const [name, lineId] = profileByEmail.get(email) ?? ["",""];
      const q = queueMap[email] ?? { queueNumber: null, pickupPeriod: null };
      winsByEmail.set(email, { email, name, lineId, items: [], queueNumber: q.queueNumber, pickupPeriod: q.pickupPeriod });
    }
    winsByEmail.get(email)!.items.push({ item, rank });
  }
  for (const email of eligibleEmails) {
    if (!winsByEmail.has(email)) {
      const [name, lineId] = profileByEmail.get(email) ?? ["",""];
      winsByEmail.set(email, { email, name, lineId, items: [], queueNumber: null, pickupPeriod: null });
    }
  }

  const people = [...winsByEmail.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const disqualifiedSorted = [...disqualified].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const jsonData = {
    generatedAt: new Date().toISOString(),
    seed,
    prices,
    pickupPeriods: periods.map(({ label, time }) => ({ label, time })),
    results: people,
    disqualified: disqualifiedSorted,
  };

  const jsonPath = path.join(outDir, "results.json");
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2) + "\n", "utf-8");

  // ── Demand preview ────────────────────────────────────────────────────────
  const allRanks = [...requestsByRank.keys()].sort((a, b) => a - b);
  const demandByItem: Record<string, Record<number, number>> = {};
  for (const name of itemNames) demandByItem[name] = {};
  for (const [rank, reqs] of requestsByRank) {
    for (const [, item] of reqs) {
      demandByItem[item][rank] = (demandByItem[item][rank] ?? 0) + 1;
    }
  }
  const demandData = { ranks: allRanks, items: demandByItem };
  fs.writeFileSync(path.join(outDir, "demand_preview.json"), JSON.stringify(demandData, null, 2) + "\n", "utf-8");

  console.log(`Output folder : ${outDir}`);
  console.log(`Results       : ${path.join(outDir, "allocation_results.csv")}`);
  console.log(`Summary       : ${path.join(outDir, "allocation_summary.txt")}`);
  console.log(`Unallocated   : ${path.join(outDir, "unallocated_requests.csv")}`);
  console.log(`JSON          : ${jsonPath}`);
}

main();
