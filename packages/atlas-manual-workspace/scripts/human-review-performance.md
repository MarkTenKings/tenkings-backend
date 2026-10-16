# Controlled human-review performance check

`human-review-performance-browser.mjs` measures the actual batch reviewer,
manual workspace, save client and workflow HTTP handler against loopback-only
synthetic persistence and distinct full-resolution synthetic Front/Back PNGs.
Finding corrections run the existing native CPU measurement adapter.

It performs these real browser gestures:

1. Open a retained review card from the batch screen.
2. Approve unchanged Front geometry and wait for usable Back geometry.
3. Approve Back geometry and wait for usable Front findings.
4. Change a finding type, save and remeasure it.
5. Approve Front findings and wait for usable Back findings.
6. Approve Back findings and wait for the complete grade preview.
7. From a separately seeded completed synthetic card, click **Next card** and
   wait for the second card's correct Front geometry image and controls.

Both fixtures already contain an adopted final-review state. The timing matrix
therefore covers opening already-adopted cards; fresh `BEGIN_FINAL_REVIEW`
adoption is outside this timing matrix and covered by separate functional tests.

The clock starts on the actual browser click/change event. A screen is usable
only when its action controls are enabled and its exact expected image hash has
been verified and decoded/displayed; geometry also completes gradient-map
preparation. Two animation frames allow the resulting UI to paint. Report
readiness requires both exact inspection photographs. A faster screen switch
alone cannot pass.

## Reproduce

Use Node 22 and build the normal workspace dependencies first. Use an existing compatible local
Python environment with the repository's native measurement dependencies.

```sh
ATLAS_FIXTURE_PYTHON=/absolute/path/to/python \
ATLAS_PERF_TRIALS=10 \
node packages/atlas-manual-workspace/scripts/human-review-performance-browser.mjs \
  /absolute/path/to/source-checkout /absolute/path/to/evidence before

ATLAS_FIXTURE_PYTHON=/absolute/path/to/python \
ATLAS_PERF_TRIALS=10 \
node packages/atlas-manual-workspace/scripts/human-review-performance-browser.mjs \
  /absolute/path/to/changed-checkout /absolute/path/to/evidence after

node packages/atlas-manual-workspace/scripts/human-review-performance-compare.mjs \
  /absolute/path/to/evidence/before-result.json \
  /absolute/path/to/evidence/after-result.json \
  /absolute/path/to/evidence/comparison.json
```

Optional `ATLAS_PERF_PROFILE=desktop` or `phone` selects one profile for a smoke
run; `ATLAS_PERF_CACHE=cold` or `warm` selects a cache condition. Default ten trials per viewport/cache combination produces forty flows per
source version. Compare sequential runs without unrelated heavy CPU workloads.
If a known competing workload overlaps a sample, retain the original raw
evidence, designate the affected whole flow before rerunning, and document any
replacement and its source. Do not discard slow samples without such evidence.

## What the numbers mean

These are **controlled fixture timings, not production measurements**. Phone
means a 390×844 viewport and shaped bandwidth on desktop Chrome, not a physical
iPhone. Desktop is 1440×1000. Chrome shapes image bandwidth at 25/10 Mbps;
deterministic API roundtrip delays of 60/140 ms represent sensitivity to latency.
The initial batch page mounts before bandwidth shaping starts. Its ordinary
inspection-image prefetch may therefore begin without shaping, identically in
both versions. The Front geometry image requested by the measured opening and
the second card's images requested by **Next card** start after shaping. This
setup cannot be interpreted as a fully cold end-to-end mobile page load.

Both variants pay the same declared hydration cost. A full workspace read pays
30 ms for the card read and 190 ms for hydration. An embedded workspace pays
190 ms for hydration and 60 ms for the two-read freshness fence. Metadata and
image-descriptor builders still execute through the actual HTTP handler. The
fixture does not assume that moving assembly into a POST makes that work free.

Save/commit adds a declared 80 ms before actual reducer/native work. Findings
confirmation adds a declared 200 ms post-commit learning/memory wait. Preview
adds 120 ms before actual report generation. These inputs are not estimates of
production work. Raw server phase durations retain the actual native CPU cost
alongside the declared save delay; image hash, explicit decode, geometry
preparation and resource download measurements are recorded independently.
The comparison includes phase medians and maxima. These are summed task
durations within each click interval, not an additive critical-path breakdown:
downloads can overlap, and successful prefetch moves work before the click.
The native measurement value excluding the injected commit delay still includes
host scheduling; it is not a hardware CPU-cycle measurement.

Cold starts with an empty verified-image pool; normal application prefetch stays
enabled. There is a fixed 1.5-second review pause after entry, then 250 ms between
other gestures. Warm explicitly leases the exact next images through the same
verified pool before the timed opening. Raw request records retain background
queue polling; summary critical-request counts exclude it except the Next-card
queue read (an overlapping poll can add one).

Comparison requires byte-identical report-content, finding and geometry hashes,
the same revisions and the same action-type sequence at every measured step. It
reports the median and observed maximum, not a production SLO or p95. Source
commit, modified-file hashes, instrumented-file hashes and browser-bundle hash
bind the result to the code exercised.
Future runs also record UTC click intervals to identify unrelated host activity.
The script writes a source/bundle manifest before launching the browser, so a
later setup failure does not erase that provenance. `ATLAS_PERF_METADATA_ONLY=1`
rebuilds that manifest without running timing trials; label any reconstruction
after a prior run as such rather than claiming it was captured by that process.

Final report approval/publication, variants, sold comps, provider calls, live
authentication and production databases are outside the fixture. The completed
state used to expose **Next card** is seeded outside measurement; no final
approval is sent. The browser refuses non-loopback HTTP destinations. This
performance check complements the separate concurrency/recovery/access tests;
it does not replace them or establish real-customer acceptance.
