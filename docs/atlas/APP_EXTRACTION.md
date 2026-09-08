# ATLAS application extraction design

Status: local extraction design and historical source inventory. The [boundary manifest](../../frontend/atlas-app/boundary-manifest.json) remains design-only. A later [staff application foundation](../../frontend/atlas-app/README.md) now implements synthetic local sign-in, an assigned review queue and Front/Back draft workspace with its own built-route/dependency checks. Production adapters, provider configuration and live access remain unavailable; the proposed future route roster below is not mounted wholesale.

Source baseline: `7bde06f65959e376e12725186d605cc91c67852b`, reviewed September 7, 2026. The manifest records 42 current route files and direct dependencies for 90 selected modules. Imports include type-only and literal dynamic imports; this is a targeted source inventory, not proof of the full executed dependency graph or current provider state.

The owner-approved [V2 blueprint](../specs/TEN_KINGS_V2_FINAL_MASTER_BLUEPRINT.md) remains the Ten Kings product authority. This design applies the subsequently approved ATLAS separation direction to hosting, interfaces, and preparation. It does not change the blueprint's permanent card identity, commercial scope, human authority, or rollout gates.

## Deployment boundary

The target is a dedicated staff application at `frontend/atlas-app`, in a separate ATLAS Vercel project serving `app.atlasgrading.com`. It exposes only grading, assigned evidence, human review, and explicitly approved finishing operations. Build a separate minimal public application from the public route manifest for `atlasgrading.com`; `frontend/atlas-public` now implements the initial approved-report reader with its own client, activation and read-only database function. Its six-page built boundary excludes staff/write routes and legacy dependencies; actual runtime activation remains absent. Public and staff projects can then release independently while sharing reviewed packages in the same repository.

The owner's unfinished consumer-facing GPT Pages draft is a separate future public-site input; it has not been imported or reviewed. Initial staff access follows the [phone-verification and admin-allowlist decision](STAFF_ACCESS.md). The draft does not determine the private grading interface.

One ATLAS project serving both hosts is a smaller optional first deployment. It requires the same exact per-host route allowlists, with staff APIs denied on the apex and host-only staff sessions. That option separates ATLAS from Ten Kings, but its public and staff surfaces share one artifact, environment, and release impact. It must not be described as public/staff deployment isolation.

Adding an ATLAS alias to the existing full Ten Kings application does not establish this boundary. Neither does copying the existing Next app into another directory. The new builds contain only their listed pages and adapters; every unlisted host, path, method, and action is denied. The existing Ten Kings application and all issued public URLs remain available during preparation.

## Current sources and proposed ownership

All paths in this table are under `frontend/nextjs-app` unless otherwise stated. The JSON manifest expands the routes, actions, and direct import paths.

| Current source | Extraction decision | Proposed owner or target |
|---|---|---|
| `pages/admin/ai-grader-v2.tsx` | Extract grading UI; replace page wrapper, session, network calls, and publication authority | Staff `/grading` |
| `pages/card-maps.tsx` | Reuse reviewed editor widgets; maintain separate human map authority | Staff `/card-maps` |
| `pages/admin/ai-grader-v2/completed/*` | Separate card reads from identity correction, voiding, presentation, comps, NFC, and label actions | Staff `/cards` and `/cards/[sessionId]` |
| `pages/admin/ai-grader-v2/{removed-findings,learning-blueprint}.tsx` | Extract bounded read-only audit projections | Staff `/audit/removed-findings` and `/audit/learning` |
| `pages/c/[token].tsx`, `pages/ai-grader-v2/reports/[slug].tsx`, and public trace API | Extract shared public renderer and DTO; replace server reads and route/metadata configuration | Public `/c/[token]`, `/reports/[slug]`, and `/api/reports/[slug]/trace` |
| `pages/api/admin/ai-grader-v2/*` | Rebuild explicitly scoped handlers around approved ports; never import the legacy handlers | Staff API manifest |
| `pages/api/admin/ai-grader-v2/sessions/[sessionId]/complete-label.ts` | Keep current authority intact; design a separate human review/issuance integration | Trained human certification boundary; no machine proxy |
| `pages/admin/comps.tsx`, `pages/api/v2/admin/comps/[...action].ts` | Separate research candidates from permanent-card value confirmation and public visibility writes | Bounded sold-evidence broker; Ten Kings card writer for authorized legacy cards |
| `pages/admin/nfc.tsx`, `pages/api/v2/admin/nfc/[...action].ts` | Keep legacy until the origin, signed-job, helper, and permanent URL contract is explicitly approved | Future NFC adapter; absent from initial ATLAS routes |
| `pages/admin/human-grade.tsx`, `pages/api/admin/human-grade/*` | Keep mixed HUMAN/SPEEDSTER queue and issuance in Ten Kings | Only exact source-linked Speedster label reads/reprints may be adapted |
| V1 `/ai-grader`, `/nfc`, `/claim`, pack, collection, wallet, kiosk, and support routes | Keep legacy; do not mount in either ATLAS application | Ten Kings |

