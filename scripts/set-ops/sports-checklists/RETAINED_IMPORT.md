# Additive retained catalog import

`export_retained_catalog.py` builds a private, resumable candidate for the existing
`manufacturer-checklist-index/v2` reader. It performs no downloads, production
calls, database writes, deployments or deletions. It does not consume historical
`serving-v2` or `serving-v2-next` exports.

The frozen current bundle is read first. Every source metadata object, source
ordering, row string, row ordering and repeated row is preserved. Parallel-family
and product-alias files are copied byte for byte. New product shards follow the
baseline; file names bind their compressed SHA-256. A resumed export reuses exact
bytes and rejects conflicting existing output instead of replacing it.

The importer selects `exports`, one retained usable Panini record per exact
sport/year/brand/program key, rather than counting `export_versions` as products.
The October 13 audit reparsed the seven baseline CSV identities and found **zero
product or source-hash overlap** with the 1,056 usable retained products. The union
is 1,063 usable Panini-family products. Of 1,220 observed selector labels, 156
remain unattempted and one official export is empty. This is the observed index,
not a denominator for every historical release.

Leaf and Upper Deck supplements are checked against frozen hashes and reparsed
from retained originals. Topps receipt, profiles, parser sources, proof files,
original bytes and complete reparse equality are checked before import. The
optional Upper Deck extension adds only explicit printed `Hockey`, `Golf` and
`Golf - W` categories to the prior three-sport normalization. It preserves all
prior three-sport rows. No sport, annual release, card number or parallel
cross-product is inferred.

Additional reviewed v1 bundles require their exact normalized-byte hash and
capture receipts. Every cited raw capture is byte/length checked, including
normalization evidence. Secondary source publisher, URL, retrieval timestamp,
representation and authority remain explicit. The Fleer 1986–87 through 1992–93
and 1992–93 Ultra slices are TCDB secondary evidence; they are never relabeled
manufacturer authority. Their 18 checklist lists supply 2,108 rows across eight
releases. The prior Fleer slices preserve 91 ambiguous suffix or unnumbered
entries outside import. Ultra adds 375 main numbered cards, 15 All-NBA and five
NBA Award Winners rows. Four Ultra entries remain outside import: one NNO Top 5
NBA Jammers promo, a separate Scottie Pippen #31 logo-left promo, and two NNO
multi-player Jam Session Exchange entries. All 95 exclusions retain source
evidence. Inserts and variants remain incomplete.

The reader's athlete bound is selected explicitly. `--athlete-limit 512` retains
528 measured Panini multi-player identities that exceeded the historical 120
character bound. Names remain intact, including slash-separated players. This
does not shorten them or match a single athlete to a multi-player card. The
separate physical grading intake name field remains a narrower contract.

## Reproduce

Run from the authorized checkout using Python with `openpyxl` and `pdfplumber`.
The bundled Python runtime has these dependencies. Original files and all
required proof files remain in the private acquisition archive.

```sh
catalog_archive=/Users/markthomas/.codex/atlas-handoffs/sports-checklists-20261010
catalog_expansion="$catalog_archive/catalog-expansion-20261013"
catalog_python=/Users/markthomas/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3
catalog_output="$catalog_expansion/normalization/candidate-v4-reproduction"

# Use a fresh directory. The frozen candidate-v4 and its measured qualification
# receipt remain unchanged; elapsed time and RSS are observational output.
test ! -e "$catalog_output" || { echo "Choose a fresh reproduction directory" >&2; exit 1; }

"$catalog_python" scripts/set-ops/sports-checklists/export_retained_catalog.py \
  --archive "$catalog_archive" \
  --baseline-sha256 af80ccc563a6a5a4c2a7ec290114cac9075d58496801fb6411ba9c2983995c8f \
  --output "$catalog_output" \
  --upperdeck-five-sports --athlete-limit 512 \
  --additional-bundle "$catalog_expansion/fleer/fleer-1992-93-secondary-normalized.json" \
  --additional-sha256 dbb7499fc23bf36b7dc4f9c6d0a9d909e49b643753b9adbbb7ec0c91f145f7da \
  --additional-receipts "$catalog_expansion/fleer/capture-receipts.json" \
  --additional-bundle "$catalog_expansion/fleer/fleer-1992-93-inserts-secondary-normalized.json" \
  --additional-sha256 e1961375c2c732664bb5931d0bdbc863dddd72c5bc2d13794fdea1c51cbf7029 \
  --additional-receipts "$catalog_expansion/fleer/capture-receipts.json" \
  --additional-bundle "$catalog_expansion/fleer/base-1986-1991-v1/fleer-1986-1991-main-secondary-normalized.json" \
  --additional-sha256 cfc09f12e5640343bd1189adc979fdc0d98290c9edf91aac68a66cecd99ca266 \
  --additional-receipts "$catalog_expansion/fleer/base-1986-1991-v1/capture-receipts.json" \
  --additional-bundle "$catalog_expansion/fleer/ultra-next-slice/fleer-ultra-1992-93-secondary-normalized.json" \
  --additional-sha256 808c84d553d4118851d168e765c023717ef540d62f29a54db88223b27058343d \
  --additional-receipts "$catalog_expansion/fleer/ultra-next-slice/capture-receipts.json"

python3 -m unittest discover -s scripts/set-ops/sports-checklists \
  -p test_export_retained_catalog.py -v
```

