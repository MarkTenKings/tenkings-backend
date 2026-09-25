# ATLAS iPhone queue incident — point-in-time read-only audit

At 2026-09-25 02:12:53 UTC, the read-only database census showed 12 cards and 24 verified original uploads. Twenty-one uploads had prepared source; Fronts 6, 7 and 12 did not. Each of those three exact original objects was subsequently read with checksum/size/binding verification, reproduced the live JPEG parser rejection locally, and passed the frozen candidate decoder without changing original bytes or full-resolution working pixels. Protected photos remain outside the repository.

All nine existing batch jobs were `NEEDS_ATTENTION`, not actively queued/running. The configured worker concurrency is two. This census does not support a claim of 50 simultaneous workers, a backlog actively consuming model calls, or browser quota exhaustion.

| Card ordinals | Jobs | Stop code | Interpretation |
| --- | ---: | --- | --- |
| 4, 10, 2, 8, 9 | 5 | `BATCH_GEOMETRY_NEEDS_REVIEW` | Geometry needs review; preserve the grading gate. |
| 1, 3 | 2 | `BATCH_IDENTITY_NEEDS_REVIEW` | Identity needs review; preserve the identity gate. |
| 5 | 1 | `DEFECT_ANALYSIS_ACTION_CONFLICT` | Pre-dispatch action conflict addressed by the release owner. |
| 11 | 1 | `PHOTO_STORAGE_UNAVAILABLE` | Storage read failed; removed unused batch preview reads and bounded storage retry are candidate changes, not proof of this specific historic cause. |

All nine jobs had `analysis_reserved=false`. The bounded time window contained zero defect-analysis runs and zero request-refusal rows. These facts describe this census window; they do not imply a provider-wide spending or usage total. The seven identity/geometry stops are meaningful quality gates and are not automatically approvals.

The supplied browser diagnostic is an earlier client view: 12 pairs, six upload-complete, six pending with retained photo references and a partial Front. It is consistent with browser interruptions and deferred preparation, but does not alone establish which server operation completed. Exact upload/card/source identities must drive recovery.

No queue rows, identity decisions, geometry, grading state or model dispatches were changed by this independent audit. Deployment, safe recovery and any subsequent queue state must be described using the release owner's later receipts. Sanitized point-in-time receipt: [queue census](../../../../validation/atlas-iphone-pipeline-20260925/queue-census-sanitized.json).
