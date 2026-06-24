# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Single-page, static visualization of the Polish state budget (planned expenditure) for years 2011–2026, by Stowarzyszenie Terra Cracovianum. Each year is a separate dataset extracted directly from the budget act (ustawa budżetowa, załącznik nr 2 — wydatki). The user picks a year and views the spending structure across **five tabs**: a treemap (with drill-down), a Sankey flow (dochody → budżet → wydatki), a breakdown by expense type, a cross-year **Trendy** dashboard, and a personal **Twoje podatki** (per-capita) view. Educational goal: show citizens "what the state spends money on," comparably across years. Budget amounts are always **plan** (from the act), never **wykonanie** (actual execution) — this keeps cross-year comparison methodologically consistent.

The full product spec lives in `PRD-Budzet-Polski.docx` (read it for backlog, parsing history, and per-year data provenance).

## No build step — this is a hard constraint

Everything must deploy directly to GitHub Pages: no npm, no bundler, no compilation. Libraries (D3 v7, d3-sankey) load from CDN. There is no test runner, linter, or package manager. To develop, serve the folder over HTTP (the app uses `fetch`, so `file://` won't work):

```
python3 -m http.server 8000   # then open http://localhost:8000
```

## Architecture

Three files do everything:

- **`index.html`** — page structure: masthead (logo `logo.svg`), hero, year bar (16 buttons 2011–2026), **five** tabs/panels (Mapa / Przepływ / Rodzaj / Trendy / Twoje podatki), footer ("wersja 14 beta"). SVG containers are filled by JS.
- **`style.css`** — all styling + responsiveness. Single breakpoint at **760px**. Aesthetic is fixed: cream background, brown accent `#7C5C3E`, Inter font, Tabler icons — keep it minimal. Includes a motion layer (custom easing tokens, count-up, treemap scale-pop, blur crossfades, hover gated behind `@media (hover: hover)`, `prefers-reduced-motion` fallbacks).
- **`app.js`** — one IIFE, vanilla JS + D3, no modules. Sections: bootstrap/fetch, stats band (count-up via `tweenValue`), legend, data shaping, treemap (desktop + mobile variants), Sankey (desktop horizontal + mobile transposed-vertical), type breakdown, **trends dashboard** (cross-year: line/stacked charts, zł/% + real-terms toggles, "największe zmiany" movers), **Twoje podatki** (per-capita + tax-split bars), tabs/axis/year wiring, helpers.

Plus the data: `budget-data.json` (year 2026, loaded at startup), `budget-2011.json … budget-2025.json` (lazy-loaded on year selection, then cached), and **`trends-data.json`** (compact per-year series, lazy-loaded when the Trendy tab opens). Note `budget-data.json` **is** 2026 — there is no `budget-2026.json`. `YEAR_FILES` in `app.js` maps year → filename.

### Trendy tab (cross-year dashboard)
The 4th tab compares all years 2011–2026 (KPI cards, totals line chart, type-composition stacked columns, per-category line chart, with a zł/% toggle). It reads only `trends-data.json` — a compact file **generated from the 16 year files** (per year: `wydatki/dochody/deficyt`, the 7 `typy`, and normalized `dzialy`). Generation normalizes dział names (2011 encoding artifacts + spelling variants) so category lines are continuous; only `dlug_pkb_proc`/`obrona_pkb_proc` are 2026-only and excluded.

### Twoje podatki tab + real-terms (CPI) — `context-data.json`
Two more features read **`context-data.json`** (hand-authored, externally sourced — NOT generated): per-year annual average `cpi` (GUS, prev year = 100) and `ludnosc` (GUS year-end population). It powers: the **Twoje podatki** tab (per-capita = wydatki ÷ population; "z 1000 zł" and "twój podatek" splits by dział share), the **wartości realne** toggle in Trendy (deflates nominal zł to constant 2026 prices via a chained CPI price-level index), and the **Największe zmiany** module. NBP's API has no CPI — GUS is the source. 2026 CPI (3,0%) is a government projection (`prognoza:true`); reclassified działy show no % in "największe zmiany" (avoids misleading −100%). **When adding a year, also add its `cpi`+`ludnosc` to `context-data.json`** (cite the GUS source in its `zrodla` block).

**When adding a year, regenerate `trends-data.json`** (it is derived, not hand-edited): run `python3 gen-trends.py`. The script reads every `budget-*.json`, normalizes names, writes the compact file, and asserts each year's `typy` sum and `dzialy` sum equal `wydatki` (diff 0) — it refuses to write on a mismatch. The old `trends-data.json` that mixed *wykonanie*+*plan* has been replaced; keep everything **plan** only.

### Key state (globals in `app.js`)

`DATA` (current year's json), `YEAR`, `YEAR_CACHE` (year → json), `YEAR_FILES` (year → filename), `view` (`"tree"|"flow"|"type"|"trends"|"taxes"`), `axis` (`"dzialy"|"czesci"`), `path` (drill-down breadcrumb stack). Lazy caches: `TRENDS` (trends-data.json), `CONTEXT` (context-data.json), `PRICE` (CPI price-level index).

### Data flow

`setYear()` lazy-loads + caches a year file, then re-renders the active view plus `renderStats()` (4 stat cards, hero amount/year, intro text, masthead law reference). `switchView()` toggles tabs and dispatches to `drawTree()` / `drawSankey()` / `drawTypes()`. The axis toggle (działy ↔ części) only applies to the treemap and is hidden in other views.

### Two axes and drill-down

- **działy** ("na co") — flat list of ~31–32 budget functions; no drill-down.
- **części** ("kto wydaje") — units that drill część → dział → rozdział via `currentNodes()` reading `path`. `canDrill()` gates this to the części axis only.

(31 vs 32 działy across years is correct, not a bug — it follows that year's classification.)

### Mobile rendering is a separate code path, not just CSS

`isMobile()` = viewport ≤760px OR coarse-pointer under 900px (the 900px fallback fixes in-app browsers). On mobile, JS swaps the treemap for a bar list (`#tree-rest`, top-12 + collapsible "Pozostałe") and transposes the Sankey to vertical. A `matchMedia` change listener re-renders the active view when crossing the breakpoint. **Test both mobile and desktop after any structural change.**

## Data model and invariants

Each `budget-YYYY.json` has identical shape. **All amounts are in tys. zł (thousands of złoty)** — `money()`/`moneyShort()` in `app.js` multiply by 1000 for display.

```jsonc
{
  "meta": { "rok", "ustawa", "wydatki", "dochody", "deficyt",
            "jednostka", "typ", "dlug_pkb_proc"?, "obrona_pkb_proc"? },
  "dochody": [ { "name", "plan" }, … ],          // Sankey revenue side (read from załącznik 1)
  "dzialy":  [ { "code", "name", "plan" }, … ],  // "na co" view
  "czesci":  [ { "code", "name", "plan",
                 "dzialy": [ { "code", "name", "plan",
                               "rozdzialy": [ { "code","name","plan" } ] } ] } ],
  "typy":    [ { "name", "plan" }, … ]           // 7 expense types
}
```

These invariants are **critical** and must hold for every new or edited year file — they are what makes the visualization trustworthy. Verify with diff 0 before considering a year done:

1. `sum(dzialy[].plan) == meta.wydatki`
2. `sum(czesci[].plan) == meta.wydatki`
3. `sum(typy[].plan) == meta.wydatki`
4. for each część: `sum(jej dzialy[].plan) == czesc.plan`
5. `meta.deficyt == meta.wydatki − meta.dochody` (deficyt is 0 for 2020, a balanced budget — the Sankey handles this)

`dlug_pkb_proc` is optional: when present (2026), the 4th stat card shows "Dług / PKB"; otherwise it shows "Pokrycie wydatków" (dochody/wydatki). Read tax figures (VAT/akcyza/CIT/PIT) from the budget act's załącznik 1 — **never from model memory**, which is a real source of errors.

## Common task: adding a year

1. Generate `budget-YYYY.json` (parsing scripts live outside this repo).
2. Verify all 5 invariants against the act's "Ogółem" total.
3. Add a `<button data-year="YYYY">` to the year bar in `index.html`.
4. Add the `YYYY: "budget-YYYY.json"` entry to `YEAR_FILES` in `app.js`.
5. **Regenerate `trends-data.json`**: `python3 gen-trends.py` (derived from the year files; it re-checks the invariants and refuses to write on a mismatch).
6. **Update `context-data.json`** by hand: add the year's `cpi` (GUS annual average, prev year = 100) and `ludnosc` (GUS year-end population), citing the source in its `zrodla` block. Without it the Trendy real-terms toggle and Twoje podatki per-capita fall back to "—" for that year.
7. Bump the cache-buster: `?v=N` on the css/js `<link>`/`<script>` in `index.html` (currently `v=17`; manual; index.html also sends no-cache meta). GitHub Pages caching is sticky — recommend a hard refresh after deploy.

Years 2010 and 2005–2009 are not done (parser/OCR issues — see PRD §5).

## Deploy

Live at **https://nintindoadam.github.io/Budzet-Polski/** (repo `NintindoAdam/Budzet-Polski`, branch `main`, GitHub Pages). This working folder is **not** a git repo — deploy by cloning the repo to a temp dir, copying changed files over, committing, and pushing `main` (then poll the live URL for the new `?v=`). Publishing is outward-facing — get explicit user go-ahead before each push.

## Conventions

- Polish-language UI; comments and identifiers mix Polish domain terms (dzialy, czesci, rozdzialy, wydatki) with English.
- Category colors are assigned by regex matching on Polish names in `colorKey()` (treemap/Sankey) and `typeColorKey()` (types) → CSS variables `--c-*`. New categories of spending may need a regex branch added.
- No frameworks, no transpilation — match the existing ES5-style vanilla JS (`var`, function expressions, IIFE).
