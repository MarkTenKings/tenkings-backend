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
slices are TCDB secondary evidence; they are never relabeled manufacturer
authority. Their 15 checklist lists supply 1,713 rows across seven releases;
91 ambiguous suffix or unnumbered source entries remain preserved outside the
import. Inserts and variants remain incomplete.

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

"$catalog_python" scripts/set-ops/sports-checklists/export_retained_catalog.py \
  --archive "$catalog_archive" \
  --baseline-sha256 af80ccc563a6a5a4c2a7ec290114cac9075d58496801fb6411ba9c2983995c8f \
  --output "$catalog_expansion/normalization/candidate-v3" \
  --upperdeck-five-sports --athlete-limit 512 \
  --additional-bundle "$catalog_expansion/fleer/fleer-1992-93-secondary-normalized.json" \
  --additional-sha256 dbb7499fc23bf36b7dc4f9c6d0a9d909e49b643753b9adbbb7ec0c91f145f7da \
  --additional-receipts "$catalog_expansion/fleer/capture-receipts.json" \
  --additional-bundle "$catalog_expansion/fleer/fleer-1992-93-inserts-secondary-normalized.json" \
  --additional-sha256 e1961375c2c732664bb5931d0bdbc863dddd72c5bc2d13794fdea1c51cbf7029 \
  --additional-receipts "$catalog_expansion/fleer/capture-receipts.json" \
  --additional-bundle "$catalog_expansion/fleer/base-1986-1991-v1/fleer-1986-1991-main-secondary-normalized.json" \
  --additional-sha256 cfc09f12e5640343bd1189adc979fdc0d98290c9edf91aac68a66cecd99ca266 \
  --additional-receipts "$catalog_expansion/fleer/base-1986-1991-v1/capture-receipts.json"

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

The frozen October 13 candidate-v3 index is
`4f06512c7051a8fd56ce16a61105ead64fdb690da8486f2fdad701cf3eddac6e`:
1,851 sources and 7,438,732 rows, adding 1,227 sources and 6,294,388 rows to
the original baseline. Its index/shard/family/alias closure is 66,804,777 bytes.
The private `normalization/qualify-candidate-v3.py` proves that all candidate-v2
source metadata, audit entries and shard bytes remain identical and exactly six
sources/1,144 rows equal the final reviewed Fleer bundle. The private
`coverage_inventory.py` accepts the candidate directory as its first argument
and reproduces the coverage JSON and product CSV. These receipts establish
local artifact state, not deployment.

## Coverage and acceptance

The private `normalization/coverage-inventory.json` and `coverage-products.csv`
separate discovered, downloaded, parsed, imported baseline, candidate and deployed
states by manufacturer/sport/year/product. Deployment counts stay null until
actual runtime evidence is attached. Source-entry counts can split a multi-sport
file; distinct product and export-version counts are separate.

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
