# ATLAS inspection improvement — September 21, 2026

Status: live at [atlasgrading.com/admin](https://atlasgrading.com/admin), promoted at approximately 06:26 UTC. Application source is `406466a089bdd2d34022bc8c06283a0649978b15`. This record supersedes the implementation gaps and ada008 baseline in the [original inspection handoff](inspection-viewer-handoff.md); its historical evidence remains retained.

## Requested behavior and preservation

Mark observed successful Charmander `522610ad-3b06-4657-bf66-90f510fc9435` Astra suggestions (three Front/four Back) and requested practical magnification, direct inspection of a mark and actual photo context outside card edges. Saved analyses, proposals, drafts, geometry and source photographs remain intact. Viewing does not accept/reject suggestions, confirm findings or run another paid analysis.

The viewer displays the complete 1350×1858 inspection image. Its canonical 1270×1778 overlay stays inset 40 pixels; surrounding pixels cannot become an edge trace. **Inspect suggestion/finding** focuses that region. Scroll or +/− zooms up to 16×, drag pans, and the **3× magnifier** shows the same verified image without overlays. **Hide overlays** or holding **H** reveals the photograph. **Expand image** retains the focused image point, permits Front/Back switching and **Return to pair**, and preserves completed unsaved traces. Proposal strokes remain thin at high zoom.

Future explicitly requested Astra analyses use four 739×993 crops per side at (0,0), (611,0), (0,865), and (611,865). They include the 40-pixel photo context already present beside each outer edge without resampling or changing the whole-side images. New V2 evidence records `cropLayoutVersion: inspection-context-v1`; absent markers preserve the exact legacy V1/V2 layout and hashes. A distinct builder/effect path selects the new layout only for a new analysis. Saved restoration uses its stored marker. Unknown/incompatible markers and outside-card contours reject. No migration, provider-prompt or provider-output-schema change, original-photo rewrite or automatic inference was needed.

## Qualification

The isolated branch started from the owner-specified checkpoint `67b4e8c9103a3e10409d47667eedcf1350dcaf71`. Three fresh gpt-6-astra/xhigh specialists implemented/reviewed the viewer, crop contract and independent regression/release evidence. Independent source and materialized release-action reviews found no blocking issue.

- Local workspace build and 81 workspace tests, nine parent integration checks, and 126 analysis/connected package tests passed. Independent checkpoint vectors preserve exact V1/V2 request/evidence/result hashes with and without reviewed memory.
- Real Chrome passed nine checks with zero page errors: padded geometry, focus, thin outlines at 10×/16×, expanded center retention, verified-image magnifier, keyboard/wheel, margin refusal, draft preservation and independently expected 8× panned trace coordinates. Root inspected focused/magnifier and expanded screenshots.
- Pixel tests verify every new crop pixel against independent source patterns and all four physical corners, including rejection of adjacent-margin traces.
- Exact Linux/amd64 Node20.20.2 / Next15.5.25 native image qualification passed source/boundary checks, 458 package tests and 59 staff tests, with no failures or skips. All 568 source files and 16 native artifacts were subsequently hashed inside the actual serving container. Dependency, native-photo, Prisma and SQL sources remain unchanged from the qualified base.
- Both offline PostgreSQL17.11 fixture groups passed 95 fixture-public/42 staff migrations and both no-op replays. Effective ACL checks covered 2,950 columns, 14 manual tables and six functions. The 23 memory/analysis groups include complete context-layout evidence restoration, immutability and background custody under unchanged migration42. Owned disposable clusters were stopped and their database files removed; production was not used for qualification.
- [All 14 CI jobs](https://github.com/MarkTenKings/tenkings-backend/actions/runs/35566957247) passed on the exact application source. Raw authenticated run/jobs evidence is retained; no predecessor CI result was substituted.

Synthetic image and contract checks establish interaction/pixel behavior, not optical grading accuracy. Owner review of physical-card detail, human corrections and learning acceptance, and separate final report approval remain open. Autonomous operation and completed slab finishing remain later milestones; SAM stays deferred.

## Observed release

| Item | Verified identity |
| --- | --- |
| Application source | `406466a089bdd2d34022bc8c06283a0649978b15` |
| Native image | `sha256:a5159e7478d87e4267e11433f68ba595d6d2e70c1968ad9754a53431fb47be4c` |
| 568-file source manifest | `0b1eaacb4a0e448a13869154d575916e8a235f56fa4b406ae2476bac9ebe4404` |
| Running private container | `195b416f29475183361c380b890d00d934af9f8cecfe6fc0cae207f40e2b2e5f`, started 06:24:51 UTC |
| Staff READY | `dpl_EmKqeZg4wN6PhVQX97DXc9BK71cC`, `atlas-grading-staff-7bmpf8r2c-ten-kings.vercel.app` |
| Public READY | `dpl_DnjnMSVL4fKPFsqR1gscuMvsifr5`, `atlas-grading-public-opgjndzha-ten-kings.vercel.app` |
| Access controls | StaffControl18 / STAFF SmsPilotControl16 |
| Binding configHash | `e9d83e9664c745297b73f9a5920428e18dc7ad41e219d8b4595040724ab95801` |
| Sealed action | `820c3d6b54573e6fa5ddeefb06536c18cd34a7b7e2627be6edc53cd25dbee41d` |

The new private configuration changed only source/deployment binding values. Existing keys, credentials, database pools, storage configuration, resource limits and network policies were preserved. The prior ada008 service exited gracefully, was detached and retained; the older incompatible source30d writer also remains stopped and detached. Caddy bytes/inode and all 39 other baseline containers are unchanged. No automatic rollback or replay was attempted.

Signed HTTPS preauthentication proof passed exactly unsigned401, absent-route404 and signed malformed-command400 using the actual application proxy. Exactly two existing control rows changed; all unrelated controls remained intact. One public promotion request was sent. A subsequent GET-only readback verified all four public aliases and the production target on the new build, retaining www→apex308.

Independent final host/DB verification passed once: restart0, no OOM/runtime errors, exact running source/native files, background worker connection observed, unchanged complete 42 staff and 97 successful/13 rolled-back public ledger rows, unchanged 14 manual history sets, original card revisions/analyses/identification and restricted ACL. The accepted background provider event remains one; no new paid request or card/review action was performed. This audit does not establish a fresh signed-in owner session; changed access bindings may require signing in again.

Final hosted checks passed ten routes and 48 current JavaScript/CSS assets (58 GET requests). Static build-manifest inspection found all 11 expected viewer markers, including 16× zoom, expansion, 3× magnifier, photo context and non-scaling outlines. Staff sign-in, anonymous CSRF/cookie boundaries, protected redirects, unauthenticated API refusals, customer delivery and www308 passed. The two anonymous session GETs can create browser/rate bookkeeping records; no SMS or signed-in session was requested. This is delivered-asset evidence, separate from the synthetic browser interaction tests.

## Evidence custody

Durable evidence root: `/Users/markthomas/.codex/atlas-handoffs/atlas-inspection-20260921/release-72e8/`. Browser interaction screenshots/results are in sibling `release-ui-qa/`. Original owner screenshots and prior release evidence remain retained.

Key receipts, SHA-256:

- Exact-source CI run/jobs: `5bc569756124d1379b1680876d3dc1c063bed7c1e3430293ae9ca0532d1bd191`.
- Private start: `12cc5d3364c015a83d45ec7aa3c6479c56dfc5732592b3811d427753474176d7`.
- Direct TLS proof: `7f8c4f02e5a6544fec51df9c0018c914eff4a928eaa0ad5a2fd25f1de7bcdc8a`.
- Exact two-control update: `cb36aec099053010f81a44ba563312ce5fc8569161ed1f3059816ce9b14d8826`.
- Final all-alias/production-target readback: `359ca23e6ca4a2b1791689b2d6f61b4f0497afe26b95e6ddf0cc7e39ef20c484`.
- Ten hosted routes: `bbf343997e2516b58550f273b30024fb8fb93389a718855a70e39723270a7b3a`.
- Forty-eight delivered assets/11 viewer markers: `da92c6e512f00e5709792f694a88e34f200b0b8c81c12a9cdeba3f75d68e652c`.
- Independent final host/DB summary: `d60d4f6219c75bf45148095016c8a271264096eefa45c4d98769529659ec4a19`.

All release helper intents are consumed. Future work must capture fresh evidence and create a newly reviewed action. The approved V2 blueprint was not changed.
