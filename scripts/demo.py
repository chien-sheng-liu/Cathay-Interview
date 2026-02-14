#!/usr/bin/env python
from __future__ import annotations

import argparse
from pprint import pprint
import json
import sys
from pathlib import Path

# Add repository src/ to sys.path for direct script execution
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from propensity import get_member_recommendation


def main() -> None:
    p = argparse.ArgumentParser(
        description="Spend propensity demo — prints top categories for a member",
        epilog="Tip: pass --member-index for deterministic debugging, or provide --id-to-index mapping (JSON).",
    )
    p.add_argument("--member-id", required=True, help="Member identifier (string)")
    p.add_argument("--data", default="data/spend_propensity.ndarray", help="Path to ndarray file or .npy")
    p.add_argument("--top-k", type=int, default=3)
    p.add_argument("--min-threshold", type=float, default=0.0)
    p.add_argument("--member-index", type=int, help="Override row index (0‑based) instead of hashing member-id")
    p.add_argument(
        "--id-to-index",
        help="Optional JSON file mapping member_id → row index for deterministic runs",
    )
    args = p.parse_args()

    mapping = None
    if args.id_to_index:
        with open(args.id_to_index, "r", encoding="utf-8") as f:
            mapping = json.load(f)

    kwargs = dict(data=args.data, top_k=args.top_k, min_threshold=args.min_threshold)
    if args.member_index is not None:
        kwargs["member_index"] = args.member_index
    if mapping is not None:
        kwargs["id_to_index"] = mapping

    result = get_member_recommendation(args.member_id, **kwargs)
    pprint(result)


if __name__ == "__main__":
    main()
