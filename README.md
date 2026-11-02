# DWTC Event Scraper (drop-in module)

Built without access to the host repo, so it is framework-light. Adapt the 3 marked points.

## Layout
- `server/dwtc/` scraper, API, Excel export (ES modules, no framework lock-in)
- `web/DwtcEventScraperPage.jsx|css` React page (no UI-lib dependency; uses host theme CSS vars)
- `tests/` node:test unit + router smoke tests, HTML fixtures
- `.env.example`, `.gitignore.additions`

## Integrate
1. Copy `server/dwtc/` into backend, `web/*` into frontend feature dir.
2. `npm i exceljs cheerio` (Playwright 1.64.1 already installed; `express` only if backend uses it).
3. Set `DWTC_EVENTS_URL` in backend `.env` (name already in `.env.example`). Merge `.gitignore.additions`.
4. Mount (ADAPT 1: auth middleware; ADAPT 2: non-Express backend -> call `service.*` directly):
   ```js
   import express from 'express';
   import { setupDwtc } from './dwtc/index.mjs';
   const dwtc = setupDwtc({ express });
   app.use('/api/dwtc', requireAuth, dwtc.router);
   process.on('SIGTERM', dwtc.shutdown);
   ```
5. Add route + nav entry "DWTC Event Scraper" rendering `<DwtcEventScraperPage apiBase="/api/dwtc" />` (ADAPT 3: router/nav).

## Run tests
`node --test tests/unit.test.mjs tests/router.smoke.test.mjs`

## Tune when DWTC markup changes
Only `server/dwtc/dwtc-parser.mjs` (detail/listing parsing) and the month-navigation block in `playwright-renderer.mjs`.
Add site-specific external extractors in `external/registry.mjs`; heading vocab in `external/heading-rules.mjs`.
