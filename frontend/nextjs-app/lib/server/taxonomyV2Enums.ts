export const TaxonomyArtifactType = {
  CHECKLIST: "CHECKLIST",
  ODDS: "ODDS",
  COMBINED: "COMBINED",
  MANUAL_PATCH: "MANUAL_PATCH",
} as const;

export type TaxonomyArtifactType = (typeof TaxonomyArtifactType)[keyof typeof TaxonomyArtifactType];

export const TaxonomySourceKind = {
  OFFICIAL_CHECKLIST: "OFFICIAL_CHECKLIST",
  OFFICIAL_ODDS: "OFFICIAL_ODDS",
  TRUSTED_SECONDARY: "TRUSTED_SECONDARY",
  MANUAL_PATCH: "MANUAL_PATCH",
} as const;

export type TaxonomySourceKind = (typeof TaxonomySourceKind)[keyof typeof TaxonomySourceKind];

export const TaxonomyEntityType = {
  PROGRAM: "PROGRAM",
  CARD: "CARD",
  VARIATION: "VARIATION",
  PARALLEL: "PARALLEL",
  PARALLEL_SCOPE: "PARALLEL_SCOPE",
  ODDS_ROW: "ODDS_ROW",
} as const;

export type TaxonomyEntityType = (typeof TaxonomyEntityType)[keyof typeof TaxonomyEntityType];

export const TaxonomyConflictStatus = {
  OPEN: "OPEN",
  RESOLVED: "RESOLVED",
  DISMISSED: "DISMISSED",
} as const;

export type TaxonomyConflictStatus = (typeof TaxonomyConflictStatus)[keyof typeof TaxonomyConflictStatus];

export const TaxonomyAmbiguityStatus = {
  PENDING: "PENDING",
  IN_REVIEW: "IN_REVIEW",
  RESOLVED: "RESOLVED",
  DISMISSED: "DISMISSED",
} as const;

export type TaxonomyAmbiguityStatus = (typeof TaxonomyAmbiguityStatus)[keyof typeof TaxonomyAmbiguityStatus];