The new runtime cannot import a legacy page or API handler, `requireAdminSession`, `useSession`, `buildAdminHeaders`, `lib/api.ts`, `AppShell`, or `QueenWidget`. Current wrappers are not neutral utilities: `_app.tsx` mounts Queen and contains Stripe integration; `useSession.tsx` carries wallet state and a JavaScript-readable Ten Kings bearer; `lib/api.ts` knows auth, wallet, vault, pack, marketplace, pricing, ingestion, and vending services.

## Dependency extraction

Keep one implementation of proven grading math, pixel geometry, identity validation, trace codecs, inspection frames, report presentation, and label dimensions. Extract these through explicit package exports after their dependency closure is reviewed; do not copy a second scoring engine or use a broad `@tenkings/shared` barrel as the new interface.

The principal candidates are `lib/ai-grader-v2/{contracts,identity,geometry,scoring,color-geometry,inspection-frame,trace-codec,trace-bitmap-wire,review,review-findings}.ts` and their exact manifest dependencies. Components under `components/ai-grader-v2` can receive transport and authority ports instead of importing auth. `CaptureWorkspace.tsx` and `SpeedsterTrainWorkspace.tsx` currently import `adminHeaders`; their extraction is conditional on removing that coupling.

`map-filter.ts` imports `SpeedsterLoadedMapRevision` from `lib/server/speedsterCardTypeMaps.ts` as a **type-only** dependency. Move that DTO into neutral contracts before declaring a closed shared package. It is not evidence of a runtime Prisma import. Learning helpers using `node:crypto` need a separate server entry point; deterministic calculation does not grant permission to update a learning bank.

Keep server effects behind narrow ports. `lib/server/aiGraderV2*` and `speedster*` contain a mixture of pure helpers, database mutations, storage signing, worker requests, and human decisions. The manifest classifies these as refactoring sources, not approved import roots. Preserve the single signed worker under `backend/ai-grader-speedster-service`; the app split does not require a duplicate SAM service or any model/GPU fallback.

The current permanent-card writer is `packages/database/src/cardPlatformV2.ts`. `packages/database/src/index.ts` also exports unrelated legacy services and raw Prisma. ATLAS routes and machine tools must receive named, typed ports; only the dedicated data adapter may reach narrowly reviewed database functions. It must never return a transaction object, Prisma client, arbitrary filter, SQL string, broad admin session, or arbitrary storage signer.

The current sold-comps implementation is `packages/ebay-sold-comps-v2/src/index.ts` plus `lib/server/compsV2.ts`, using SoldComps and `SOLDCOMPS_API_KEY`. The older approved blueprint describes SerpAPI. This source distinction is recorded here; extraction neither switches providers nor represents the blueprint's provider description as current runtime evidence. Keep pure query/ranking/selection calculations separate from provider access and card-value writes.

