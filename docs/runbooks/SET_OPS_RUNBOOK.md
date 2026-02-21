# Set Ops Runbook

last_verified_at: 2026-02-21
owner: Mark

## Rules
- Never trust UI-only symptoms; validate via API + DB
- Log every run in `docs/handoffs/SESSION_LOG.md`

## Find Manifest Containing a Set (No ripgrep required)
```bash
cd /root/tenkings-backend
SET_ID='2020 Panini Stars &#038; Stripes USA Baseball Cards'
MANIFEST="$(grep -Rsl "\"setId\": \"$SET_ID\"" data/variants/checklists/checklist-batch.coverage.db-matched.chunk*.clean.json | head -n 1)"
echo "$MANIFEST"
```

If empty:
```bash
grep -R -n -F "$SET_ID" data/variants/checklists/checklist-batch.coverage.db-matched.chunk*.clean.json | head -n 20
```

## Run Set Seeding
```bash
cd /root/tenkings-backend
pnpm variants:sports:run --manifest "$MANIFEST" --set-id "$SET_ID" --seed-set-timeout-ms 1800000 --delay-ms 0 --no-gate --no-resume
```

## Build QA Gap Queue (Single Set)
```bash
cd /root/tenkings-backend
node scripts/variant-db/build-qa-gap-queue.js --set-id "$SET_ID" --ref-side front --min-refs 2 --out logs/seed-batch/manual-check/2020-panini-stars-038-stripes-usa-baseball-cards.qa-gap-queue.json
```

## Build QA Gap Queue (Broader)
```bash
cd /root/tenkings-backend
node scripts/variant-db/build-qa-gap-queue.js --ref-side front --min-refs 2 --limit 20000 --out logs/seed-batch/manual-check/next-set-gap-queue.json
```

## Validate Queue Result
- `queueCount: 0` means no remaining min-ref gaps per current queue rules
- If UI still looks wrong, investigate label normalization and API aggregation logic

## API Verification
```bash
curl -s "https://collect.tenkings.co/api/admin/variants?limit=20&gapOnly=false&minRefs=2"
curl -s "https://collect.tenkings.co/api/admin/variants/reference?setId=2020%20Panini%20Stars%20%26%20Stripes%20USA%20Baseball%20Cards&cardNumber=113&parallelId=USA%20Baseball&limit=50"
```

## SQL Diagnostics
```bash
psql "$DATABASE_URL" -c "select \"setId\", count(*) as refs from \"CardVariantReferenceImage\" where \"setId\" ilike '%Topps Basketball%' group by 1 order by 2 desc;"
```

```bash
psql "$DATABASE_URL" -c "select coalesce(nullif(\"cardNumber\",''), 'NULL') as card_number, count(*) as refs from \"CardVariantReferenceImage\" where \"setId\" = '2025-26 Topps Basketball' group by 1 order by 2 desc;"
```

```bash
psql "$DATABASE_URL" -c "select \"setId\", \"cardNumber\", \"parallelId\", count(*) from \"CardVariantReferenceImage\" where \"setId\" = '2020 Panini Stars &#038; Stripes USA Baseball Cards' group by 1,2,3 order by 4 desc limit 50;"
```

## Tooling Notes
- Prefer `rg` when available
- If missing, use `grep -Rsl` / `grep -R -n`
- Keep manifest commands on one line to avoid malformed shell expansion
