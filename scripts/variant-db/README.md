# Variant DB Sync (Step 2)

This script is the ingestion entrypoint for Variant DB.

It supports:
- Sports/custom imports from CSV (local file or URL)
- Pokemon imports from the official Pokemon TCG API
- Upsert mode, create-only mode, and dry-run
- Optional reference image seeding from row image URLs

Sports automation scripts:
- `discover-sports-sets.js` (discover 2020-2026 sports set/checklist pages)
- `build-sports-variants-csv.js` (extract parallel names from discovered set pages into CSV)
- `collect-sports-variants.js` (auto-build merged sports CSV from configured sources)
- `seed-sports-reference-images.js` (auto-seed reference images via SerpApi eBay engine only, with quality gate filtering before insert)
- `backfill-reference-quality-gate.js` (score existing refs and optionally delete rejects)
- `list-reference-coverage-gaps.js` (find variants with low reference count)
- `run-sports-live.js` (single command pipeline)

## Command

From repo root:

```bash
pnpm variants:sync --source csv --csv frontend/nextjs-app/public/templates/variant-template.csv --dry-run
```

## Config File Mode (recommended)

Create a JSON config, then run one command every time.

```bash
pnpm variants:sync --config scripts/variant-db/sources.example.json --dry-run
```

## Common Workflows

### 0) Sports one-command live pipeline
```bash
pnpm variants:sports:run --dry-run
pnpm variants:sports:run
```

Optional controls:
```bash
pnpm variants:sports:run --set-id "2025-26 Topps Basketball" --limit-variants 80 --images-per-variant 4
pnpm variants:sports:run --skip-seed
```

### 0.5) 2020-2026 Sports discovery -> CSV (online research automation)
```bash
pnpm variants:sports:discover --from-year 2020 --to-year 2026 --sports baseball,football,basketball
pnpm variants:sports:build-csv --manifest data/variants/sports/2020-2026/sports-sets.manifest.json --out data/variants/sports/2020-2026/sports-variants.auto.csv
pnpm variants:sync --source csv --csv data/variants/sports/2020-2026/sports-variants.auto.csv --dry-run
pnpm variants:sync --source csv --csv data/variants/sports/2020-2026/sports-variants.auto.csv
```

Then seed eBay reference images:
```bash
pnpm variants:sports:seed-refs --limit-variants 5000 --images-per-variant 4 --delay-ms 700
```

Backfill quality gate on existing references:
```bash
pnpm variants:sports:backfill-ref-quality --dry-run --limit 2000
pnpm variants:sports:backfill-ref-quality --limit 50000 --delete-rejects
```

List reference coverage gaps (<4 by default):
```bash
pnpm variants:sports:coverage-gaps --min-refs 4 --out data/variants/sports/coverage-gaps.json
```

### 1) Sports from CSV (safe preview)
```bash
pnpm variants:sync --source csv --csv /path/to/sports-variants.csv --dry-run
```

### 2) Sports from CSV (write to DB)
```bash
pnpm variants:sync --source csv --csv /path/to/sports-variants.csv --with-references
```

### 3) Pokemon from API (safe preview)
```bash
pnpm variants:sync --source pokemontcg --limit 500 --dry-run
```

### 4) Pokemon from API (write to DB + refs)
```bash
pnpm variants:sync --source pokemontcg --limit 500 --with-references
```

### 5) Combined run
```bash
pnpm variants:sync --source all --csv /path/to/sports-variants.csv --limit 1000 --with-references
```

## CSV Format

Required columns:
- `setId`
- `cardNumber`
- `parallelId`

Optional columns:
- `parallelFamily`
- `keywords` (comma/pipe/semicolon-separated)
- `oddsInfo`
- `sourceUrl`
- `rawImageUrl` (or `imageUrl`)

## Notes

- Script path: `scripts/variant-db/sync-variant-db.js`
- Package command: `pnpm variants:sync`
- Pokemon API key (optional but recommended): `POKEMONTCG_API_KEY`
- Sports source config: `scripts/variant-db/sports-sources.example.json`
- Sports image seeding requires: `SERPAPI_KEY`
