"""Recommendation logic over an (N×10) propensity matrix.

Primary entrypoint: ``get_member_recommendation`` which ranks categories for a
given member, applies an optional minimum threshold, and returns the top K.

Design notes:
- Caller can pass a NumPy matrix or a path; we validate shape (N,10).
- Member selection is flexible: explicit index, mapping, or stable hash.
- ``rank_categories`` is exposed for reuse in analysis scripts/tests.
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence, Tuple, Union
import numpy as np

from .data import CATEGORY_NAMES, load_propensity


def _default_member_index(member_id: str, size: int) -> int:
    """Map an arbitrary member_id string to a stable index in [0, size).

    Prefer passing an explicit mapping via kwargs for reproducibility.
    """
    # Simple deterministic hash
    return abs(hash(member_id)) % size


def rank_categories(
    scores: np.ndarray,
    categories: Sequence[str] = CATEGORY_NAMES,
) -> List[Tuple[str, float]]:
    """Return categories sorted by descending score.

    Parameters
    - scores: shape (10,) array for one member
    - categories: names aligned to scores

    Returns list of (category, score) tuples from highest to lowest.
    """
    order = np.argsort(scores)[::-1]
    return [(categories[i], float(scores[i])) for i in order]


def get_member_recommendation(
    member_id: str,
    **kwargs,
) -> Dict[str, Union[str, int, List[Tuple[str, float]]]]:
    """Return recommendations for a member based on propensity matrix.

    Parameters (kwargs):
    - data: np.ndarray or path to ndarray file; if missing, defaults to 'spend_propensity.ndarray' in CWD
    - top_k: int (default 3) number of categories to return
    - min_threshold: float (default 0.0) minimum propensity to include
    - id_to_index: dict[str,int] explicit mapping from member_id to row index
    - member_index: int override index directly

    Returns: dict with member_id, index, and ranked recommendations.
    """
    top_k: int = int(kwargs.get("top_k", 3))
    min_threshold: float = float(kwargs.get("min_threshold", 0.0))

    data_arg = kwargs.get("data", "spend_propensity.ndarray")
    if isinstance(data_arg, np.ndarray):
        mat = data_arg
    else:
        mat = load_propensity(str(data_arg))

    if mat.ndim != 2 or mat.shape[1] != 10:
        raise ValueError("Expected propensity matrix of shape (N,10)")

    # Determine row index (priority: explicit index > mapping > stable hash)
    if "member_index" in kwargs:
        idx = int(kwargs["member_index"])
    elif "id_to_index" in kwargs and isinstance(kwargs["id_to_index"], dict):
        idx = int(kwargs["id_to_index"].get(member_id, -1))
        if idx < 0:
            raise KeyError(f"member_id '{member_id}' not found in id_to_index")
    else:
        idx = _default_member_index(member_id, mat.shape[0])

    if not (0 <= idx < mat.shape[0]):
        raise IndexError(f"member_index {idx} out of range [0, {mat.shape[0]})")

    scores = mat[idx]
    ranked = rank_categories(scores)

    # Filter by threshold; if none remain, fall back to top_k
    filtered = [(c, s) for c, s in ranked if s >= min_threshold]
    recs = filtered[:top_k] if filtered else ranked[:top_k]

    return {
        "member_id": member_id,
        "member_index": idx,
        "recommendations": recs,
    }