`--baseline-only` exports the exact baseline for separate sharding measurements.
`--baseline-data` selects another explicitly frozen source directory. At least
2 GiB of free space is required before a full export. Peak RSS and stage duration
in `qualification.json` measure the offline importer, not the serving worker.

Outputs include the v2 index, content-addressed product shards, unchanged
family/alias JSON, per-source input/row/provenance audit, explicit rejected rows,
and an import qualification receipt. All v2 source shards must accompany the
index in the deployment closure. The old monolith is preserved as baseline
evidence; it is not an alternative expansion export.

The frozen candidate-v4 index is
`4c6f9759e6d339351f58a7320d8523b5a15a433984afa53c10a521faf1523d74`:
1,854 sources and 7,439,127 rows, adding 1,230 sources and 6,294,783 rows to
the original 624-source / 1,144,344-row baseline. Its index/shard/family/alias
closure is 66,818,783 bytes, 14,006 bytes above candidate-v3. This closure
excludes private audit files and the preserved original monolith.

The private `normalization/qualify-candidate-v4.py` produces
`candidate-v4-additive-proof.json`: all 1,851 candidate-v3 source metadata
objects, their order, shard descriptors and audit entries remain identical;
all 65,537,916 bytes of their compressed shards and the baseline index,
family and alias files remain byte-identical. Exactly three sources / 395 rows
match the reviewed Ultra bundle, including original strings, order and locators.
The earlier v3 proof preserves the v2 prefix and the original baseline.

`normalization/coverage_overlay_v4.py` reproduces the separate
`normalization/coverage-v4/coverage-inventory.json` and `coverage-products.csv`
while preserving all 2,789 prior source entries and statuses. The v4 inventory
SHA-256 is `d3b5a9af2b7de9b8b2e56af35bb9c17717cbb286dbb5db5e16e51db0257fd42e`.
It records 2,801 discovered entries, 1,963 downloaded and 1,854 parsed; deployment
counts remain null. The 12 appended entries are three normalized lists, four
downloaded related lists with no imported rows, and five discovered lists that
remain unacquired. These counts are source entries, not distinct releases.

`normalization/prepare_candidate_v4_install.py` verifies every compressed and
decoded shard hash and generates the copy-ready metadata under
`normalization/install-v4/`. Its `install-receipt.json` binds the manifest,
coverage and import qualification files to the v4 index and exact byte closure.
The same script produces `full-candidate-v4-identities.json` at the expansion
root: one first-row identity per nonempty shard, all 1,854 in index order, with
the first 1,851 entries equal to the v3 fixture. These private receipts establish
artifact state, not deployment. The private `normalization/REPRODUCE_V4.sh`
performs a fresh full export and compares all deterministic output bytes with
the frozen candidate, excluding only observational `qualification.json`.

## Coverage and acceptance

The private `normalization/coverage-v4/coverage-inventory.json` and `coverage-products.csv`
separate discovered, downloaded, parsed, imported baseline, candidate and deployed
states by manufacturer/sport/year/product. Deployment counts stay null until
actual runtime evidence is attached. Source-entry counts can split a multi-sport
file; distinct product and export-version counts are separate.

The original Ultra lookup receipt records 48/56 positive aliases and 9/9
negative checks: Card 11's literal `92-93` passed, while Card 14's literal
`'92-93` failed in the then-current reader. The frozen identities and historical
receipt are preserved. Final lookup acceptance belongs to qualification of the
separately reviewed reader fix; the data import does not claim both cards pass
or establish physical applicability. Five Ultra related lists remain unacquired.

Coverage remains partial. Historical Fleer, Topps before its exposed archive,
Panini predecessor years, older Leaf/Press Pass/Pro Set, Upper Deck/SkyBox and
additional manufacturers retain documented gaps. SAGE, Pacific, Wild Card,
TRISTAR, Onyx and Futera discovery is not normalized coverage. Soccer and other
sports outside the current five-sport reader are never mislabeled football.

Before a release, qualify exact baseline preservation, positive and negative
lookups, the complete package closure, and the two-reader Linux worker at its
actual 1 GiB memory budget. Keep catalog/reference and physical-submission
lifecycles separate. Deployment, provider calls and human approval are separate
actions; an import receipt does not establish them.
