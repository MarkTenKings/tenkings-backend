# Live database inventory

Read-only observation: 2026-09-11T19:02:57.139063+00:00. PostgreSQL 17.11; database bytes 2,139,461,299; max connections 25.

This lists ordinary tables observed in the three relevant schemas, including migration ledgers. Estimated rows are PostgreSQL statistics, not exact counts; -1 means unavailable. Table bytes include table/TOAST storage and are not a measurement of live payload size or proof of bloat. Trigger counts exclude internal FK triggers; multiple trigger instances can share a name/function.

See [architecture groups and rules](architecture-rules.md) for the purpose and flow of these stores. Exact source column contracts are in `frontend/atlas-app/prisma/schema.prisma`, `frontend/atlas-customer/prisma/schema.prisma`, `packages/database/prisma/schema.prisma` and their migration histories.

## atlas_staff: 59 tables

| Table | Columns | Estimated rows | Table MiB | Index MiB | Triggers |
| --- | ---: | ---: | ---: | ---: | ---: |
| `PublicMediaControl` | 10 | -1 | 0.008 | 0.008 | 3 |
| `PublicReaderControl` | 9 | -1 | 0.008 | 0.008 | 3 |
| `SmsPilotControl` | 17 | -1 | 0.016 | 0.031 | 3 |
| `SmsPilotReservation` | 15 | -1 | 0.047 | 0.031 | 2 |
| `StaffAnalysisRevision` | 14 | -1 | 0.008 | 0.023 | 4 |
| `StaffApprovedImage` | 4 | -1 | 0.008 | 0.008 | 3 |
| `StaffAssignment` | 6 | -1 | 0.000 | 0.016 | 3 |
| `StaffAudit` | 6 | 52 | 0.070 | 0.047 | 9 |
| `StaffBrowser` | 4 | -1 | 0.008 | 0.031 | 1 |
| `StaffChallenge` | 18 | 14 | 0.047 | 0.062 | 5 |
| `StaffControl` | 10 | -1 | 0.016 | 0.016 | 2 |
| `StaffGradingBridgeControl` | 13 | -1 | 0.016 | 0.016 | 3 |
| `StaffGradingExecution` | 12 | -1 | 0.008 | 0.023 | 8 |
| `StaffGradingOperation` | 22 | -1 | 0.008 | 0.031 | 9 |
| `StaffIdentity` | 10 | -1 | 0.016 | 0.031 | 3 |
| `StaffIdentityCorrection` | 46 | -1 | 0.008 | 0.039 | 5 |
| `StaffIdentityCorrectionControl` | 12 | -1 | 0.008 | 0.008 | 4 |
| `StaffIntakeControl` | 11 | -1 | 0.008 | 0.008 | 3 |
| `StaffLabelIssue` | 13 | -1 | 0.008 | 0.031 | 5 |
| `StaffLearningCandidates` | 27 | -1 | 0.008 | 0.023 | 5 |
| `StaffLearningControl` | 12 | -1 | 0.008 | 0.008 | 4 |
| `StaffMachineInitialization` | 30 | -1 | 0.008 | 0.031 | 6 |
| `StaffNfcControl` | 11 | -1 | 0.008 | 0.008 | 3 |
| `StaffNfcJob` | 19 | -1 | 0.008 | 0.039 | 5 |
| `StaffNfcVerification` | 19 | -1 | 0.008 | 0.047 | 5 |
| `StaffOperation` | 6 | -1 | 0.000 | 0.008 | 2 |
| `StaffOperationalResolution` | 17 | -1 | 0.008 | 0.031 | 3 |
| `StaffOperationsGrant` | 13 | -1 | 0.008 | 0.016 | 3 |
| `StaffOperatorAttempt` | 19 | -1 | 47.242 | 0.062 | 12 |
| `StaffOperatorAttemptAbandonment` | 15 | -1 | 0.008 | 0.023 | 4 |
| `StaffOperatorControl` | 11 | -1 | 0.047 | 0.016 | 3 |
| `StaffOperatorImage` | 6 | -1 | 0.062 | 0.016 | 4 |
| `StaffOperatorImageControl` | 10 | -1 | 0.016 | 0.016 | 3 |
| `StaffOperatorImageDelivery` | 5 | -1 | 0.008 | 0.016 | 4 |
| `StaffOperatorOutbox` | 12 | -1 | 0.008 | 0.016 | 4 |
| `StaffOperatorReceipt` | 5 | -1 | 0.117 | 0.031 | 5 |
| `StaffOperatorRecovery` | 11 | -1 | 0.016 | 0.062 | 4 |
| `StaffOperatorRun` | 33 | 3 | 77.586 | 0.094 | 10 |
| `StaffOperatorStep` | 12 | -1 | 0.047 | 0.062 | 7 |
| `StaffPhysicalFinish` | 16 | -1 | 0.008 | 0.047 | 5 |
| `StaffProposalDecision` | 16 | -1 | 0.008 | 0.023 | 4 |
| `StaffPublicReport` | 5 | -1 | 0.000 | 0.031 | 3 |
| `StaffRateBucket` | 3 | 8 | 0.039 | 0.031 | 0 |
| `StaffReportApproval` | 18 | -1 | 0.008 | 0.031 | 7 |
| `StaffReviewRevision` | 9 | -1 | 0.008 | 0.008 | 3 |
| `StaffSession` | 9 | -1 | 0.008 | 0.047 | 4 |
| `StaffSourceAdmission` | 19 | -1 | 0.008 | 0.016 | 3 |
| `StaffSpecimen` | 12 | -1 | 0.008 | 0.016 | 7 |
| `StaffTrustedLearningDecision` | 23 | -1 | 0.008 | 0.023 | 6 |
| `StaffWorkspaceCard` | 11 | -1 | 0.055 | 0.047 | 3 |
| `StaffWorkspaceControl` | 15 | -1 | 0.016 | 0.016 | 3 |
| `StaffWorkspaceIdentificationControl` | 12 | -1 | 0.016 | 0.016 | 3 |
| `StaffWorkspaceInfrastructureReservation` | 8 | -1 | 0.008 | 0.031 | 3 |
| `StaffWorkspaceOperation` | 9 | 13 | 0.141 | 0.078 | 6 |
| `StaffWorkspaceSourceActionPermit` | 13 | -1 | 0.008 | 0.016 | 4 |
| `StaffWorkspaceSourceAdmission` | 18 | -1 | 0.008 | 0.023 | 3 |
| `StaffWorkspaceSourceControl` | 17 | -1 | 0.016 | 0.016 | 3 |
| `StaffWorkspaceSourceOperation` | 26 | -1 | 0.008 | 0.031 | 3 |
| `_prisma_migrations` | 8 | 22 | 0.016 | 0.016 | 0 |

