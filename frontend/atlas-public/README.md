# ATLAS public site and approved report reader

The separate Next.js project at `https://atlasgrading.com` serves the public homepage, dealer directory, customer capacity, and human-approved manual reports. Canonical `/admin` and `/account` requests retain their signed routing to the staff and customer projects.

## Reports and authority

The public app has no database client, database credential, Prisma generator, storage signer, or legacy report/media fallback. Its only report transport is the purpose-signed manual reader at `https://private.atlasgrading.com/api/internal/atlas/manual-public`. The private service checks the publication and deployment binding. The public server verifies the immutable packet's hash, mode, token, and approval version before rendering `ApprovedReportView`.

Versioned report links remain pinned to their approval; unknown or retired publications return 404. Failed configuration or integrity checks return a generic 503. Approved photograph and trace routes expose only exact published content. Image bytes are hash-verified and publication authority is rechecked after the read. Optional presentation images cannot replace the approved grading packet. Direct inspection access comes from the same signed manual reader. Responses use no-store, issue no session cookie, and carry no private notes or source references.

## Production configuration

Required names, without credentials: `NODE_ENV=production`, `VERCEL_ENV=production`, exact `VERCEL_URL`, `VERCEL_GIT_COMMIT_SHA`, `ATLAS_PUBLIC_RUNTIME=manual`, `ATLAS_PUBLIC_ORIGIN=https://atlasgrading.com`, `ATLAS_PUBLIC_MANUAL_ORIGIN=https://private.atlasgrading.com`, and a dedicated 32-byte base64 `ATLAS_PUBLIC_MANUAL_KEY`. The deployed `atlas-public-manual-reader-v1` configuration binding is preserved. Any retired public database/media variable or `ATLAS_LOCAL_` flag is rejected. There is no development database runtime.

Dealer and capacity reads separately use `ATLAS_CUSTOMER_SERVICE_URL` and `ATLAS_CUSTOMER_DIRECTORY_KEY`. Signed staff/customer route configuration is independent of report transport.

## Local qualification

Use Node 22. Run `pnpm --filter @atlas/public-app test` and `pnpm --filter @atlas/public-app build`; the build verifies the exact route manifest, browser boundary, and server dependency traces, including the absence of Prisma and the retired public-media client. Run `node frontend/atlas-public/scripts/smoke-production.mjs` after the build to test real Next HTTP responses from an unactivated production process.

`node frontend/atlas-public/scripts/manual-public-fixture.mjs` exercises the current publication and artifact readers, signed client and private handler over an owned loopback HTTP server, public report/image/trace reads, rendering, integrity failures, and revocation. It uses synthetic in-memory persistence and makes no provider or live database calls. The historical staff PostgreSQL harnesses call this current public qualification instead of creating an obsolete public database role or starting the retired public fixture runtime. Current database qualification belongs to the standalone database and manual publication fixtures.

## Marketing source

The current homepage packages only the brand/service experience and clearly identified concept art from `docs/atlas/design/experience`. Historical card packets, photographs, masks, fingerprints and report screenshots have been removed, including superseded generated homepage directories. The release metadata reports zero archived samples.
