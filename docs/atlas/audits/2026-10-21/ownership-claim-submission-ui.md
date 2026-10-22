# Ownership claim submission workspace

This is a local, disabled customer component with an injected client, state coordinator and synthetic qualification fixture. It registers no page or endpoint and supplies no business proof policy, retention period, reviewer grant, storage destination or current ownership. The existing claim-history files are unchanged. The separate proof/lifecycle foundation is documented in [ownership-proof-lifecycle-foundation.md](ownership-proof-lifecycle-foundation.md).

## Behavior

The workspace checks an exact certificate and current published binding, prepares metadata for unchanged original photographs, uploads originals and waits for confirmed retention, then requires an explicit claim submission. Preparation does not upload files, and retained files do not submit a claim. The client bounds file count, individual and total bytes, checks original SHA-256, and does not resize or re-encode proof. Accepted proof types and formats come from explicit trusted configuration.

Pending claims support replacement and confirmed withdrawal. Replacement retains the same claim ID, requires the exact next revision and preserves earlier history. Withdrawal remains available when new evidence submission or storage configuration is unavailable. A recorded submission or past verified decision is displayed separately from a fresh current-ownership result.

Lost mutation responses freeze conflicting inputs. Read-only recovery must match the exact request, source, file manifest, claim and revision; no automatic mutation retry occurs. An explicit retry after a missing recovery result preserves the same request and inputs. Ordinary HTTP failure is not treated as a proved rollback. Every refreshed bundle preserves its immutable account/source/policy/retention/file bindings and cannot reverse retained or consumed state.

Private state is memory-only. Account/access changes, unmount and pagehide abort work and clear references and files. Late replies from a prior account cannot repopulate the current workspace. Upload expiry, evidence access and scheduled deletion have separate UTC labels; the UI never claims that physical deletion has occurred.

## Qualification checkpoint

The initial eight-file increment passed 27 focused tests, scoped lint and two independent source reviews. Those reviews closed management-without-storage, immutable bundle refresh, recovery revision/bundle binding and uncertain-outcome wording findings.

Actual component/client/state browser qualification used synthetic in-memory transports and two generated 640×480 test drawings at `127.0.0.1:58618`. No authentication, database, storage provider, camera, ownership or production effect was available. Browser evidence is under `/Users/markthomas/.codex/atlas-handoffs/atlas-ownership-submission-20261021/browser-01/`, receipt SHA256 `8a6afe823d10968a6ec26e505a55d177b1c30f949767eef9b90fc2e1d6f78f32`.

Observed flows passed disabled defaults; two-original preparation/upload/explicit submission; withdrawal cancellation and confirmation; management without storage; lost-response recovery without another mutation; same-claim replacement from revision 1 to 2; delayed account-switch cleanup; ended access and fresh empty session; past verification without current title; visible keyboard focus; 46px primary buttons; and 320/390/1024/1440px layouts without horizontal overflow. Retention verification after a lost response preserved the original PUT count at one.

The first frozen preview had a harness-only Scenario select overflow at 320px; the product component fit. Preview-02 corrected only fixture CSS and verified 320px document width. Both packets remain intact. Both exact Node22 preview processes exited zero, port 58618 had no listener afterward, the browser tab was closed and viewport reset.

The browser finding is corrected: an interrupted upload no longer leaves stale “Uploading an original…” progress after the request ends. The two current-generation terminal state updates clear progress on success or failure without changing uncertain-request recovery. All 29 focused tests pass, including new state and actual-component regressions, and independent narrow review passes. Preview-03 repeated only the affected browser flow at320px: no stale text, no premature submission, explicit retention recovery and unchanged PUT count of one. Receipt `browser-02/evidence.json` SHA256 `a86f5f549cb5940b2fbdd6a84517c8a3e3f5b6516ae3dd34e00af7b48b49c5c2` records the correction. Exact server session51823 exited zero; port58618 closed, viewport reset and tab closed. Earlier packets and the original finding remain immutable.

## Remaining integration

Authenticated CustomerAuth/CSRF routes, a lifecycle-aware certificate/history reader, server-generated configuration, independent policy/reviewer authority, real conditional storage/CORS/retention, a qualified decoder sandbox and a deletion worker remain separate work. The existing v1 workflow reader must not be silently used for v2 withdrawn or replaced claims. No real claims are enabled by this component. Fingerprint comparison is a separate offline research path and grants no ownership or grading authority.
