#!/usr/bin/env python
from __future__ import annotations

import argparse
import numpy as np
from pathlib import Path
import sys

# Ensure src/ is importable when running directly
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from propensity.data import load_propensity


def main() -> None:
    p = argparse.ArgumentParser(description="Export ndarray to CSV (no header)")
    p.add_argument("--input", default="data/spend_propensity.ndarray", help="Path to ndarray file")
    p.add_argument("--output", default="data/spend_propensity.csv", help="Path to output CSV")
    p.add_argument("--delimiter", default=",", help="CSV delimiter (default ,)")
    p.add_argument("--precision", type=int, default=6, help="Decimal precision for writing (default 6)")
    args = p.parse_args()

    arr = load_propensity(args.input)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    fmt = f"%.{max(0,args.precision)}f"
    np.savetxt(out, arr, delimiter=args.delimiter, fmt=fmt)
    print(f"Wrote {out} with shape {arr.shape}")

    # Also write a copy for the React dev server if folder exists
    repo_root = Path(__file__).resolve().parents[1]
    public_dir = repo_root / "frontend" / "public"
    try:
        public_dir.mkdir(parents=True, exist_ok=True)
        public_csv = public_dir / "spend_propensity.csv"
        np.savetxt(public_csv, arr, delimiter=args.delimiter, fmt=fmt)
        print(f"Wrote {public_csv} for frontend auto-load")
    except Exception as e:
        print(f"[warn] Could not write frontend/public CSV: {e}")


if __name__ == "__main__":
    main()
