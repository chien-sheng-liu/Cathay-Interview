#!/usr/bin/env python
from __future__ import annotations

import argparse
from typing import Sequence
import numpy as np
import sys
from pathlib import Path

# Add repository src/ to sys.path for direct script execution
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from propensity.data import CATEGORY_NAMES, load_propensity
from propensity.recommendation import rank_categories, _default_member_index


def summarize(mat: np.ndarray, categories: Sequence[str], top_pairs: int = 5) -> None:
    means = mat.mean(axis=0)
    stds = mat.std(axis=0)
    p50 = np.percentile(mat, 50, axis=0)
    p90 = np.percentile(mat, 90, axis=0)

    print("Overall propensity summary (mean ± std, p50, p90):")
    order = np.argsort(means)[::-1]
    for i in order:
        print(f"- {categories[i]}: {means[i]:.3f} ± {stds[i]:.3f} | p50={p50[i]:.3f} | p90={p90[i]:.3f}")

    # Simple correlation check across categories
    corr = np.corrcoef(mat, rowvar=False)
    print("\nTop positive inter-category correlations (excluding diagonal):")
    pairs = []
    for i in range(len(categories)):
        for j in range(i + 1, len(categories)):
            pairs.append(((categories[i], categories[j]), corr[i, j]))
    for (a, b), v in sorted(pairs, key=lambda x: x[1], reverse=True)[:top_pairs]:
        print(f"- {a} ~ {b}: r={v:.3f}")


def member_view(mat: np.ndarray, member_id: str, member_index: int | None) -> None:
    if member_index is None:
        member_index = _default_member_index(member_id, mat.shape[0])
    scores = mat[member_index]
    ranked = rank_categories(scores, CATEGORY_NAMES)
    print(f"\nMember {member_id} (index={member_index}) ranked categories:")
    for c, s in ranked[:5]:
        print(f"- {c}: {s:.3f}")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Analyze spend propensity: dataset summary, correlations, and member view",
        epilog="Tip: use --top-pairs to show more correlation pairs; pass --member-index to force a specific row.",
    )
    p.add_argument("--data", default="data/spend_propensity.ndarray", help="Path to ndarray or .npy")
    p.add_argument("--member-id", default="demo-member", help="Member identifier (used if --member-index missing)")
    p.add_argument("--member-index", type=int, help="Override row index (0‑based)")
    p.add_argument("--top-pairs", type=int, default=5, help="How many top positive correlation pairs to print")
    args = p.parse_args()

    mat = load_propensity(args.data)
    print(f"Loaded matrix: shape={mat.shape}")
    summarize(mat, CATEGORY_NAMES, top_pairs=args.top_pairs)
    member_view(mat, args.member_id, args.member_index)


if __name__ == "__main__":
    main()
