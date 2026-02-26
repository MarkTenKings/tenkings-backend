import type { Prisma, SetDatasetType } from "@tenkings/database";
import type { TaxonomyArtifactType, TaxonomyEntityType, TaxonomySourceKind } from "./taxonomyV2Enums";

export type TaxonomyProgramInput = {
  label: string;
  codePrefix?: string | null;
  programClass?: string | null;
  rowIndex?: number | null;
};

export type TaxonomyCardInput = {
  programLabel: string;
  cardNumber: string;
  playerName?: string | null;
  rowIndex?: number | null;
};

export type TaxonomyVariationInput = {
  programLabel: string;
  label: string;
  scopeNote?: string | null;
  rowIndex?: number | null;
};

export type TaxonomyParallelInput = {
  label: string;
  serialDenominator?: number | null;
  serialText?: string | null;
  finishFamily?: string | null;
  rowIndex?: number | null;
};

export type TaxonomyScopeInput = {
  programLabel: string;
  parallelLabel: string;
  variationLabel?: string | null;
  formatKey?: string | null;
  channelKey?: string | null;
  rowIndex?: number | null;
};

export type TaxonomyOddsInput = {
  oddsText: string;
  programLabel?: string | null;
  parallelLabel?: string | null;
  formatKey?: string | null;
  channelKey?: string | null;
  rowIndex?: number | null;
};

export type TaxonomyAmbiguityInput = {
  entityType: TaxonomyEntityType;
  key: string;
  reason: string;
  rowIndex?: number | null;
  raw?: Record<string, unknown> | null;
};

export type TaxonomyAdapterOutput = {
  sourceKind: TaxonomySourceKind;
  artifactType: TaxonomyArtifactType;
  sourceLabel?: string | null;
  sourceTimestamp?: Date | null;
  parserConfidence?: number | null;
  metadata?: Prisma.InputJsonValue;
  programs: TaxonomyProgramInput[];
  cards: TaxonomyCardInput[];
  variations: TaxonomyVariationInput[];
  parallels: TaxonomyParallelInput[];
  scopes: TaxonomyScopeInput[];
  oddsRows: TaxonomyOddsInput[];
  ambiguities: TaxonomyAmbiguityInput[];
};

export type TaxonomyAdapterParams = {
  setId: string;
  datasetType: SetDatasetType;
  sourceUrl?: string | null;
  parserVersion?: string | null;
  parseSummary?: Record<string, unknown> | null;
  rawPayload: unknown;
};
