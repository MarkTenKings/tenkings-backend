# Quality and Ops Contract

Last updated: 2026-02-26

## Test Matrix

## Unit
1. Canonical identity key generation.
2. Scope resolver behavior.
3. Precedence conflict resolution.
4. Ambiguity queue routing.

## Integration
1. Checklist + odds merge per set.
2. Draft validation and approval gating.
3. Replace preview/diff parity using canonical key.
4. V2 picker constraints.

## End-to-End
1. Ingest -> Draft -> Approve -> Seed flow.
2. Variant QA batch actions.
3. Add Card suggestion quality with scoped pickers.
4. KingsReview query output correctness.

## Regression Set Pack
Keep at least one hard set (known label complexity) for every release.

## Key Metrics
1. Draft blocking-error rate.
2. Manual correction rate in Add Card.
3. Wrong-label rate in final metadata.
4. Query relevance proxy for KingsReview.
5. Ingest-to-seed completion time.
6. Seed/replace failure rates.
7. Ambiguity queue backlog size.

## Parity Gates Before V2 Cutover
1. Option pool parity vs legacy path.
2. Matcher top candidate parity within accepted variance.
3. Query builder output parity or measured relevance gain.
4. No critical regression in operator workflow time.

## Deployment and Rollback
1. Deploy behind flags.
2. Run smoke tests on each workstation route.
3. Validate one rollback per release train before production.
4. If incident, disable newest flag and return to legacy route path.

## Runbook Alignment
Use these source-of-truth docs for operations:
1. `docs/runbooks/DEPLOY_RUNBOOK.md`
2. `docs/runbooks/SET_OPS_RUNBOOK.md`
3. `docs/handoffs/SESSION_LOG.md`

## Evidence Logging
For each phase release, capture:
1. commit hash
2. enabled flags
3. smoke-test results
4. metric deltas
5. rollback status (tested/not tested)
