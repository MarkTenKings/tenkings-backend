# Approved evidence transport for My Collection

Status: locally qualified; not deployed or activated. Production remains the photo release `f0fd4f15`.

The new public `GET/HEAD /api/reports/:token?v=:version` returns only the parsed, hash-checked public report packet already embedded in that exact public report page. It uses the existing public reader and ingress. It introduces no publication, grading, storage or database authority. Unsupported methods, noncanonical paths and unversioned requests are rejected. Responses are bounded to 8 MiB and not cached.

The optional customer server adapter reads that fixed public endpoint and the existing approved Front image endpoint. It sends no customer cookie or service credential, follows no redirects, limits decoded bytes, and observes a 20-second abort deadline. The existing collection display service independently checks the current owner before and after reads and validates the exact approval, packet hash and WebP hash/dimensions. The adapter is absent by default; customer composition is a separate increment.

Qualification under `/Users/markthomas/.codex/atlas-handoffs/atlas-collection-approved-reader-20261022/qualification-02/`:

- Eight focused tests passed under OS network denial, including the new endpoint through the customer adapter and existing display service, deferred request mutation, cancellation, strict routes and response bounds.
- Scoped lint passed. Independent collection-lane source review passed; its sole required exact route allowlist addition is included.
- Public production build and build boundary passed: 15 server traces, 727 traced files checked, zero database engines, staff routes or write routes. Customer production build also passed alongside the optional collection components/runtime.

Tests use synthetic approved packets and an actual decodable WebP, with injected responses. They do not establish production DNS/gateway behavior, live ownership grants or real-card storage acceptance. No network request, deployment, migration, production write or grading change was made for this qualification. The full source and evidence hashes are in `qualification.json` beside the logs.
