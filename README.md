# Spend Propensity & Recommendation

A minimal solution for the "Spend Propensity & Recommendation" assessment. It loads a member–category propensity matrix (N×10), analyzes distributions, and provides a simple recommendation function to return top categories per member.

## Quick Start
- Create/activate any Python 3.10+ environment (Conda/venv optional)
- Reproduce environment: `python -m pip install -r requirements.txt`
- Demo recommendation: `python scripts/demo.py --member-id 123`
- Analyze dataset: `python scripts/analyze.py`
- Run tests: `pytest -q`

## Web Frontend (React via npm)
- Export CSV from ndarray: `python scripts/export_csv.py` (writes `data/spend_propensity.csv`)
- Setup frontend:
  - cd frontend
  - npm install
  - npm run dev
- Open the dev URL shown by Vite (default http://127.0.0.1:5173)
  - The app auto-loads `frontend/public/spend_propensity.csv` and shows data when ready

Troubleshooting
- If you see a prompt to upload or an error:
  - Ensure `frontend/public/spend_propensity.csv` exists. Generate it with `python scripts/export_csv.py`.
  - Hard refresh the browser (to bypass cache) or click “Retry Load”.
  - If you changed the ndarray, rerun `python scripts/export_csv.py` to update the CSV.

### Lint, Format, Type-Check
- npm run lint
- npm run format
- npm run typecheck

## Repository Structure
- `src/propensity/` core logic (`data.py`, `recommendation.py`)
- `scripts/` CLI tools (`demo.py`, `analyze.py`)
- `tests/` unit tests
- `data/` input artifacts (e.g., `spend_propensity.ndarray`)
- `docs/` brief and design notes

## Recommendation API
Function: `propensity.get_member_recommendation(member_id: str, **kwargs)`

Key kwargs
- `data`: path to ndarray (e.g., `data/spend_propensity.ndarray`) or an in‑memory `np.ndarray`
- `top_k`: count of categories to return (default 3)
- `min_threshold`: drop categories below this score; if none remain, fallback to top_k (default 0.0)
- `member_index`: 0‑based row index override (deterministic)
- `id_to_index`: mapping `dict[str,int]` if you have external ID→row mapping

Examples
```
# Deterministic by index
python scripts/demo.py --member-id alice --member-index 42 --top-k 5 --min-threshold 0.2

# Deterministic by ID mapping (JSON file with {"alice": 42, ...})
python scripts/demo.py --member-id alice --id-to-index data/id_to_index.json
```

Returned payload
```
{
  "member_id": "alice",
  "member_index": 42,
  "recommendations": [["Groceries", 0.91], ["Clothing", 0.73], ["Health", 0.62]]
}
```

## Links
- Contributor guide: `AGENTS.md`
- Strategy, efficacy, limitations: `docs/RECOMMENDATION.md`

## Notes
- Category order is fixed per the assessment. Provide an explicit `id_to_index` in production for deterministic mapping.
# Spend Propensity — Analysis, Segmentation, and Recommendations

This repository contains a small analytics stack for exploring an N×10 spend propensity matrix, deriving segment insights (k‑means), and producing member‑level recommendations. It includes:

- Python library (`src/propensity/`) for data loading and recommendations
- Scripts (`scripts/`) for CLI demo, analysis, and CSV export to the frontend
- React frontend (`frontend/`) for EDA, segmentation, and recommendations
- Tests (`tests/`) for core recommendation logic

## Quickstart

1) Python deps

```
python -m pip install -r requirements.txt
```

2) Frontend

```
python scripts/export_csv.py  # writes frontend/public/spend_propensity.csv
cd frontend && npm install && npm run dev
```

3) CLI demo

```
python scripts/demo.py --member-id 123 --data data/spend_propensity.ndarray
```

## Project Structure

```
src/propensity/
  data.py              # CATEGORY_NAMES and loader with shape validation
  recommendation.py    # get_member_recommendation() and ranking helpers
scripts/
  analyze.py           # Dataset summary + correlations (CLI)
  demo.py              # Print member recommendations (CLI)
  export_csv.py        # Export ndarray → CSV for the frontend
frontend/              # React + Vite EDA, segments, recommendations
tests/                 # Pytest unit tests for ranking & thresholds
data/                  # ndarray and derived CSV (ignored by Git)
docs/                  # Assessment brief and notes
```

## Notes

- The dataset values are expected to be floats in [0, 1]. The app surfaces anomaly counts per category.
- Frontend auto‑clusters upon dataset load using an elbow heuristic, so executives see insights immediately.
- Member Profile insights are gated behind an explicit “Get Recommendation” click to avoid stale views.

## How To Use (Step‑by‑Step)

1) Prepare data
- Place your ndarray at `data/spend_propensity.ndarray` or adjust the paths in the scripts.
- Export a CSV for the frontend: `python scripts/export_csv.py` (writes `frontend/public/spend_propensity.csv`).

2) Start the frontend
- `cd frontend && npm install && npm run dev`
- Open the URL shown (e.g., http://localhost:5173)

3) Executive Summary
- If segments are not computed yet, click “Compute Segments” to generate segment insights.
- Review KPIs and charts. Print for a one‑page brief if needed.

4) Segments
- Adjust Selection Method (default: silhouette), Silhouette min gap (if compromise), and Seed.
- Click “Compute/Recompute Segments” to apply. The Final K and segments update.
- Review Segment Summary, Centroid Profiles, and Segment Lift tables to plan campaigns.

5) Member Profile
- Choose a member from the dropdown and click “Get Recommendation”.
- Read Scores (what), Category Lift vs population/segment (why), Recommendations/Deviations (what to do).
- Use badges and tooltips (“Why recommended”) to justify next actions.

6) Overview & EDA
- Use the Distribution Explorer to study a category’s shape (histogram + mini‑boxplot + anomalies).
- Use Category Relationships to see positive/negative pairs (bundle vs suppress).
- Use Coverage & Concentration to set thresholds and gauge effort.

## Reading The System (What each page tells you)

- Executive Summary: high‑level takeaways (Best/Final K, top correlations, segment sizes), a brief you can share.
- Overview: EDA of the whole dataset — distributions, correlations, variability, anomalies.
- Member Profile: action‑ready view of one member — recommendations, lift, deviations.
- Segments: K‑Means segmentation controls, summaries, and lift tables — build segment strategies.

## Troubleshooting

- “Data not loaded”
  - Run `python scripts/export_csv.py` to write `frontend/public/spend_propensity.csv`.
  - Click “Retry Load Data”.
  - Check the Network tab for `/spend_propensity.csv` (or relative `spend_propensity.csv`).

- “Blank page”
  - An error boundary will display the error text on page; open the console for details.
  - Share the first error line to fix quickly.

- Ports busy
  - Use `npm run dev -- --port 5177 --strictPort` or change `frontend/vite.config.ts`.

## CLI Utilities

Analyze dataset
```
python scripts/analyze.py --data data/spend_propensity.ndarray --top-pairs 10 \
  --member-id demo --member-index 0
```

Export CSV for frontend (no header)
```
python scripts/export_csv.py --input data/spend_propensity.ndarray \
  --output data/spend_propensity.csv --delimiter , --precision 6
```

Demo recommendations
```
python scripts/demo.py --member-id alice --top-k 5 --min-threshold 0.2 \
  --id-to-index data/id_to_index.json
```

## Housekeeping

- We removed legacy `web/index.html` (replaced by `frontend/`).
- Large or private assets should live under `data/` and be ignored in Git if derived (see `.gitignore`).
- Keep business logic in `src/propensity/`; scripts and frontend call into it.
