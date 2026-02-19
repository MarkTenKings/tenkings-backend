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
- `build-checklist-source-manifest.js` (find best checklist source URL per discovered set page)
- `collect-sports-variants.js` (auto-build merged sports CSV from configured sources)
- `parse-checklist-players.js` (parse official checklist PDF/TXT/CSV into `setId,parallelId,playerName,cardNumber` CSV)
- `parse-checklists-batch.js` (batch parse+validate checklist sources and emit seeding manifest)
- `seed-sports-reference-images.js` (auto-seed reference images via SerpApi eBay engine only, with quality gate filtering before insert)
- `backfill-reference-quality-gate.js` (score existing refs and optionally delete rejects)
- `list-reference-coverage-gaps.js` (find variants with low reference count)
- `run-sports-live.js` (single command pipeline)
- `build-checklist-player-map.js` (convert checklist CSV rows into set+parallel+player/card map for exhaustive-player seeding)
- `build-qa-gap-queue.js` (build missing-reference queue JSON for QA)
- `validate-checklist-output.js` (check parsed checklist completeness/quality before seed)

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
pnpm variants:sports:run --set-id "2025-26 Topps Basketball" --images-per-variant 4
pnpm variants:sports:run --set-id "2025-26 Topps Basketball" --limit-variants 80 --images-per-variant 4
pnpm variants:sports:run --skip-seed
```

Manifest-driven checklist batch (validation + map + seed + QA queue per set):
```bash
pnpm variants:sports:run --manifest scripts/variant-db/checklist-batch.example.json
pnpm variants:sports:run --manifest scripts/variant-db/checklist-batch.example.json --allow-warn
pnpm variants:sports:run --manifest scripts/variant-db/checklist-batch.example.json --batch-log-dir logs/seed-batch/manual-run
```

### 0.5) 2020-2026 Sports discovery -> CSV (online research automation)
```bash
pnpm variants:sports:discover --from-year 2020 --to-year 2026 --sports baseball,football,basketball
pnpm variants:sports:build-csv --manifest data/variants/sports/2020-2026/sports-sets.manifest.json --out data/variants/sports/2020-2026/sports-variants.auto.csv
pnpm variants:sync --source csv --csv data/variants/sports/2020-2026/sports-variants.auto.csv --dry-run
pnpm variants:sync --source csv --csv data/variants/sports/2020-2026/sports-variants.auto.csv
```

### 0.6) 2020-2026 checklist source discovery -> batch parse/validate -> seeding manifest
```bash
pnpm variants:sports:build-checklist-sources \
  --manifest data/variants/sports/2020-2026/sports-sets.manifest.json \
  --from-year 2020 \
  --to-year 2026 \
  --sports baseball,football,basketball \
  --manufacturers topps,panini,bowman,upper\ deck \
  --out data/variants/checklists/checklist-sources.manifest.json

pnpm variants:sports:parse-checklists-batch \
  --manifest data/variants/checklists/checklist-sources.manifest.json \
  --out-dir data/variants/checklists \
  --out data/variants/checklists/checklist-parse-batch-report.json \
  --batch-manifest-out data/variants/checklists/checklist-batch.generated.json \
  --min-rows 1 \
  --max-missing-card-pct 100 \
  --max-unknown-parallel-pct 100 \
  --allow-warn true \
  --continue-on-error true
```

Strict/high-confidence mode (optional):
```bash
pnpm variants:sports:parse-checklists-batch \
  --manifest data/variants/checklists/checklist-sources.manifest.json \
  --out-dir data/variants/checklists \
  --out data/variants/checklists/checklist-parse-batch-report.strict.json \
  --batch-manifest-out data/variants/checklists/checklist-batch.strict.json \
  --min-rows 150 \
  --max-missing-card-pct 60 \
  --max-unknown-parallel-pct 40 \
  --allow-warn false \
  --continue-on-error true
```

Run unattended seed from the generated manifest:
```bash
pnpm variants:sports:run --manifest data/variants/checklists/checklist-batch.generated.json
```

Then seed eBay reference images (exhaustive-player default):
```bash
pnpm variants:sports:seed-refs --images-per-variant 4 --delay-ms 700 --checklist-player-map data/variants/checklists/player-map.json
```

Optional cap for test runs:
```bash
pnpm variants:sports:seed-refs --limit-variants 500 --images-per-variant 4 --delay-ms 700 --checklist-player-map data/variants/checklists/player-map.json
```

Variant-level coverage mode (old behavior):
```bash
pnpm variants:sports:seed-refs --mode sniper --limit-variants 5000 --images-per-variant 4 --delay-ms 700 --checklist-player-map data/variants/checklists/player-map.json
```

Seed front and back separately with pairing keys:
```bash
pnpm variants:sports:seed-refs --set-id "2025-26 Topps Basketball" --images-per-variant 2 --ref-side front --delay-ms 100 --checklist-player-map data/variants/checklists/player-map.json
pnpm variants:sports:seed-refs --set-id "2025-26 Topps Basketball" --images-per-variant 2 --ref-side back --delay-ms 100 --checklist-player-map data/variants/checklists/player-map.json
```

Build checklist player map from CSV (columns: `setId,parallelId,playerName,cardNumber`):
```bash
pnpm variants:sports:build-player-map --csv data/variants/checklists/2025-26-topps-basketball.players.csv --out data/variants/checklists/player-map.json
```

Parse official checklist into player CSV (Topps-first parser):
```bash
pnpm variants:sports:parse-checklist \
  --set-id "2025-26 Topps Basketball" \
  --in "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2025-26_Topps_Basketball_Checklist.pdf?v=1759329649" \
  --out data/variants/checklists/2025-26-topps-basketball.players.csv
```

Validate parsed checklist output (recommended gate before seed):
```bash
pnpm variants:sports:validate-checklist \
  --csv data/variants/checklists/2025-26-topps-basketball.players.csv \
  --set-id "2025-26 Topps Basketball" \
  --min-rows 500 \
  --max-missing-card-pct 35 \
  --max-unknown-parallel-pct 25 \
  --out data/variants/checklists/2025-26-topps-basketball.validation.json
```

If parsing from PDF on Linux, install:
```bash
apt install -y poppler-utils
```

Build QA gap queue (missing refs first):
```bash
pnpm variants:sports:qa-queue --set-id "2025-26 Topps Basketball" --min-refs 2 --out data/variants/qa-gap-queue.json
```

Legacy broad mode (hidden fallback only, not default):
```bash
pnpm variants:sports:seed-refs --set-id "2025-26 Topps Basketball" --legacy-broad-mode --max-player-seeds 6 --max-queries 20
```

## Checklist Batch Manifest

Reference template:
- `scripts/variant-db/checklist-batch.example.json`

Required per set:
- `setId`
- `playersCsv`

Optional per set:
- `slug`
- `imagesPerVariant`
- `delayMs`
- `minRefs`
- `refSide` (`front` or `back`)
- `allowWarn`
- `limitVariants` (only for capped test runs)

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
