# Design Preference Study API

Backend source for the visual preference study. The participant frontend and stimulus images are hosted on the `main` branch of this repository via GitHub Pages. This branch contains the API, admin dashboard, session assignment logic, and study data schema. Runtime state lives in the configured D1 database; no responses or admin credentials are committed here.

The currently deployed API is `https://canvas-preference-study.tonylowe001031.chatgpt.site`. GitHub is a source mirror, not an anonymous vote-ingestion endpoint. Deployment from GitHub to a reachable backend requires a hosting integration and private deployment credential.

Build: `npm ci && npm run build`. Local integration check: `python3 scripts/test_offline_import.py` with the local Worker running.
