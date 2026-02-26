# System Contract

Last updated: 2026-02-26

## Current-State Reality (Evidence Snapshot)
1. Flat variant model is canonical today:
   - `CardVariant(setId, cardNumber, parallelId, parallelFamily, oddsInfo)`
2. Checklist section/program labels are often ingested into `parallel`.
3. Option pool and matcher consume `parallelId` as a mixed label bucket.
4. `insertSet` and `parallel` are separate UI fields, but backend semantics still overlap.
5. Replace diff identity still uses `cardNumber::parallelId`.

## Core Problem
Three different concepts are mixed in one field family:
1. Program/Card Type (Base, Daily Dribble, etc.)
2. Variation (Golden Mirror, Clear, etc.)
3. Parallel (Blue /150, Gold /25, etc.)

This causes picker noise, match ambiguity, and weaker comp-query precision.

## Target Architecture
### Taxonomy Core Entities
1. `SetProgram` (card type/menu item)
2. `SetCard` (card number + player under program)
3. `SetVariation`
4. `SetParallel`
5. `SetParallelScope`
6. `SetOddsByFormat`
7. `SetTaxonomySource` (provenance)
8. `SetTaxonomyConflict`
9. `SetTaxonomyAmbiguityQueue`

### Compatibility Bridge
- Keep `CardVariant` operational during migration.
- Dual-write or projection path to avoid workflow breakage.
- Promote V2 reads only after parity thresholds pass.

## Identity and Scoping Rules
1. Canonical key:
   - `setId + programId + cardNumber + variationId? + parallelId?`
2. Variation applicability is scoped by program.
3. Parallel applicability is scoped by program + optional format/channel.
4. Unknown combinations are invalid unless explicitly approved.

## Source Precedence Rules
1. official checklist
2. official odds
3. trusted secondary
4. manual patch

If conflicts remain after precedence, create conflict records and require human resolution.

## Adapter Strategy
- Shared normalization contracts; brand-specific parser adapters.
- Adapters can differ in extraction shape, but must output common taxonomy payload.
- Start with Topps adapter (checklist + odds), then expand.

## Runtime Consumer Expectations
1. Add Card uses scope-gated pickers.
2. Matcher candidate generation filters by program/card/scope first.
3. KingsReview query builder composes structured tokens in deterministic order.
4. Replace and seed workflows use canonical identity.
