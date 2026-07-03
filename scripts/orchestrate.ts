#!/usr/bin/env tsx
/**
 * Neptune Lottery Orchestrator (replaces orchestrate.py)
 *
 * Usage (via npm):
 *   npm run orchestra run
 *   npm run orchestra run -- --seed 12345 --no-export
 *   npm run orchestra publish
 *   npm run orchestra publish -- --run run_20260704_022102
 *   npm run orchestra export
 *   npm run orchestra export -- --run run_20260704_022102 --output ~/Desktop/winners.xlsx
 *
 * Or directly:
 *   npx tsx scripts/orchestrate.ts run
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT       = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(ROOT, "output");
const INPUT_DIR  = path.join(ROOT, "input");
const WEB_DIR    = path.join(ROOT, "lottery-result");
const WEB_DATA   = path.join(WEB_DIR, "public", "data");

// ── Helpers ────────────────────────────────────────────────────────────────
function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 48 - title.length))}`);
}

function tsx(script: string, ...args: string[]) {
  execFileSync("npx", ["tsx", path.join(SCRIPT_DIR, script), ...args], { cwd: ROOT, stdio: "inherit" });
}

function latestRunDir(): string {
  if (!fs.existsSync(OUTPUT_DIR)) throw new Error("No output/ folder found.");
  const runs = fs.readdirSync(OUTPUT_DIR).filter(d => d.startsWith("run_")).sort();
  if (!runs.length) throw new Error("No run output found in output/");
  return path.join(OUTPUT_DIR, runs[runs.length - 1]);
}

function resolveRun(runArg: string | undefined): string {
  return runArg ? path.join(OUTPUT_DIR, runArg) : latestRunDir();
}

function publishToWeb(runDir: string) {
  fs.mkdirSync(WEB_DATA, { recursive: true });

  const src = path.join(runDir, "results.json");
  const dst = path.join(WEB_DATA, "results.json");
  fs.copyFileSync(src, dst);
  console.log(`Copied → ${path.relative(ROOT, dst)}`);

  const eventCfg = path.join(INPUT_DIR, "event_config.json");
  if (fs.existsSync(eventCfg)) {
    fs.copyFileSync(eventCfg, path.join(WEB_DATA, "event_config.json"));
    console.log(`Copied → ${path.relative(ROOT, path.join(WEB_DATA, "event_config.json"))}`);
  }
}

// ── Commands ───────────────────────────────────────────────────────────────
function cmdRun(argv: string[]) {
  const noWeb    = argv.includes("--no-web");
  const noExport = argv.includes("--no-export");
  const flags    = argv.filter(a => !["--no-web", "--no-export"].includes(a));

  section("Running lottery");
  tsx("run-lottery.ts", ...flags);

  const runDir = latestRunDir();

  if (!noWeb) {
    section("Publishing to web");
    publishToWeb(runDir);
  }

  if (!noExport) {
    section("Exporting Excel");
    tsx("export-winners.ts", `--results=${path.join(runDir, "results.json")}`);
  }

  console.log(`\n✓ All done.  Run folder: output/${path.basename(runDir)}/`);
}

function cmdPublish(argv: string[]) {
  const runArg = argv.find(a => a.startsWith("--run="))?.slice(6)
               ?? (argv.indexOf("--run") !== -1 ? argv[argv.indexOf("--run") + 1] : undefined);
  const runDir = resolveRun(runArg);
  section("Publishing to web");
  publishToWeb(runDir);
  console.log("\n✓ Done.");
}

function cmdExport(argv: string[]) {
  const runArg = argv.find(a => a.startsWith("--run="))?.slice(6)
               ?? (argv.indexOf("--run") !== -1 ? argv[argv.indexOf("--run") + 1] : undefined);
  const runDir = resolveRun(runArg);
  section("Exporting Excel");
  const extra = [`--results=${path.join(runDir, "results.json")}`];
  const outArg = argv.find(a => a.startsWith("--output=")) ?? (argv.indexOf("--output") !== -1 ? `--output=${argv[argv.indexOf("--output") + 1]}` : undefined);
  if (outArg) extra.push(outArg);
  tsx("export-winners.ts", ...extra);
  console.log("\n✓ Done.");
}

// ── Entry ──────────────────────────────────────────────────────────────────
const [command, ...rest] = process.argv.slice(2);

if (command === "run")         cmdRun(rest);
else if (command === "publish") cmdPublish(rest);
else if (command === "export")  cmdExport(rest);
else {
  console.error("Usage: npm run orchestra <run|publish|export> [options]");
  process.exit(1);
}
