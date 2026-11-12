# Personal site + live news dashboards

A static site (Eleventy) hosted free on GitHub Pages. A GitHub Action runs every morning,
pulls fresh news data, rebuilds the site and publishes it.

## Dashboards
| Page | Source |
|---|---|
| What the world is talking about | GDELT DOC 2.0 API: share of global coverage per topic, 3 months |
| Today's headlines, by the numbers | BBC News RSS: stories per section, top headline words |
| What tech is reading | Hacker News Algolia API: top front-page stories |

## Run locally
```bash
npm install
npm run data    # fetch fresh data into src/_data/ (GDELT takes ~1 min: it allows 1 request / 5s)
npm start       # http://localhost:8080
```

## Edit
- Name, tagline, links: `src/_data/site.json`
- Pages: `src/*.njk`, `src/dashboards/*.njk`
- Topics tracked: `TOPICS` in `scripts/fetch-data.mjs` (colours are fixed per topic in `global-coverage.njk`)
- Charts: `src/assets/charts.js` (no dependencies)

Every data source falls back to its last saved file, so one API being down never breaks the site.
