# Recommendation Strategy: Spend Propensity

This solution ranks product groups for each member using their propensity scores and returns the top-k categories. The categories are, in order: Transportation, Health, LuxuryGoods, Service, Telecommunications, Groceries, Clothing, Food&Beverage, PublicUtilities, Others.

Approach
- Data: An N×10 matrix where each row is a member and columns are category propensities. We load via NumPy (np.load for .npy, fallback to np.fromfile for raw C-contiguous floats).
- Indexing: `member_id` maps to a row. Prefer passing `id_to_index` or `member_index`; otherwise a deterministic hash provides a stable fallback.
- Ranking: Sort categories by descending propensity. Apply `min_threshold`; if nothing passes, fallback to top-k from the full ranking.
- Output: `{member_id, member_index, recommendations=[(category, score), ...]}`.

Design Rationale
- Deterministic hashing ensures the API works without an external member index while allowing precise control when a mapping is available.
- Thresholding avoids recommending negligible propensities; fallback maintains usability when the distribution is flat or low.
- Pure NumPy implementation keeps the code simple, fast, and dependency-light.

Efficacies (when it works well)
- High signal alignment: If propensities reflect true interest/likelihood, ranking directly optimizes relevance.
- Campaign targeting: Thresholds help filter to actionable segments (e.g., Health > 0.7) for channel/cost control.
- Cross-sell/upsell: Correlation analysis (see `scripts/analyze.py`) informs bundling (e.g., Groceries with Food&Beverage).

Limitations & Mitigations
- No calibration: Raw scores may not be well-calibrated across categories. Consider score calibration or per-category thresholds.
- Cold start and mapping: Hash fallback can collide/shift with changing N. Always pass a stable `id_to_index` in production.
- Context omission: No recency, seasonality, price sensitivity, or constraints. Extend features or combine with business rules.
- Tie-breaking: Equal scores can produce arbitrary order; add deterministic tie-breaks (e.g., business priority) if needed.

Operational Notes
- Validate shape is (N,10) and monitor coverage with tests. Use `scripts/demo.py` for quick checks and `scripts/analyze.py` to summarize distributions and correlations for campaign design.
