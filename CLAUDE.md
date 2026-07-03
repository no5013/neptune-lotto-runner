# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A two-part squishy lottery system: a Python runner that allocates items from Google Form submissions, and a Next.js web app that displays results.

## Commands

### Lottery Runner (Python)

```bash
# Run with defaults (reads input/form-submissions.csv and input/item_capacities.json)
cd lottery_runner && python3 run_lottery.py

# Common options
python3 run_lottery.py --max-wins 2 --seed 12345
python3 run_lottery.py --capacity 50              # default capacity if item not in JSON
python3 run_lottery.py --capacity-file input/item_capacities.json
```

Output lands in `lottery_runner/output/run_YYYYMMDD_HHMMSS/` — each run is isolated.

### Web App (Next.js, inside `lottery-result/`)

```bash
cd lottery-result
npm run dev      # dev server at localhost:3000
npm run build    # production build
npm run lint     # ESLint
```

## Architecture

### Data Flow

1. **Google Form CSV** → `lottery_runner/input/form-submissions.csv`
2. **`run_lottery.py`** reads the CSV + `item_capacities.json`, runs the allocation, and writes:
   - `allocation_results.csv` — who got what
   - `unallocated_requests.csv` — unmet requests with reasons
   - `allocation_summary.txt` — stats
   - **`results.json`** — full structured data including all participants
3. **Copy `results.json`** to `lottery-result/public/results.json`
4. **Next.js app** serves it statically; the single page (`app/page.tsx`) fetches it client-side and masks PII in the browser before rendering

### Lottery Algorithm (`run_lottery.py`)

- Parses ranking columns matching `Ranking: ... [item name]` pattern
- Validates rows: skips those flagged `CHEAT=yes` or with duplicate rank values; both groups go into `disqualified[]` in the JSON
- Processes requests rank-by-rank (rank 1 first), shuffling within each rank bucket for fairness
- Respects `--max-wins` per email and per-item capacities from `item_capacities.json`
- Seed is auto-generated from timestamp unless `--seed` is passed (for reproducibility)

### Web App (`lottery-result/`)

Single-page app (`app/page.tsx`) with two tabs:
- **Search tab**: user enters their email or LINE ID to look up their result (full PII shown for their own record)
- **All results tab**: shows everyone with email/LINE ID masked client-side via `maskEmail()` / `maskText()`

`results.json` contains raw PII — masking happens entirely in the browser, never server-side. The `disqualified[]` array is separate from `results[]`.

### Updating Results for a New Lottery Round

1. Replace `lottery_runner/input/form-submissions.csv` with the new form export
2. Update `lottery_runner/input/item_capacities.json` with new items and capacities
3. Run `python3 run_lottery.py`
4. Copy the generated `results.json` to `lottery-result/public/results.json`
5. Update the event title in `app/page.tsx` (`<h1>` heading)
