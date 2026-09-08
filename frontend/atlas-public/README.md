# ATLAS approved report reader

A separate Next.js project for `https://atlasgrading.com`, with only `/`, `/reports/[token]` and a plain 404. Staff remains `frontend/atlas-app` at `app.atlasgrading.com`. No staff authentication, grading write, third-party tracker, legacy wrapper or raw storage signer is bundled here.

## Data and authority

The public serving credential receives schema USAGE and EXECUTE on exactly `atlas_staff.read_approved_report(text,integer,text,text,text)`. It receives no table/column/sequence privileges, including private analyses and the immutable approval table. Every read verifies effective privileges and the exact public deployment/release/configuration activation. The public activation is operator-owned and independent of staff availability. All schema migrations remain under `frontend/atlas-app/prisma/migrations`; this project's minimal Prisma schema generates its own read-port client only and is not a migration authority.

The function returns only an immutable approved public packet and digest. The server verifies its hash and strict `@atlas/report-view/public-contract` schema before rendering the shared report component. No source canonical, original trace body, Memory exemplar, staff identity, session, assignment or private note is public. A versioned `?v=1` link remains pinned to that approval after later drafts/approvals; an unversioned link selects the latest approval. Unknown tokens/versions return 404. Configuration or integrity failures return a generic 503. Responses set no cookie and use no-store so activation changes apply on a fresh request.

This initial reader renders identity, subgrades, centering and approved measured findings. Public photographs/trace inspection still require the exact approved-evidence adapter. It does not attest NFC programming, physical assembly or welding.

## Production configuration

Activation is absent by default. Required names, without credentials: `NODE_ENV=production`, `VERCEL_ENV=production`, exact `VERCEL_URL`, `VERCEL_GIT_COMMIT_SHA`, `ATLAS_PUBLIC_RUNTIME=postgres`, `ATLAS_PUBLIC_ORIGIN=https://atlasgrading.com`, and dedicated `ATLAS_PUBLIC_DATABASE_URL` with schema `atlas_staff` and required TLS. `PublicReaderControl` must match the exact release/configuration hash. The URL/credential binding participates in that hash. Copied fixture flags, preview URLs and staff origins cannot activate this app. No live configuration, database role or domain has been created by this implementation.

## Local validation

Run `node frontend/atlas-app/scripts/local-postgres.mjs --ack-disposable-local-postgres --postgres-bin <owned PostgreSQL bin> --pg-module <pg module>` from a scrubbed environment after generating both clients and building the grading core. The harness creates its own isolated PostgreSQL cluster, applies the entire unchanged public chain and additive staff chain, proves second deploys are no-ops, seeds only synthetic cards, and tests both apps on loopback 4318/4319. Add `--serve` to inspect after checks; SIGTERM stops only its owned children/cluster. It refuses environment files and existing database configuration. Fixture keys stay in an ownership-bound 0600 temporary configuration file; production cannot load it.

Current acceptance: 31 database scenarios; 21 actual HTTP/SSR checks with both web processes restarted; a browser reviewer save/approve/public-display check; public/staff host and production-denial checks. Built boundary scripts inspect actual route manifests, browser bundles and server traces. Synthetic tests establish workflow behavior, not grading accuracy or operational readiness.
