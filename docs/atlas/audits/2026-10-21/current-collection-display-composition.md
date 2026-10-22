# Current collection display composition — local, default off

Date: 2026-10-22. This connects the existing current-owner reader, approved public evidence reader and display service to the customer HTTP dispatcher locally. It does not activate ownership or change production.

## Scope

The new `collection-display-composition.mjs` constructs one shared display service only under exact server flag `ATLAS_CUSTOMER_COLLECTION_DISPLAY=1`, actual CustomerAuth and the existing read-only ownership capability. Absent or malformed configuration remains private/unavailable with no fetch or ownership read; ordinary customer routes remain usable. No URL, credentials, SQL, grants or writer are introduced. The server-only `configuredForDisplay` boolean is a configuration hint, not authorization or proof of readiness.

The existing catch-all delegates only the exact card `display` and `display/front` GET paths before its general ingress branch. The display handler admits the original signed request once, buffers output, and rechecks captured auth, owner-reader object/method, router/config and original request after awaits. Current ownership is supplied exclusively by the existing reader. Approved public report/photo availability does not prove title.

The existing handler now propagates request abort and premature response close to the service's supported AbortSignal, removes listeners in finally, and emits no response after cancellation. The service remains shared across requests, preserving its two-read concurrency bound. This narrowly supersedes the earlier inactive display handler's acceptance bytes; it does not change the previously qualified display service, public reader, packet/image contracts, SQL or browser UI.

## Evidence

Envelope: `/Users/markthomas/.codex/atlas-handoffs/atlas-collection-display-composition-20261022/qualification-02/qualification.json`, SHA256 `9dea6f92a9ca1f4c61ec7db0940c3e192c405eeec0299729622bb25c0e8be8b2`. It retains five changed files, twenty explicitly selected service/test/boundary references and four evidence files. This is an explicit source list, not a full transitive module closure.

Node22.16.0 under OS-level network denial: all34 focused tests pass with zero skips; scoped lint is clean. The eight new routed tests cover default-off/unavailable versus ordinary session, exact metadata and Front through the real router/signer/handler/public adapter, strict request shapes, owner loss after public I/O, seven deferred authority/request changes, disconnects during owner and streamed-body waits, and the shared two-request admission limit. Existing display-service, approved-reader, collection-runtime and collection-routing suites are retained.

The first run is preserved:33 pass/one failure because the synthetic ordinary-session bootstrap omitted the actual required browserHash. Only that fixture response was corrected; the strict product checks were retained.

The ownership read and public stored-packet/image boundaries are synthetic. The test uses actual CustomerAuth, signed ingress, dispatcher, display service, fixed-host approved reader and public JSON handler, plus an actual decodable synthetic WebP. No database, listener, remote fetch, provider, browser or build ran in this qualification. Root owns later app composition/build and any release.

## Remaining limits

Deployment, installed restricted role/current title data, explicit optional configuration and real signed-in acceptance remain separate. This adds no proof policy, ownership mutation, offer delivery, grading action or pricing policy. All30 requirements and R1 remain open at their evidence-based statuses. Root has ownership of runtime/http for separate preferences wiring; later changes to those shared files require their own evidence rather than retroactively changing this saved qualification.

Root integration closure: independent detail review PASS on9dea6f92, all25 saved sources/four evidence; only current shared runtime/http differ through independently reviewed preference hooks. Combined customer370/370, production build and actual full-account1440/320 memory-preview acceptance pass. See collection-account-display-preferences-composition.md; no production activation.
