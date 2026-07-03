#!/usr/bin/env python3
"""
Neptune Lottery Orchestrator

Commands:
  run     Run the lottery, publish results to web, and export Excel
  publish Copy the latest (or specified) run's results.json to the web app
  export  Generate winners Excel from the latest (or specified) run

Examples:
  python3 orchestrate.py run
  python3 orchestrate.py run --seed 12345 --no-export
  python3 orchestrate.py publish
  python3 orchestrate.py publish --run run_20260704_022102
  python3 orchestrate.py export
  python3 orchestrate.py export --run run_20260704_022102 --output ~/Desktop/winners.xlsx
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT           = Path(__file__).parent
LOTTERY_RUNNER = ROOT / "lottery_runner"
WEB_DATA       = ROOT / "lottery-result" / "public" / "data"
INPUT_DIR      = ROOT / "input"


def latest_run_dir() -> Path:
    runs = sorted((LOTTERY_RUNNER / "output").glob("run_*/results.json"))
    if not runs:
        raise FileNotFoundError("No run output found in lottery_runner/output/")
    return runs[-1].parent


def resolve_run(run_arg) -> Path:
    if run_arg:
        return LOTTERY_RUNNER / "output" / run_arg
    return latest_run_dir()


def run_subprocess(*args, cwd=None):
    result = subprocess.run([sys.executable, *args], cwd=cwd)
    if result.returncode != 0:
        sys.exit(result.returncode)


def section(title: str):
    print(f"\n── {title} {'─' * max(0, 48 - len(title))}")


def cmd_run(args):
    flags = []
    if args.seed:          flags += ["--seed", str(args.seed)]
    if args.max_wins:      flags += ["--max-wins", str(args.max_wins)]
    if args.total_winners: flags += ["--total-winners", str(args.total_winners)]

    section("Running lottery")
    run_subprocess("run_lottery.py", *flags, cwd=LOTTERY_RUNNER)

    run_dir = latest_run_dir()

    if not args.no_web:
        section("Publishing to web")
        WEB_DATA.mkdir(parents=True, exist_ok=True)
        shutil.copy2(run_dir / "results.json", WEB_DATA / "results.json")
        print(f"Copied → {(WEB_DATA / 'results.json').relative_to(ROOT)}")
        event_cfg = INPUT_DIR / "event_config.json"
        if event_cfg.exists():
            shutil.copy2(event_cfg, WEB_DATA / "event_config.json")
            print(f"Copied → {(WEB_DATA / 'event_config.json').relative_to(ROOT)}")

    if not args.no_export:
        section("Exporting Excel")
        run_subprocess(
            "export_winners.py",
            "--results", str(run_dir / "results.json"),
            cwd=LOTTERY_RUNNER,
        )

    print(f"\n✓ All done.  Run folder: lottery_runner/output/{run_dir.name}/")


def cmd_publish(args):
    run_dir = resolve_run(args.run)
    section("Publishing to web")
    WEB_DATA.mkdir(parents=True, exist_ok=True)
    shutil.copy2(run_dir / "results.json", WEB_DATA / "results.json")
    print(f"Copied {run_dir.name}/results.json → {(WEB_DATA / 'results.json').relative_to(ROOT)}")
    event_cfg = INPUT_DIR / "event_config.json"
    if event_cfg.exists():
        shutil.copy2(event_cfg, WEB_DATA / "event_config.json")
        print(f"Copied event_config.json → {(WEB_DATA / 'event_config.json').relative_to(ROOT)}")
    print("\n✓ Done.")


def cmd_export(args):
    run_dir = resolve_run(args.run)
    section("Exporting Excel")
    extra = ["--results", str(run_dir / "results.json")]
    if args.output:
        extra += ["--output", args.output]
    run_subprocess("export_winners.py", *extra, cwd=LOTTERY_RUNNER)
    print("\n✓ Done.")


def main():
    parser = argparse.ArgumentParser(
        prog="orchestrate.py",
        description="Neptune Lottery orchestrator — runs the full pipeline or individual steps.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # ── run ───────────────────────────────────────────────────────────────────
    p_run = sub.add_parser("run", help="Run lottery → publish → export (full pipeline)")
    p_run.add_argument("--seed", type=int, help="Fixed random seed for reproducibility")
    p_run.add_argument("--max-wins", type=int, dest="max_wins", help="Max items per person")
    p_run.add_argument("--total-winners", type=int, dest="total_winners", help="Winner cap")
    p_run.add_argument("--no-web", action="store_true", help="Skip copying results to web")
    p_run.add_argument("--no-export", action="store_true", help="Skip Excel export")

    # ── publish ───────────────────────────────────────────────────────────────
    p_pub = sub.add_parser("publish", help="Copy results.json from a run to the web app")
    p_pub.add_argument("--run", metavar="RUN_FOLDER", help="Run folder name (default: latest)")

    # ── export ────────────────────────────────────────────────────────────────
    p_exp = sub.add_parser("export", help="Export winners Excel from a run")
    p_exp.add_argument("--run", metavar="RUN_FOLDER", help="Run folder name (default: latest)")
    p_exp.add_argument("--output", metavar="PATH", help="Output .xlsx path")

    args = parser.parse_args()

    if args.command == "run":     cmd_run(args)
    elif args.command == "publish": cmd_publish(args)
    elif args.command == "export":  cmd_export(args)


if __name__ == "__main__":
    main()
