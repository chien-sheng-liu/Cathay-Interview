# Repository Guidelines

- Docs and data are organized under `docs/` and `data/`:
  - `docs/DS Assessment - spend propensity 2.docx` — assessment brief
  - `data/spend_propensity.ndarray` — N×10 propensity matrix
- Source lives under `src/propensity/`:
  - `data.py` — loaders and category metadata.
  - `recommendation.py` — `get_member_recommendation` implementation.
- Utilities and examples:
  - `scripts/demo.py` — CLI demo to fetch recommendations.
  - `scripts/analyze.py` — dataset summary and correlations.
  - `scripts/export_csv.py` — export ndarray to CSV for the React UI.
- Frontend: `frontend/` — Vite + React app (upload CSV; in-browser analysis and recommendations).
- Tests in `tests/` mirror `src/` layout. Add notebooks to `notebooks/` if used (outputs cleared).

## Build, Test, and Development Commands
- Environment reproduction: `python -m pip install -r requirements.txt` (pins exact versions)
- Run tests: `pytest -q`
- Demo (CLI): `python scripts/demo.py --member-id 123 --data data/spend_propensity.ndarray`
- Analyze: `python scripts/analyze.py --data data/spend_propensity.ndarray`
- Frontend (React via npm):
  - Export CSV: `python scripts/export_csv.py`
  - Start dev server: `cd frontend && npm install && npm run dev`

## Coding Style & Naming Conventions
- Python 3.10+; 4 spaces; type hints required in public APIs.
- Files/modules: `snake_case.py`; classes: `CamelCase`; functions/vars: `snake_case`.
- Keep business logic in `src/propensity/`; scripts/notebooks must call into these modules.

## Testing Guidelines
- Framework: `pytest`. Provide unit tests for scoring, ranking, and tie‑breaks.
- Name tests `tests/test_<module>.py`; use small in‑memory arrays (no external I/O).
- Cover edge cases: unknown `member_id`, thresholds with no categories, and kwargs overrides.

## Commit & Pull Request Guidelines
- Commit style (present tense): `feat: implement get_member_recommendation`, `test: add tie‑break cases`.
- PRs must include: brief rationale, how to run, screenshots/prints for demo, and linked issue if any.

## Security & Configuration Tips
- Do not commit secrets or raw PII. Use Git LFS for files >10MB.
- The dataset may contain synthetic member indices; map real IDs outside the repo and pass via kwargs.