## atlas_customer: 9 tables

| Table | Columns | Estimated rows | Table MiB | Index MiB | Triggers |
| --- | ---: | ---: | ---: | ---: | ---: |
| `CustomerAccount` | 8 | -1 | 0.016 | 0.047 | 0 |
| `CustomerBrowser` | 4 | -1 | 0.008 | 0.016 | 0 |
| `CustomerCard` | 6 | -1 | 0.008 | 0.023 | 2 |
| `CustomerCardEvent` | 8 | -1 | 0.008 | 0.031 | 2 |
| `CustomerChallenge` | 19 | -1 | 0.016 | 0.062 | 1 |
| `CustomerControl` | 9 | -1 | 0.016 | 0.016 | 3 |
| `CustomerRateBucket` | 3 | -1 | 0.008 | 0.016 | 0 |
| `CustomerSession` | 9 | -1 | 0.008 | 0.047 | 0 |
| `CustomerSubmission` | 8 | -1 | 0.008 | 0.031 | 2 |

## public: 141 tables

| Table | Columns | Estimated rows | Table MiB | Index MiB | Triggers |
| --- | ---: | ---: | ---: | ---: | ---: |
| `AiGraderDesignReference` | 29 | -1 | 0.008 | 0.055 | 2 |
| `AiGraderEvidenceAsset` | 17 | 507 | 0.531 | 0.445 | 0 |
| `AiGraderGrade` | 19 | -1 | 0.117 | 0.062 | 0 |
| `AiGraderLabel` | 17 | -1 | 0.109 | 0.062 | 0 |
| `AiGraderNfcAuditEvent` | 12 | -1 | 0.016 | 0.062 | 2 |
| `AiGraderNfcProgrammingAttempt` | 22 | -1 | 0.016 | 0.094 | 0 |
| `AiGraderNfcTag` | 31 | -1 | 0.016 | 0.188 | 0 |
| `AiGraderPublication` | 18 | -1 | 0.172 | 0.047 | 0 |
| `AiGraderReport` | 40 | 10 | 0.258 | 0.125 | 2 |
| `AiGraderSession` | 18 | 12 | 0.141 | 0.109 | 1 |
| `AiGraderV2CaptureDevice` | 9 | 3 | 0.016 | 0.031 | 0 |
| `AiGraderV2CardTypeMap` | 5 | -1 | 0.016 | 0.062 | 0 |
| `AiGraderV2CardTypeMapRevision` | 16 | -1 | 0.180 | 0.094 | 2 |
| `AiGraderV2ColorGeometryEvidence` | 16 | -1 | 0.109 | 0.062 | 1 |
| `AiGraderV2InstrumentationEvent` | 17 | 2684 | 6.352 | 1.117 | 2 |
| `AiGraderV2LearningBank` | 3 | 2 | 0.508 | 0.016 | 0 |
| `AiGraderV2LegacyMapLayoutAuthority` | 5 | -1 | 0.016 | 0.047 | 2 |
| `AiGraderV2MapFilterDecision` | 23 | 168 | 0.727 | 0.094 | 2 |
| `AiGraderV2MapFilterRestoreEvent` | 7 | -1 | 0.008 | 0.023 | 2 |
| `AiGraderV2MapRegistrationLesson` | 18 | -1 | 0.117 | 0.078 | 1 |
| `AiGraderV2PreparationAttempt` | 17 | -1 | 0.008 | 0.039 | 3 |
| `AiGraderV2PreparationHead` | 5 | -1 | 0.008 | 0.008 | 2 |
| `AiGraderV2PreparationManifest` | 10 | -1 | 0.008 | 0.031 | 3 |
| `AiGraderV2Session` | 20 | 125 | 6.258 | 0.047 | 2 |
| `AiGraderValuation` | 17 | -1 | 0.109 | 0.047 | 0 |
| `AlgorithmVersion` | 10 | -1 | 0.008 | 0.016 | 0 |
| `AuditEvent` | 15 | -1 | 0.008 | 0.023 | 0 |
| `AuthRun` | 20 | -1 | 0.008 | 0.023 | 0 |
| `AuthVerification` | 5 | -1 | 0.016 | 0.031 | 0 |
| `AutoFillProfile` | 17 | -1 | 0.016 | 0.031 | 0 |
| `AutoFillSession` | 14 | -1 | 0.008 | 0.031 | 0 |
| `BatchStageEvent` | 6 | 51 | 0.047 | 0.047 | 0 |
| `BytebotLiteJob` | 15 | 39 | 1.297 | 0.062 | 1 |
| `BytebotPlaybookRule` | 11 | -1 | 0.016 | 0.047 | 1 |
| `CalibrationSnapshot` | 35 | -1 | 0.062 | 0.062 | 3 |
| `CaptureManifest` | 16 | -1 | 0.008 | 0.031 | 0 |
| `CaptureRig` | 8 | -1 | 0.016 | 0.031 | 0 |
| `CaptureSession` | 17 | -1 | 0.008 | 0.023 | 0 |
| `CardAsset` | 60 | 624 | 1088.609 | 0.172 | 0 |
| `CardBatch` | 12 | 788 | 0.234 | 0.086 | 0 |
| `CardEvidenceItem` | 12 | 9 | 0.211 | 0.070 | 0 |
| `CardInventoryEventV2` | 7 | -1 | 0.008 | 0.055 | 4 |
| `CardNote` | 5 | -1 | 0.008 | 0.008 | 0 |
| `CardOwnershipEventV2` | 14 | -1 | 0.047 | 0.062 | 1 |
| `CardPhoto` | 14 | 316 | 147.656 | 0.125 | 0 |
| `CardPrintProfile` | 15 | -1 | 0.008 | 0.023 | 0 |
| `CardVariant` | 10 | 86380 | 14.875 | 33.891 | 0 |
| `CardVariantDecision` | 9 | 185 | 0.180 | 0.203 | 0 |
| `CardVariantReferenceImage` | 24 | 8973 | 33.695 | 17.773 | 0 |
| `CardVariantTaxonomyMap` | 10 | 85787 | 23.148 | 32.469 | 0 |
| `CollectibleCardV2` | 32 | 39 | 0.219 | 0.125 | 2 |
| `Conversation` | 12 | -1 | 0.008 | 0.031 | 0 |
| `CustodyEvent` | 13 | -1 | 0.008 | 0.023 | 0 |
| `CustomerNote` | 5 | -1 | 0.008 | 0.016 | 0 |
| `DeviceCapabilityManifest` | 15 | -1 | 0.008 | 0.023 | 0 |
| `Escalation` | 9 | -1 | 0.008 | 0.023 | 0 |
| `EvidenceArtifact` | 18 | -1 | 0.008 | 0.055 | 0 |
| `GoldenTicket` | 18 | -1 | 0.008 | 0.070 | 0 |
| `GoldenTicketConsent` | 9 | -1 | 0.008 | 0.023 | 0 |
| `GoldenTicketWinnerProfile` | 9 | -1 | 0.008 | 0.023 | 0 |
| `GradeCertificate` | 16 | -1 | 0.008 | 0.039 | 0 |
| `GradeRun` | 19 | -1 | 0.008 | 0.023 | 0 |
| `GradingSuspectRegion` | 16 | -1 | 0.008 | 0.023 | 0 |
| `HelperInstance` | 9 | -1 | 0.008 | 0.023 | 0 |
| `HumanGradeLabel` | 25 | 1771 | 0.539 | 0.641 | 0 |
| `HumanGradeLabelSheet` | 6 | 107 | 0.055 | 0.047 | 0 |
| `IngestionTask` | 9 | -1 | 0.008 | 0.016 | 0 |
| `InventoryBatch` | 13 | -1 | 0.016 | 0.062 | 0 |
| `InventoryWorkflowEventV2` | 6 | -1 | 0.047 | 0.062 | 3 |
| `Item` | 19 | 246 | 275.477 | 0.094 | 0 |
| `ItemOwnership` | 5 | 200 | 0.117 | 0.039 | 0 |
| `KioskSession` | 37 | 37 | 28.750 | 0.094 | 0 |
| `Listing` | 7 | -1 | 0.008 | 0.016 | 0 |
| `LiveRip` | 30 | 4 | 0.016 | 0.156 | 0 |
| `LiveRipConsent` | 8 | -1 | 0.008 | 0.023 | 0 |
| `Location` | 34 | 32 | 0.055 | 0.078 | 0 |
| `LocationRestock` | 7 | -1 | 0.008 | 0.023 | 0 |
| `LocationVisit` | 6 | 642 | 0.141 | 0.109 | 0 |
| `MathematicalCalibrationActivation` | 19 | -1 | 0.031 | 0.078 | 2 |
| `MathematicalCalibrationActivationEvent` | 12 | -1 | 0.047 | 0.062 | 2 |
| `MathematicalCalibrationActivePointer` | 8 | -1 | 0.016 | 0.031 | 1 |
| `MathematicalCalibrationPendingPointer` | 6 | -1 | 0.016 | 0.031 | 1 |
| `Message` | 6 | -1 | 0.008 | 0.016 | 0 |
| `NavigationSession` | 15 | 857 | 0.359 | 0.133 | 0 |
| `OcrEvalCase` | 11 | -1 | 0.008 | 0.031 | 0 |
| `OcrEvalResult` | 10 | -1 | 0.008 | 0.031 | 0 |
| `OcrEvalRun` | 10 | -1 | 0.008 | 0.023 | 0 |
| `OcrFeedbackEvent` | 15 | 128 | 0.352 | 0.219 | 0 |
| `OcrFeedbackMemoryAggregate` | 25 | 264 | 0.227 | 0.172 | 0 |
| `OcrRegionTeachEvent` | 16 | -1 | 0.008 | 0.039 | 0 |
| `OcrRegionTemplate` | 12 | -1 | 0.008 | 0.031 | 0 |
| `Operator` | 9 | -1 | 0.008 | 0.023 | 0 |
| `OperatorOverride` | 15 | -1 | 0.008 | 0.023 | 0 |
| `PackCalculatorConfig` | 14 | -1 | 0.016 | 0.031 | 0 |
| `PackDefinition` | 11 | 12 | 0.016 | 0.016 | 0 |
| `PackInstance` | 14 | 122 | 0.078 | 0.031 | 0 |
| `PackLabel` | 12 | 169 | 0.078 | 0.148 | 0 |
| `PackRecipe` | 13 | -1 | 0.008 | 0.031 | 0 |
| `PackRecipeItem` | 14 | -1 | 0.008 | 0.016 | 0 |
| `PackSlot` | 3 | 111 | 0.055 | 0.016 | 0 |
| `ProcessingJob` | 11 | 1389 | 0.406 | 0.148 | 1 |
| `QrCode` | 15 | 348 | 0.258 | 0.117 | 0 |
| `ReplayRun` | 10 | -1 | 0.008 | 0.016 | 0 |
| `RigComponent` | 10 | -1 | 0.008 | 0.023 | 0 |
| `RigLocation` | 6 | -1 | 0.016 | 0.031 | 0 |
| `RuntimeEnvironment` | 10 | -1 | 0.008 | 0.016 | 0 |
| `Session` | 5 | -1 | 0.016 | 0.031 | 0 |
| `SetApproval` | 9 | 294 | 0.234 | 0.195 | 0 |
| `SetAuditEvent` | 16 | 3655 | 3.344 | 1.617 | 0 |
| `SetCard` | 11 | 72017 | 15.555 | 20.789 | 0 |
| `SetDraft` | 9 | 242 | 0.102 | 0.109 | 0 |
| `SetDraftVersion` | 12 | 1034 | 39.805 | 0.391 | 0 |
| `SetIngestionJob` | 15 | 1155 | 15.969 | 0.266 | 0 |
| `SetOddsByFormat` | 12 | 46313 | 13.312 | 14.812 | 0 |
| `SetParallel` | 11 | 6277 | 1.633 | 2.234 | 0 |
| `SetParallelScope` | 11 | 46300 | 13.250 | 14.461 | 0 |
| `SetProgram` | 9 | 4399 | 1.141 | 1.641 | 0 |
| `SetReplaceJob` | 23 | -1 | 0.180 | 0.078 | 0 |
| `SetSeedJob` | 17 | 345 | 0.391 | 0.180 | 0 |
| `SetTaxonomyAmbiguityQueue` | 11 | 566 | 0.398 | 0.266 | 0 |
| `SetTaxonomyConflict` | 14 | 5998 | 2.992 | 1.828 | 0 |
| `SetTaxonomySource` | 13 | 1042 | 2.094 | 0.344 | 0 |
| `SetVariation` | 9 | -1 | 0.008 | 0.023 | 0 |
| `ShippingRequest` | 24 | -1 | 0.008 | 0.039 | 0 |
| `SportsDbPlayer` | 15 | -1 | 0.008 | 0.031 | 0 |
| `SportsDbPlayerSeason` | 8 | -1 | 0.008 | 0.023 | 0 |
| `SportsDbTeam` | 11 | -1 | 0.008 | 0.023 | 0 |
| `SupportCustomer` | 11 | -1 | 0.008 | 0.047 | 0 |
| `SupportFAQ` | 7 | -1 | 0.008 | 0.016 | 0 |
| `Tenant` | 5 | -1 | 0.016 | 0.031 | 0 |
| `ThresholdSetVersion` | 8 | -1 | 0.008 | 0.016 | 0 |
| `User` | 9 | -1 | 0.016 | 0.047 | 0 |
| `Wallet` | 5 | 20 | 0.016 | 0.031 | 0 |
| `WalletTransaction` | 8 | 105 | 0.062 | 0.031 | 0 |
| `_prisma_migrations` | 8 | 96 | 0.094 | 0.016 | 0 |
| `position_logs` | 9 | 799 | 0.211 | 0.258 | 0 |
| `stock_routes` | 12 | -1 | 0.016 | 0.031 | 0 |
| `stocker_positions` | 11 | 1 | 0.016 | 0.031 | 0 |
| `stocker_profiles` | 9 | -1 | 0.016 | 0.047 | 0 |
| `stocker_shifts` | 13 | -1 | 0.016 | 0.062 | 0 |
| `stocker_stops` | 17 | -1 | 0.016 | 0.047 | 0 |

## Installed functions

| Schema | Functions/signatures | Security definer |
| --- | ---: | ---: |
| `atlas_customer` | 11 | 1 |
| `atlas_staff` | 155 | 116 |
| `public` | 41 | 0 |

The source-declared function/trigger-name totals may differ from installed counts because migrations replace functions and attach the same function under several trigger instances. Catalog counts are authoritative for the installed surface. Extension functions are included where they live in a listed schema.