## Temporary authoritative data access

Keep the existing database and evidence objects temporarily. Do not duplicate grades, labels, certificates, Card Maps, Memory, media, tokens, or ownership histories. The proposed ports in the manifest cover public report reads, assigned evidence reads, preparation proposals, human review, heritage cards, exact-object storage, admitted workers, and sold evidence. None is implemented here.

Every private operation must bind a server-assigned card, run, evidence revision, action, and actor. Current records do not provide a complete ATLAS product/assignment discriminator. The implementation must establish exact assignment and a stable mapping to any existing legacy subject before accessing private data. An email address, a client-selected `userId`, or possession of a public token cannot create that mapping.

A wrapper around a broad shared credential is not database or storage isolation. Before live use, establish and verify least-privilege grants or an authenticated adapter boundary that enforces the permitted resource and operation. Until then, only synthetic/offline adapters are eligible. Any later role, view, function, assignment, or issuer schema change is separately reviewed and coordinated with the authoritative card writer and Vault work; no Prisma or migration change is proposed as an incidental app build step.

Current `complete-label` does more than certify: it completes the session, issues the linked `TKH` label, calls `createCardFromSpeedster`, and performs learning work. That writer creates a `tk2c_` permanent card with `HOUSE` ownership. ATLAS grading must not silently mean Ten Kings house inventory. The contract for new ATLAS issuance, its certificate namespace, and any deliberate Ten Kings house-card handoff remains an owner decision. A new route or machine proposal does not authorize calling the legacy completion handler.

## Human, machine, and capture authority

Staff authentication belongs to `app.atlasgrading.com`. The proposed session is a host-only `__Host-atlas_staff` cookie with `HttpOnly`, `Secure`, `Path=/`, and `SameSite=Lax`, with no `Domain` attribute. All writes also validate the exact trusted Origin and a session-bound CSRF token. The issuer, audience, expiry/revocation, roster, and assignment are server-owned. Public pages receive no staff cookie or authority. A separately reviewed identity federation could reuse an identity provider, but copying Ten Kings tokens or its admin allowlist is not federation.

The initial identity provider is proposed as Twilio Verify with a separate ATLAS verification context and an owner-managed `ATLAS_ADMIN_PHONES` allowlist. [STAFF_ACCESS.md](STAFF_ACCESS.md) specifies challenge binding, session issuance, revocation and the remaining live-configuration gates. Neither this decision nor the manifest implements authentication.

Certification review and trusted-learning approval require distinct fresh trained-human decisions bound to the exact evidence/package revision. Machine credentials are short-lived server-to-server capabilities bound to a principal of kind MACHINE, assigned card/run, tool, evidence revision, operation, expiry, budget, and lease fence. They never share a human bearer or cookie and have no fallback to the existing admin service.

The manifest proposes one explicit POST path for each of the 14 tools in [`packages/atlas-contracts/src/contracts.mjs`](../../packages/atlas-contracts/src/contracts.mjs). These paths are **not registered**. The local schemas are offline contracts, not live authentication, resource authorization, provider integrations, or operational approval. In particular, `render_review_draft` allocates no certificate and publishes nothing; `submit_for_human_review` approves neither certification nor trusted lessons. The model can propose geometry and finding changes; deterministic code validates and measures, and human authority remains separate.

Capture has its own capability boundary. `workers/speedster-iphone-capture/src/index.mjs` currently hardcodes the Ten Kings upload API, and the hosted code binds device/session/upload version and Front/Back checksums. A future ATLAS adapter must preserve those exact bindings, bounded direct uploads, original evidence, and prepared-generation revision fencing. Origin or hostname alone is not device authority. Do not broaden CORS, permit arbitrary upstreams, accept caller URLs, or add public/private storage fallback.

