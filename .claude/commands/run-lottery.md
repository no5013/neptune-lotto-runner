# run-lottery

Run the full Neptune Lottery pipeline and display a formatted summary.

## Usage
```
/run-lottery
/run-lottery --max-wins 3
/run-lottery --seed 12345
/run-lottery --total-winners 100
```

## Arguments
`$ARGUMENTS`

---

## Instructions

### STEP 1 — Parse arguments

Parse `$ARGUMENTS` for optional flags to pass through:
- `--max-wins <n>`
- `--seed <n>`
- `--total-winners <n>`

Build the extra flags string from whatever was provided.

### STEP 2 — Run via orchestrator

Run this from the repo root:

```bash
python3 orchestrate.py run [extra flags]
```

This runs the full pipeline: lottery → publish to web → export Excel.

Capture stdout to extract the output folder path (the line starting with `Output folder :`).

### STEP 3 — Read the summary file

Read `allocation_summary.txt` from the output folder found in step 2.

### STEP 4 — Display formatted output

Parse the summary file and output **exactly** in this format (fill in real values — never fabricate):

---

**Lottery done!** Seed: `<seed>`

| | Count |
|---|---|
| Eligible participants | `<eligible unique emails>` |
| Skipped (duplicate ranks) | `<skipped duplicate rank rows>` |
| Unique winners | `<unique winners>` |
| Total assignments | `<total assignments>` |

**Items that hit capacity:** `<comma-separated list of items where assigned == capacity>` — if none, write `None`

**`<count of emails with max wins>`** people got `<max_wins_per_person>` wins.

Top demand at Rank 1: `<rank 1 assigned>` assigned out of `<rank 1 requests>` requests.

Output folder: `lottery_runner/output/<run_folder>/`

> Web results published to `lottery-result/public/data/` and Excel exported to the run folder.
