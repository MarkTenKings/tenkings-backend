# UX Contract

Last updated: 2026-02-26

## UX Objective
Simplify Workstation 2 without losing capability.
Primary strategy: keep powerful operations, reduce cognitive load via structure, context, and progressive disclosure.

## Information Architecture

## Workstation Nav
1. Overview
2. Ingest & Draft
3. Variant Studio
4. AI Quality

## Context Model
Persist in URL where applicable:
1. `setId`
2. `programId`
3. `jobId`
4. `tab`
5. `queueFilter`

## Page Blueprints

## Overview
Purpose:
- Set-level control center.

Blocks:
1. Summary cards
2. Set table
3. Row action panel links
4. Replace panel
5. Delete danger panel

## Ingest & Draft
Purpose:
- Guided operator workflow.

Stepper:
1. Source Intake
2. Ingestion Queue
3. Draft & Approval
4. Seed Monitor

Rules:
1. One expanded step by default.
2. Completed steps collapse unless reopened.
3. Show only controls needed for current step.

## Variant Studio
Subtabs:
1. Catalog Dictionary
2. Reference QA

Catalog Dictionary blocks:
1. Definition editor/import tools
2. Scope rules and odds metadata
3. Searchable table

Reference QA blocks:
1. Queue filters and stats
2. Variant queue table
3. Reference image card grid
4. Batch action bar

## AI Quality
Blocks:
1. Eval gate + latest run
2. Gold eval case management
3. Telemetry and correction trends
4. Attention queue with deep links to workstation tasks

## Interaction Rules
1. Avoid full-page modals for long workflows.
2. Use side panels/drawers for replace/delete details.
3. Keep destructive actions visually isolated.
4. Explain disabled actions with reason text.
5. Keep status vocabulary consistent:
   - `Queued`, `Review Required`, `Approved`, `Seeding`, `Complete`, `Failed`

## Permission UX
1. Role badges visible in header.
2. Action disabled if role missing.
3. API remains authority; UI is guidance.

## Taxonomy V2 UX Semantics
All taxonomy-aware forms must use clear separate fields:
1. Card Type/Program
2. Variation
3. Parallel

No label should be presented as both card type and parallel in the same context.