Ten Kings browser drafts and NFC active-operation state live in origin-scoped storage. Finish or export/reconcile them before any host cutover; do not transfer bearer tokens. NFC additionally fixes `collect.tenkings.co` in both hosted and helper protocol authority. Its versioned origin/trust change, re-pairing, and supervised physical acceptance are separate future work. The native NFC and capture helpers remain outside Next/Vercel.

## Heritage reports, labels, and physical links

Preserve the exact session/report slug, label ID/source/session link, certificate number and sequence, card ID/token, persisted grade, source evidence hashes, and historical map/learning records. An ATLAS public alias can render that same legacy record using its heritage identity; it must not mint a replacement or rewrite an issued URL. Unknown, private, malformed, or VOID records retain a plain not-found result without exposing private metadata.

Extract the public report renderer from its route and server loader without recomputing saved grades. Keep a versioned heritage label renderer and its hashed font/crown assets. `humanGradeLabelRenderer.ts` currently finds assets relative to the old app's working directory; packaging needs an explicit frozen asset location. It must preserve historical layout/content and certificate identity. New ATLAS wordmarks, metadata, printable templates, public report copy, and issuance rules need their own approved version; no global string replacement is appropriate.

Existing `/c/tk2c_...`, V1 NFC, QR/claim, and public report links continue resolving on Ten Kings. No blanket redirect is part of extraction. Static card links remain convenient report links, not ownership or cryptographic authenticity credentials. Public contact, legal, and grading-standard pages require ATLAS-approved copy; existing wallet/vending terms do not become ATLAS terms.

## Environment, release, and monitoring

Define an independent ATLAS environment schema; the manifest lists source variable names and proposed new namespaces without values. Allocate purpose-specific auth, adapter, storage, worker, and receipt configuration only after operational approval. No wholesale copy of the existing environment, `NEXT_PUBLIC_*`, Twilio, Stripe, Mux, Queen, operator key, NFC signer, or service credentials. Purpose-separated receipt keys remain distinct. Preview/local builds use synthetic data and provider stubs, without Production writers, signers, email, payment, or hardware authority.

The workspace already includes `frontend/*` and `packages/*`. A future minimal ATLAS package can fit those boundaries; this artifact changes no root package or lockfile. Do not use `scripts/vercel-build.sh` as the new ATLAS build command: it targets the legacy app and includes a migration gate. Give each ATLAS project a specific build target, one reviewed Next configuration, environment scope, and release policy. Shared package changes must trigger both ATLAS and affected Ten Kings compatibility checks.

Bind a release to source commit, contract/rule/renderer versions, capture protocol, compatible data schema, and the admitted worker artifact/model/checkpoint/GPU/determinism policy. Web health alone does not prove worker or provider readiness. Private operational signals should cover stage failures/latency, queue age, lease expiry, retries and unknown outcomes, human review wait, budget reservations, provider readiness, receipt mismatch, and capture integrity conflicts. Log safe references and normalized outcomes; exclude customer/owner data, credentials, signed URLs, raw storage keys, and raw provider payloads.

An app rollback selects a retained compatible artifact; it does not undo records, external provider configuration, DNS, auth, or email. Pause new work and reconcile in-flight stages before changing the serving artifact or capture origin. Preserve all issued records and URLs, and follow the existing roll-forward rule for retired Color Geometry/worker artifacts.

## Phased implementation and acceptance

