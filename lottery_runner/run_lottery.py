#!/usr/bin/env python3
import argparse
import csv
import json
import random
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

RANKING_PREFIX = "Ranking:"
EMAIL_COL = "Email Address"
NAME_COL = "ชื่อ (สามารถใช้ชื่ออะไรก็ได้)"
LINE_COL = "LINE ID"
CHEAT_COL = "CHEAT"
ITEM_REGEX = re.compile(r"\[(.*?)\]")
RANK_REGEX = re.compile(r"Rank\s*(\d+)", re.IGNORECASE)

# All relative paths are resolved from the script's own directory
BASE_DIR = Path(__file__).parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Randomly allocate items from form rankings while respecting "
            "rank priority, item capacities, and max wins per email."
        )
    )
    parser.add_argument(
        "--input",
        default="input/form-submissions.csv",
        help="Input form CSV file (default: input/form-submissions.csv)",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        help=(
            "Directory for output files. Defaults to output/run_YYYYMMDD_HHMMSS/ "
            "so each run is preserved separately."
        ),
    )
    parser.add_argument(
        "--capacity",
        type=int,
        default=20,
        help="Default capacity for each item",
    )
    parser.add_argument(
        "--capacity-file",
        default="input/item_capacities.json",
        help=(
            "JSON file mapping item name to capacity "
            '(default: input/item_capacities.json)'
        ),
    )
    parser.add_argument(
        "--max-wins",
        type=int,
        default=2,
        help="Maximum items each email can win",
    )
    parser.add_argument(
        "--seed",
        type=int,
        help="Random seed for reproducible results",
    )
    return parser.parse_args()


def extract_item_name(column_name: str) -> str:
    match = ITEM_REGEX.search(column_name)
    return match.group(1).strip() if match else column_name.strip()


def parse_rank(value: str):
    if not value:
        return None
    match = RANK_REGEX.search(value)
    if not match:
        return None
    return int(match.group(1))


def load_capacities(item_names, default_capacity: int, capacity_file: str):
    capacities = {item: default_capacity for item in item_names}
    if capacity_file:
        with open(capacity_file, "r", encoding="utf-8") as f:
            overrides = json.load(f)
        for item, cap in overrides.items():
            if item in capacities:
                capacities[item] = int(cap)
    return capacities


