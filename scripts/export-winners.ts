#!/usr/bin/env tsx
/**
 * Neptune Lottery Excel Exporter (TypeScript port of export_winners.py)
 *
 * Usage:
 *   npm run export
 *   npm run export -- --results ../../output/run_xxx/results.json
 *   npm run export -- --output ~/Desktop/winners.xlsx
 */

import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";

interface ItemResult { item: string; rank: number; }
interface PickupPeriod { label: string; time: string; }
interface Winner {
  email: string; name: string; lineId: string;
  items: ItemResult[];
  queueNumber: number | null;
  pickupPeriod: PickupPeriod | null;
}

// ── Paths ──────────────────────────────────────────────────────────────────
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const ROOT       = path.resolve(SCRIPT_DIR, "..");
const OUTPUT_DIR = path.join(ROOT, "output");

// ── Args ───────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };
  return { results: get("--results") ?? null, output: get("--output") ?? null };
}

function latestResults(): string {
  if (!fs.existsSync(OUTPUT_DIR)) throw new Error("No output/ folder found.");
  const runs = fs.readdirSync(OUTPUT_DIR)
    .filter(d => d.startsWith("run_"))
    .sort();
  if (!runs.length) throw new Error("No run output found in output/");
  return path.join(OUTPUT_DIR, runs[runs.length - 1], "results.json");
}

// ── Excel builder ─────────────────────────────────────────────────────────
async function buildExcel(winners: Winner[], prices: Record<string, number>, outPath: string) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Winners");

  const TEAL       = "2A9D8F";
  const TEAL_LIGHT = "E8F5F4";
  const AMBER      = "F4A261";
  const WHITE      = "FFFFFFFF";
  const GRAY_ROW   = "FFF8F8F8";

  const thinBorder: Partial<ExcelJS.Borders> = {
    top:    { style: "thin", color: { argb: "FFBBBBBB" } },
    left:   { style: "thin", color: { argb: "FFBBBBBB" } },
    bottom: { style: "thin", color: { argb: "FFBBBBBB" } },
    right:  { style: "thin", color: { argb: "FFBBBBBB" } },
  };

  // ── Headers ───────────────────────────────────────────────────────────────
  const headers = ["คิวที่", "ชื่อ", "LINE ID", "Email", "รอบรับของ", "ของที่ได้", "ราคา/ชิ้น", "ยอดรวม", "✓"];
  const widths  = [8, 18, 18, 30, 16, 32, 12, 12, 6];

  ws.columns = widths.map((width, i) => ({ header: headers[i], width, key: String(i) }));
  ws.getRow(1).eachCell(cell => {
    cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${TEAL}` } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border    = thinBorder;
  });
  ws.getRow(1).height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];

  // ── Data rows ─────────────────────────────────────────────────────────────
  const sorted = [...winners].sort((a, b) => (a.queueNumber ?? 9999) - (b.queueNumber ?? 9999));

  sorted.forEach((person, i) => {
    const items      = person.items ?? [];
    const period     = person.pickupPeriod;
    const periodStr  = period ? `${period.label} (${period.time} น.)` : "";
    const total      = items.reduce((s, r) => s + (prices[r.item] ?? 0), 0);
    const itemNames  = items.map(r => `• ${r.item}`).join("\n");
    const itemPrices = items.map(r => `฿${(prices[r.item] ?? 0).toLocaleString()}`).join("\n");
    const fillArgb   = i % 2 === 0 ? WHITE : GRAY_ROW;

    const row = ws.addRow([
      person.queueNumber ?? "",
      person.name ?? "",
      person.lineId ?? "",
      person.email ?? "",
      periodStr,
      itemNames,
      itemPrices,
      total,
      "",
    ]);

    const aligns: ExcelJS.Alignment["horizontal"][] = ["center","left","left","left","center","left","center","center","center"];
    row.eachCell((cell, colNum) => {
      cell.alignment = { horizontal: aligns[colNum - 1], vertical: "middle", wrapText: true };
      cell.border    = thinBorder;
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
    });

    // Highlight total cell
    const totalCell = row.getCell(8);
    totalCell.font = { bold: true, size: 11 };
    totalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${TEAL_LIGHT}` } };

    row.height = Math.max(18, items.length * 18);
  });

  // ── Grand total row ───────────────────────────────────────────────────────
  const grandTotal = sorted.reduce((s, p) =>
    s + (p.items ?? []).reduce((ss, r) => ss + (prices[r.item] ?? 0), 0), 0);

  const totalRow = ws.addRow(["","","","","","","Grand Total", grandTotal, ""]);
  [7, 8].forEach(col => {
    const cell = totalRow.getCell(col);
    cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${AMBER}` } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  totalRow.height = 22;

  // ── Print settings ────────────────────────────────────────────────────────
  ws.pageSetup.orientation    = "landscape";
  ws.pageSetup.fitToPage      = true;
  ws.pageSetup.fitToWidth     = 1;
  ws.pageSetup.fitToHeight    = 0;
  ws.pageSetup.printTitlesRow = "1:1";

  await wb.xlsx.writeFile(outPath);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args        = parseArgs();
  const resultsPath = args.results ?? latestResults();
  const data        = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
  const winners: Winner[] = (data.results ?? []).filter((p: Winner) => p.items?.length > 0);
  const prices: Record<string, number> = data.prices ?? {};
  const outPath = args.output ?? path.join(path.dirname(resultsPath), "winners_export.xlsx");

  await buildExcel(winners, prices, outPath);

  const grandTotal = winners.reduce((s, p) =>
    s + p.items.reduce((ss, r) => ss + (prices[r.item] ?? 0), 0), 0);
  console.log(`Exported ${winners.length} winners → ${outPath}`);
  console.log(`Grand total : ฿${grandTotal.toLocaleString()}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