1. **Boundary preparation — this change.** Review route ownership, explicit dependency edges, offline machine contracts, and unresolved issuance/assignment decisions. Acceptance is a parseable source manifest with no changes to legacy routes, root lock, Prisma, or infrastructure. The lead owns validation and the session-log entry.
2. **Extract reusable modules and add synthetic app entry points.** Move one implementation behind explicit browser/server exports, isolate report rendering, inject transport ports, and build only the staff/public allowlists. Prove the new bundle excludes legacy auth, pages/handlers, wallet/packs/Vault/payments, Queen, and hardware code. Validate the manifest against built routes, including unexpected future routes. No provider secrets or operational adapters yet.
3. **Implement scoped adapters and human authority.** Use the preparation contracts with durable revisions/assignment fences and fresh human approval; separate certification from trusted learning and commercial writes. Establish exact access controls, receipt admission, original/prepared evidence integrity, and resource budgets. Test adversarial cross-host, cross-principal, cross-card, stale-revision, public/private/VOID, and machine-certification/learning/payment cases. Preserve current Ten Kings behavior and heritage rendering.
4. **Prepare the operational cutover for approval.** Present concrete project/env/auth/capture/CORS/DNS/TLS/monitoring changes, an exact affected-resource list, cost cap, canary, and compatible rollback plan. Only after separate approval create provider resources or change origins. Drain existing work, reconcile local drafts, prove one authoritative writer, and perform the specifically approved supervised canary. Do not treat a local app build as deployment approval.
5. **Separate remaining data ownership only when justified.** After the app and adapter boundaries work, decide whether separate credentials, schema/storage ownership, public/staff projects, or a repository extraction improve actual ownership and reliability. Preserve identifiers and the single write path. A repository split is optional and does not substitute for these boundaries.

The immediate unresolved gates are the ATLAS issuer/certificate policy, stable assignment and legacy-subject mapping, least-privilege adapter enforcement, repaired prepared-evidence and worker admission safeguards, and explicit human-only certification/learning boundaries. These do not block the current local design or offline evaluation.

## Implemented canonical grading extraction — 2026-09-08

`packages/atlas-grading-core` now owns the eight byte-identical canonical sources listed in its extraction manifest: contracts, trace codec, identity, card-map contracts, geometry, scoring, review finding parser and review calculation. Existing frontend paths forward to these sources. The closed runtime dependency is zod 4.1.11; build tooling uses the already locked esbuild 0.27.7. The new report content adapter recomputes from confirmed quads and persisted measured findings, preserves draft review states and emits a strict presentation projection. It grants no approval, publication or learning authority. Async scan/re-measure callbacks remain explicit caller-supplied ports; the full current review service and release/Memory admission are still required for actual grading.

At this milestone the canonical extraction passed 191 existing regression tests, five report/integrity tests, strict TypeScript checking and the combined legacy build. Staff persistence/approval/real capture service integration remains subsequent work. This note supersedes the earlier design-only statement for these exact modules only; the broader manifest is still an extraction inventory, not a mounted runtime route roster.

## Current mounted implementation — September 8, 2026

The dedicated staff and public apps, durable staff authority, immutable report approval/publication and purpose-scoped private grading bridge now implement the corresponding boundaries in this earlier design inventory. See [COMPLETION.md](COMPLETION.md) for current evidence and remaining scope. The bridge preserves real source session/creator identity, current prepared-evidence admission, full review service and atomic source/ATLAS analysis commit. It accepts only current signed staff scope and a durable operation; it grants no administrator session or generic SQL/storage/provider tool. Its independent activation and the real preparation release remain inactive.

The trace bitmap wire and trace editor have also moved byte-identically into the canonical core, bringing the unchanged source inventory to ten modules and the built entry count to twelve. Legacy imports still forward to the originals. The public presentation allowlist now retains the existing 180-character finding/source-view limit. Human correction controls preserve removed findings for later restore, remeasure every change and reset the final-review checklist. Pilot budgets, held reservations and durable execution claims are implemented, separately versioned from mathematical grading admission. Astra machine execution, public approved images, operator intake, trusted learning and NFC/physical finishing remain in progress.

Owner clarification resolves initial ATLAS issuance as a human-approved, versioned ATLAS graded report with a permanent ATLAS report number and public URL. It does not call the legacy complete-label writer or create Ten Kings HOUSE/PACK ownership. Label/NFC output binds that exact approved report version; physical slab completion remains separate. Earlier unresolved-issuer statements above describe the original design baseline and are superseded by this owner-approved report policy.