def main() -> None:
    args = parse_args()
    input_path = BASE_DIR / args.input

    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    seed = args.seed if args.seed is not None else int(datetime.now().timestamp())
    rng = random.Random(seed)

    # Build output directory relative to script location
    run_ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = Path(args.output_dir) if args.output_dir else BASE_DIR / "output" / f"run_{run_ts}"
    out_dir.mkdir(parents=True, exist_ok=True)

    output_path = out_dir / "allocation_results.csv"
    summary_path = out_dir / "allocation_summary.txt"
    unallocated_path = out_dir / "unallocated_requests.csv"

    with input_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        all_columns = reader.fieldnames or []
        ranking_columns = [c for c in all_columns if c.startswith(RANKING_PREFIX)]
        if not ranking_columns:
            raise ValueError("No ranking columns found.")

        item_by_column = {col: extract_item_name(col) for col in ranking_columns}
        item_names = [item_by_column[c] for c in ranking_columns]
        capacities = load_capacities(item_names, args.capacity, BASE_DIR / args.capacity_file if args.capacity_file else None)

        requests_by_rank = defaultdict(list)
        all_eligible_requests = []
        skipped_cheat_rows = 0
        skipped_duplicate_rank_rows = 0
        eligible_emails = set()
        profile_by_email = {}  # email -> (name, line_id)
        disqualified_people = []  # list of {email, name, lineId, reason}

        for row in reader:
            email = (row.get(EMAIL_COL) or "").strip()
            if not email:
                continue

            cheat_value = (row.get(CHEAT_COL) or "").strip().lower()
            name = (row.get(NAME_COL) or "").strip()
            line_id = (row.get(LINE_COL) or "").strip()

            if cheat_value == "yes":
                skipped_cheat_rows += 1
                disqualified_people.append({
                    "email": email,
                    "name": name,
                    "lineId": line_id,
                    "disqualifiedReason": "cheat_flag",
                })
                continue

            row_requests = []
            row_ranks = []
            for col in ranking_columns:
                rank = parse_rank((row.get(col) or "").strip())
                if rank is None:
                    continue
                item = item_by_column[col]
                row_requests.append((email, item, rank))
                row_ranks.append(rank)

            if not row_requests:
                continue

            if len(row_ranks) != len(set(row_ranks)):
                skipped_duplicate_rank_rows += 1
                disqualified_people.append({
                    "email": email,
                    "name": name,
                    "lineId": line_id,
                    "disqualifiedReason": "duplicate_rank",
                })
                continue

            eligible_emails.add(email)
            profile_by_email[email] = (name, line_id)
            for req in row_requests:
                requests_by_rank[req[2]].append(req)
                all_eligible_requests.append(req)

    assigned = []
    assignments_by_email = Counter()
    assignments_by_item = Counter()
    assignments_by_rank = Counter()
    assigned_pairs = set()

    for rank in sorted(requests_by_rank):
        bucket = requests_by_rank[rank][:]
        rng.shuffle(bucket)
        for email, item, req_rank in bucket:
            if assignments_by_email[email] >= args.max_wins:
                continue
            if assignments_by_item[item] >= capacities[item]:
                continue
            if (email, item) in assigned_pairs:
                continue

            assigned.append((email, item, req_rank))
            assignments_by_email[email] += 1
            assignments_by_item[item] += 1
            assignments_by_rank[req_rank] += 1
            assigned_pairs.add((email, item))

    unallocated = [
        req
        for req in all_eligible_requests
        if (req[0], req[1]) not in assigned_pairs
    ]

    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Email", "Name", "LINE ID", "Item", "Assigned From Rank"])
        for email, item, rank in sorted(assigned, key=lambda x: (x[1], x[2], x[0])):
            name, line_id = profile_by_email.get(email, ("", ""))
            writer.writerow([email, name, line_id, item, rank])

    with unallocated_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Email", "Name", "LINE ID", "Item", "Requested Rank", "Reason"])
        full_items = {item for item, count in assignments_by_item.items() if count >= capacities[item]}
        maxed_emails = {email for email, count in assignments_by_email.items() if count >= args.max_wins}

        for email, item, rank in sorted(unallocated, key=lambda x: (x[1], x[2], x[0])):
            name, line_id = profile_by_email.get(email, ("", ""))
            reason = "Not selected in random order"
            if email in maxed_emails:
                reason = "Email reached max wins"
            elif item in full_items:
                reason = "Item capacity filled"
            writer.writerow([email, name, line_id, item, rank, reason])

    summary_lines = [
        "Lottery Summary",
        "===============",
        f"Input file: {input_path.resolve()}",
        f"Random seed: {seed}",
        f"Max wins per email: {args.max_wins}",
        f"Default item capacity: {args.capacity}",
        "",
        f"Eligible unique emails: {len(eligible_emails)}",
        f"Skipped rows (CHEAT=Yes): {skipped_cheat_rows}",
        f"Skipped rows (duplicate ranks found): {skipped_duplicate_rank_rows}",
        f"Total eligible requests: {len(all_eligible_requests)}",
        f"Total assignments: {len(assigned)}",
        f"Total unallocated requests: {len(unallocated)}",
        "",
        "Assignments by rank:",
    ]

    for rank in sorted(requests_by_rank):
        summary_lines.append(
            f"- Rank {rank}: {assignments_by_rank[rank]} assigned / {len(requests_by_rank[rank])} requests"
        )

    summary_lines.append("")
    summary_lines.append("Assignments by item:")
    for item in sorted(capacities):
        summary_lines.append(
            f"- {item}: {assignments_by_item[item]} / {capacities[item]}"
        )

    summary_lines.append("")
    summary_lines.append("Emails with 2 wins:")
    two_wins = sorted([email for email, count in assignments_by_email.items() if count == args.max_wins])
    if two_wins:
        for email in two_wins:
            summary_lines.append(f"- {email}")
    else:
        summary_lines.append("- None")

    summary_path.write_text("\n".join(summary_lines) + "\n", encoding="utf-8")

    # Group wins per person
    wins_by_email: dict = {}
    for email, item, rank in assigned:
        if email not in wins_by_email:
            name, line_id = profile_by_email.get(email, ("", ""))
            wins_by_email[email] = {
                "email": email,
                "name": name,
                "lineId": line_id,
                "items": [],
            }
        wins_by_email[email]["items"].append({"item": item, "rank": rank})

    # Also include eligible people who won nothing
    for email in eligible_emails:
        if email not in wins_by_email:
            name, line_id = profile_by_email.get(email, ("", ""))
            wins_by_email[email] = {
                "email": email,
                "name": name,
                "lineId": line_id,
                "items": [],
            }

    people = sorted(wins_by_email.values(), key=lambda p: p["name"].lower())
    disqualified_sorted = sorted(disqualified_people, key=lambda p: p["name"].lower())

    json_data = {
        "generatedAt": datetime.now().isoformat(),
        "seed": seed,
        # Full raw data. Website handles masking at render time.
        "results": people,
        # Disqualified people (cheat flag or duplicate ranks)
        "disqualified": disqualified_sorted,
    }

    json_path = out_dir / "results.json"
    json_path.write_text(
        json.dumps(json_data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"Output folder : {out_dir}")
    print(f"Results       : {output_path}")
    print(f"Summary       : {summary_path}")
    print(f"Unallocated   : {unallocated_path}")
    print(f"JSON          : {json_path}")


if __name__ == "__main__":
    main()
