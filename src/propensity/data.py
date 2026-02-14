"""Data loading and category metadata for spend propensity.

Exposes:
- CATEGORY_NAMES: canonical ordering of the 10 product groups
- load_propensity(): robust loader for (N×10) ndarray from .npy or raw binary
"""
from __future__ import annotations

import os
import numpy as np
from typing import Sequence

# Order as specified in the assessment
CATEGORY_NAMES: Sequence[str] = (
    "Transportation",
    "Health",
    "LuxuryGoods",
    "Service",
    "Telecommunications",
    "Groceries",
    "Clothing",
    "Food&Beverage",
    "PublicUtilities",
    "Others",
)


def load_propensity(path: str) -> np.ndarray:
    """Load the (N×10) propensity ndarray from disk.

    Accepts either:
    - A NumPy ``.npy`` file (via ``np.load``)
    - A raw C‑contiguous binary of float64 values (via ``np.fromfile``)

    Returns a 2‑D array shaped ``(N, 10)`` with dtype float.
    Raises FileNotFoundError or ValueError with clear messages if invalid.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    # Heuristic: try np.load first (works for .npy), else fall back to fromfile
    try:
        arr = np.load(path, allow_pickle=False)
        arr = np.asarray(arr, dtype=float)
    except Exception:
        arr = np.fromfile(path, dtype=float)
        # Expect shape (10000, 10)
        if arr.size % 10 != 0:
            raise ValueError("File does not contain floats in multiples of 10")
        rows = arr.size // 10
        arr = arr.reshape(rows, 10)
    if arr.ndim != 2 or arr.shape[1] != 10:
        raise ValueError(f"Expected (N,10) array, got {arr.shape}")
    return arr
