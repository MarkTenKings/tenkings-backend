# Official sports checklist acquisition

This is the offline acquisition adapter for the existing `card-catalog-evidence`
variant provider and SetOps card CSV contract. It does not create another online
catalog service or publish authoritative card printings. The requested scope is
baseball, basketball and football, 1990 through October 10, 2026. **Coverage is
partial**, including within the years present. There is no complete 1990 archive.

## Storage and serving

Raw official downloads, quarantined rows, receipts, SQLite, and the full source
manifest stay outside Git. This run uses
`/Users/markthomas/.codex/atlas-handoffs/sports-checklists-20261010`.
`catalog.sqlite` has indexed `sources` and explicit `rows` linked by source ID;
every retained file has a SHA-256 and each normalized row has a page/row or
sheet/row locator. A plain CSV export uses existing SetOps fields (`set_id`,
`card_number`, `player_name`, `team`, `subset`, `rookie`, `source_url`) plus
provenance columns. This export is review material, not an automatic publication.

Production reads only
`packages/card-catalog-evidence/data/manufacturer-checklists.json.gz`. The
adjacent manifest records its hash, compressed/decoded size and row count; the
coverage JSON records actual source states and gaps. The gzip contains a source
table, an interned string dictionary and compact row tuples. It is loaded lazily
once per provider instance on the first complete SPORTS identity. Pokémon and
incomplete identities do not load it. No network or paid provider call occurs.

`createManufacturerChecklistVariantProvider({ catalog, loadCatalog, limit })`
returns `prepare(identity)`. Factory defaults read the bundled catalog with a
48-choice bound. Athlete, product, manufacturer, year and card number must match.
Only explicit manufacturer brand aliases are accepted. A composite sports name
such as `Topps Chrome — Ball of Duty` must match both the parent product and
the literal subset or a boundary-prefixed parallel. A bare starting year can
match the immediately following basketball season only when the same exact
card/name/product/subset evidence is unambiguous and no exact-year match
exists. The requested grading identity stays unchanged; source season and row
locator remain in candidate diagnostics. Explicit season conflicts fail closed. A repeated same-athlete
name on both card faces can match; a different multi-athlete card cannot. Labels
remain literal printing/subset evidence. Results always remain
`provider_candidate`, `applicability: unknown`, `canonical: null`; checklist
membership is not physical identification or human approval. SoldComps can attach
photos to each named choice through the existing review composition.

## Official archive limits

- [Topps](https://www.topps.com/pages/checklists) explicitly says products before
  2018 have no available checklists. The entire current link index was retained;
  clearly classified target-sport sources were attempted. Non-target/ambiguous
  links remain indexed, and blocked/unsupported downloads remain gaps.
- [Panini](https://www.paniniamerica.net/checklist.html) is a dependent UI archive.
  Visible year options: football 2004–2025; basketball 2009–2026; baseball
  2004–2005 and 2008–2026. These are index options, **not downloaded coverage**.
  This bounded snapshot retains seven complete official UI CSV exports: 2024
  football Prizm and Donruss Optic; 2025 football Donruss Optic; 2024–25 basketball Prizm, Select and Mosaic;
  2025 baseball Prizm. Remaining years/programs need resumable acquisition. The 2025 Optic export
  lists Jaxson Dart Donruss Threads variants under official card number `3`;
  `DTBH-JDT` does not occur in that export. Those numbers are not aliased, so the
  current `DTBH-JDT` identity remains a documented coverage gap. CSV
  program names containing `(24-25)` provide explicit season evidence.
- [Leaf](https://www.leaftradingcards.com/releases) exposes 69 current public
  archive pages with 616 product links. All 260 clearly classified target-sport
  product pages were checked; 217 files were retained. Published source titles
  reach 2012–13 through 2026. Missing checklist links, unsupported formats and
  ambiguous sheets remain gaps. The current Leaf archive does not establish
  completeness for the earlier Donruss/Leaf era.
- [Upper Deck](https://upperdeck.com/checklists/) currently exposes five football
  checklist pages in its football filter: four physical CFL tables from
  2024–2026 and one UFL e-Pack table. All five were retained; the digital UFL
  table is excluded from physical coverage. Historical Upper Deck, Fleer,
  SkyBox and other discontinued brands are not covered by this current filter.
- Score, Playoff, Donruss, Fleer, SkyBox, Pinnacle, Pacific, Press Pass, Sage and
  other historical products are **not claimed complete**. Some current Leaf
  checklists include Pro Set/Press Pass brands. Brand presence is not evidence
  of complete ownership-era or historical coverage.

## Reproduce or resume

Use Python 3 with `pdfplumber` and `openpyxl` for source parsing. All source reads
are bounded to 30 MiB; network concurrency is three. HTTP access failures are
retained, never bypassed. `fetch` and `normalize` process only unhandled states.

```sh
python catalog.py --root "$ARCHIVE" index --links "$ARCHIVE/raw/topps-links.json" --manufacturer Topps --index-url https://www.topps.com/pages/checklists
python catalog.py --root "$ARCHIVE" fetch --limit 600
python catalog.py --root "$ARCHIVE" normalize --limit 600
python leaf.py --root "$ARCHIVE" --max-pages 75 --limit 500
python leaf_normalize.py --root "$ARCHIVE"
python upperdeck.py --root "$ARCHIVE"
python panini.py --root "$ARCHIVE" --csv "$OFFICIAL_CSV" --bundle "$REPOSITORY/packages/card-catalog-evidence/data/manufacturer-checklists.json.gz"
python catalog.py --root "$ARCHIVE" export
python -m unittest discover -s scripts/set-ops/sports-checklists -p 'test_*.py'
node --test packages/card-catalog-evidence/tests/manufacturer-checklist.test.mjs
```

For browser-only archives, use normal public UI controls. Save all Topps links as
`[{title,url}]`; save Panini's **Download Full Checklist** CSV and record the
sport/year/brand/program selectors in `panini-export-receipts.json`. The UI may
create a data-URL anchor rather than a browser download event; capture the whole
anchor in bounded chunks and validate its CSV header, every row length and a
single product identity. Never import a truncated chunk. Upper Deck captures use
`{url,title,capturedAt,rows:[[cell,...],...]}` plus `upperdeck-products.json` with
local paths. Only rendered table cells are read. No hidden endpoint or browser
session credential is needed.

The PDF parser keeps explicitly printed card rows under observed section
headings, with real column separation. Leaf supports explicit per-card color
cells; blank cells produce nothing, foil/color labels retain their qualifiers,
duplicate color headings are quarantined, and freeform printing notes are not
silently discarded. Set-wide parallel prose is never multiplied over a checklist.
Printing-plate statements without explicit card/color cells are not expanded.

The repository ignores `.gz` globally; stage this one reviewed serving artifact
explicitly with `git add -f`. Keep original PDFs/XLSX/CSV and SQLite private.
