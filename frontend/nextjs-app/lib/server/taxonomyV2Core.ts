import {
  prisma,
  type Prisma,
  type SetDatasetType,
} from "@tenkings/database";
import {
  buildTaxonomyCanonicalKey,
  normalizeChannelKey,
  normalizeFormatKey,
  normalizeParallelId,
  normalizeProgramId,
  normalizeSetId,
  normalizeTaxonomyCardNumber,
  normalizeVariationId,
  sanitizeTaxonomyText,
} from "./taxonomyV2Utils";
import type {
  TaxonomyAdapterOutput,
  TaxonomyAmbiguityInput,
  TaxonomyCardInput,
  TaxonomyOddsInput,
  TaxonomyParallelInput,
  TaxonomyProgramInput,
  TaxonomyScopeInput,
  TaxonomyVariationInput,
} from "./taxonomyV2AdapterTypes";
import {
  TaxonomyAmbiguityStatus,
  TaxonomyArtifactType,
  TaxonomyConflictStatus,
  TaxonomyEntityType,
  TaxonomySourceKind,
} from "./taxonomyV2Enums";
import { buildToppsTaxonomyAdapterOutput, canRunToppsAdapter } from "./taxonomyV2ToppsAdapter";
import { buildPaniniTaxonomyAdapterOutput, canRunPaniniAdapter } from "./taxonomyV2PaniniAdapter";
import { buildUpperDeckTaxonomyAdapterOutput, canRunUpperDeckAdapter } from "./taxonomyV2UpperDeckAdapter";

const SOURCE_PRECEDENCE: Record<TaxonomySourceKind, number> = {
  [TaxonomySourceKind.OFFICIAL_CHECKLIST]: 400,
  [TaxonomySourceKind.OFFICIAL_ODDS]: 300,
  [TaxonomySourceKind.TRUSTED_SECONDARY]: 200,
  [TaxonomySourceKind.MANUAL_PATCH]: 100,
};

type TaxonomyTx = any;
const taxonomyDb = prisma as any;

type TaxonomyIngestParams = {
  setId: string;
  ingestionJobId: string;
  datasetType: SetDatasetType;
  rawPayload: unknown;
  sourceUrl?: string | null;
  parserVersion?: string | null;
  parseSummary?: Record<string, unknown> | null;
};

export type TaxonomyIngestResult = {
  applied: boolean;
  adapter: string;
  sourceId: string | null;
  sourceKind: TaxonomySourceKind | null;
  artifactType: TaxonomyArtifactType | null;
  counts: {
    programs: number;
    cards: number;
    variations: number;
    parallels: number;
    scopes: number;
    oddsRows: number;
    conflicts: number;
    ambiguities: number;
    bridges: number;
  };
  skippedReason?: string;
};

export type TaxonomyLegacyBackfillResult = {
  applied: boolean;
  sourceId: string | null;
  counts: {
    programs: number;
    cards: number;
    parallels: number;
    scopes: number;
    bridges: number;
  };
  skippedReason?: string;
};

function normalizeLabelKey(value: string): string {
  return sanitizeTaxonomyText(value).toLowerCase();
}

function dedupeByKey<T>(items: T[], keyBuilder: (value: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const key = keyBuilder(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

async function queueAmbiguity(params: {
  tx: TaxonomyTx;
  setId: string;
  sourceId: string;
  item: TaxonomyAmbiguityInput;
}) {
  const ambiguityKey = sanitizeTaxonomyText(params.item.key).slice(0, 300);
  if (!ambiguityKey) return;

  const serializedRaw = params.item.raw ? JSON.parse(JSON.stringify(params.item.raw)) : null;
  const payload: Prisma.InputJsonValue = {
    reason: params.item.reason,
    rowIndex: params.item.rowIndex ?? null,
    raw: serializedRaw,
  };

  await params.tx.setTaxonomyAmbiguityQueue.upsert({
    where: {
      setId_ambiguityKey: {
        setId: params.setId,
        ambiguityKey,
      },
    },
    create: {
      setId: params.setId,
      entityType: params.item.entityType,
      ambiguityKey,
      payloadJson: payload,
      sourceId: params.sourceId,
      status: TaxonomyAmbiguityStatus.PENDING,
    },
    update: {
      entityType: params.item.entityType,
      payloadJson: payload,
      sourceId: params.sourceId,
      status: TaxonomyAmbiguityStatus.PENDING,
      resolutionNote: null,
      resolvedAt: null,
    },
  });
}

async function getSourceKind(tx: TaxonomyTx, sourceId: string | null | undefined) {
  if (!sourceId) return null;
  const source = await tx.setTaxonomySource.findUnique({
    where: { id: sourceId },
    select: { sourceKind: true },
  });
  return source?.sourceKind ?? null;
}

async function createConflict(params: {
  tx: TaxonomyTx;
  setId: string;
  entityType: TaxonomyEntityType;
  entityKey: string;
  conflictField: string;
  existingSourceId?: string | null;
  incomingSourceId: string;
  existingValue: unknown;
  incomingValue: unknown;
  preferredSourceKind: TaxonomySourceKind;
}) {
  const existingOpen = await params.tx.setTaxonomyConflict.findFirst({
    where: {
      setId: params.setId,
      entityType: params.entityType,
      entityKey: params.entityKey,
      conflictField: params.conflictField,
      status: TaxonomyConflictStatus.OPEN,
      incomingSourceId: params.incomingSourceId,
      existingSourceId: params.existingSourceId ?? null,
    },
    select: { id: true },
  });

  if (existingOpen) return false;

  await params.tx.setTaxonomyConflict.create({
    data: {
      setId: params.setId,
      entityType: params.entityType,
      entityKey: params.entityKey,
      conflictField: params.conflictField,
      existingSourceId: params.existingSourceId ?? null,
      incomingSourceId: params.incomingSourceId,
      existingValueJson: params.existingValue as Prisma.InputJsonValue,
      incomingValueJson: params.incomingValue as Prisma.InputJsonValue,
      status: TaxonomyConflictStatus.OPEN,
      resolutionNote: `preferred_source=${params.preferredSourceKind}`,
    },
  });

  return true;
}

function preferredSourceKind(params: {
  existingSourceKind: TaxonomySourceKind | null;
  incomingSourceKind: TaxonomySourceKind;
}): TaxonomySourceKind {
  const existingScore = params.existingSourceKind ? SOURCE_PRECEDENCE[params.existingSourceKind] : 0;
  const incomingScore = SOURCE_PRECEDENCE[params.incomingSourceKind];
  return incomingScore >= existingScore ? params.incomingSourceKind : (params.existingSourceKind ?? params.incomingSourceKind);
}

async function upsertProgram(params: {
  tx: TaxonomyTx;
  setId: string;
  sourceId: string;
  sourceKind: TaxonomySourceKind;
  input: TaxonomyProgramInput;
}): Promise<{ programId: string; created: boolean; conflict: boolean }> {
  const programId = normalizeProgramId(params.input.label);
  const label = sanitizeTaxonomyText(params.input.label);

  const existing = await params.tx.setProgram.findUnique({
    where: {
      setId_programId: {
        setId: params.setId,
        programId,
      },
    },
    select: {
      id: true,
      label: true,
      codePrefix: true,
      programClass: true,
      sourceId: true,
    },
  });

  if (!existing) {
    await params.tx.setProgram.create({
      data: {
        setId: params.setId,
        programId,
        label,
        codePrefix: sanitizeTaxonomyText(params.input.codePrefix) || null,
        programClass: sanitizeTaxonomyText(params.input.programClass) || null,
        sourceId: params.sourceId,
      },
    });
    return { programId, created: true, conflict: false };
  }

  const conflict = normalizeLabelKey(existing.label) !== normalizeLabelKey(label);
  if (conflict) {
    const existingSourceKind = await getSourceKind(params.tx, existing.sourceId);
    await createConflict({
      tx: params.tx,
      setId: params.setId,
      entityType: TaxonomyEntityType.PROGRAM,
      entityKey: `${params.setId}::${programId}`,
      conflictField: "label",
      existingSourceId: existing.sourceId,
      incomingSourceId: params.sourceId,
      existingValue: { label: existing.label, codePrefix: existing.codePrefix, programClass: existing.programClass },
      incomingValue: {
        label,
        codePrefix: sanitizeTaxonomyText(params.input.codePrefix) || null,
        programClass: sanitizeTaxonomyText(params.input.programClass) || null,
      },
      preferredSourceKind: preferredSourceKind({
        existingSourceKind,
        incomingSourceKind: params.sourceKind,
      }),
    });
    return { programId, created: false, conflict: true };
  }

  const nextCodePrefix = sanitizeTaxonomyText(params.input.codePrefix) || null;
  const nextProgramClass = sanitizeTaxonomyText(params.input.programClass) || null;
  const shouldUpdate = (!existing.codePrefix && nextCodePrefix) || (!existing.programClass && nextProgramClass);

  if (shouldUpdate) {
    await params.tx.setProgram.update({
      where: {
        setId_programId: {
          setId: params.setId,
          programId,
        },
      },
      data: {
        codePrefix: existing.codePrefix || nextCodePrefix,
        programClass: existing.programClass || nextProgramClass,
        sourceId: existing.sourceId ?? params.sourceId,
      },
    });
  }

  return { programId, created: false, conflict: false };
}

async function upsertCard(params: {
  tx: TaxonomyTx;
  setId: string;
  sourceId: string;
  sourceKind: TaxonomySourceKind;
  input: TaxonomyCardInput;
  programIdByLabel: Map<string, string>;
}): Promise<{ created: boolean; conflict: boolean; ambiguity: boolean }> {
  const programId = params.programIdByLabel.get(normalizeLabelKey(params.input.programLabel));
  if (!programId) {
    await queueAmbiguity({
      tx: params.tx,
      setId: params.setId,
      sourceId: params.sourceId,
      item: {
        entityType: TaxonomyEntityType.CARD,
        key: `card-missing-program::${normalizeLabelKey(params.input.programLabel)}::${normalizeLabelKey(params.input.cardNumber)}`,
        reason: "Card row references program not present in taxonomy programs",
        rowIndex: params.input.rowIndex,
      },
    });
    return { created: false, conflict: false, ambiguity: true };
  }

  const cardNumber = normalizeTaxonomyCardNumber(params.input.cardNumber);
  if (!cardNumber) {
    await queueAmbiguity({
      tx: params.tx,
      setId: params.setId,
      sourceId: params.sourceId,
      item: {
        entityType: TaxonomyEntityType.CARD,
        key: `card-missing-card-number::${programId}`,
        reason: "Card row missing card number",
        rowIndex: params.input.rowIndex,
      },
    });
    return { created: false, conflict: false, ambiguity: true };
  }

  const existing = await params.tx.setCard.findUnique({
    where: {
      setId_programId_cardNumber: {
        setId: params.setId,
        programId,
        cardNumber,
      },
    },
    select: {
      id: true,
      playerName: true,
      sourceId: true,
    },
  });

  const incomingPlayerName = sanitizeTaxonomyText(params.input.playerName) || null;

  if (!existing) {
    await params.tx.setCard.create({
      data: {
        setId: params.setId,
        programId,
        cardNumber,
        playerName: incomingPlayerName,
        sourceId: params.sourceId,
      },
    });
    return { created: true, conflict: false, ambiguity: false };
  }

  if (incomingPlayerName && existing.playerName && normalizeLabelKey(existing.playerName) !== normalizeLabelKey(incomingPlayerName)) {
    const existingSourceKind = await getSourceKind(params.tx, existing.sourceId);
    await createConflict({
      tx: params.tx,
      setId: params.setId,
      entityType: TaxonomyEntityType.CARD,
      entityKey: `${params.setId}::${programId}::${cardNumber}`,
      conflictField: "playerName",
      existingSourceId: existing.sourceId,
      incomingSourceId: params.sourceId,
      existingValue: { playerName: existing.playerName },
      incomingValue: { playerName: incomingPlayerName },
      preferredSourceKind: preferredSourceKind({
        existingSourceKind,
        incomingSourceKind: params.sourceKind,
      }),
    });
    return { created: false, conflict: true, ambiguity: false };
  }

  if (!existing.playerName && incomingPlayerName) {
    await params.tx.setCard.update({
      where: {
        setId_programId_cardNumber: {
          setId: params.setId,
          programId,
          cardNumber,
        },
      },
      data: {
        playerName: incomingPlayerName,
        sourceId: existing.sourceId ?? params.sourceId,
      },
    });
  }

  return { created: false, conflict: false, ambiguity: false };
}

async function upsertVariation(params: {
  tx: TaxonomyTx;
  setId: string;
  sourceId: string;
  sourceKind: TaxonomySourceKind;
  input: TaxonomyVariationInput;
  programIdByLabel: Map<string, string>;
}): Promise<{ variationId: string | null; created: boolean; conflict: boolean; ambiguity: boolean }> {
  const programId = params.programIdByLabel.get(normalizeLabelKey(params.input.programLabel));
  if (!programId) {
    await queueAmbiguity({
      tx: params.tx,
      setId: params.setId,
      sourceId: params.sourceId,
      item: {
        entityType: TaxonomyEntityType.VARIATION,
        key: `variation-missing-program::${normalizeLabelKey(params.input.programLabel)}::${normalizeLabelKey(params.input.label)}`,
        reason: "Variation row references program not present in taxonomy programs",
        rowIndex: params.input.rowIndex,
      },
    });
    return { variationId: null, created: false, conflict: false, ambiguity: true };
  }

  const variationId = normalizeVariationId(params.input.label);
  const label = sanitizeTaxonomyText(params.input.label);
  const scopeNote = sanitizeTaxonomyText(params.input.scopeNote) || null;

  const existing = await params.tx.setVariation.findUnique({
    where: {
      setId_programId_variationId: {
        setId: params.setId,
        programId,
        variationId,
      },
    },
    select: {
      label: true,
      scopeNote: true,
      sourceId: true,
    },
  });

  if (!existing) {
    await params.tx.setVariation.create({
      data: {
        setId: params.setId,
        programId,
        variationId,
        label,
        scopeNote,
        sourceId: params.sourceId,
      },
    });
    return { variationId, created: true, conflict: false, ambiguity: false };
  }

  if (normalizeLabelKey(existing.label) !== normalizeLabelKey(label)) {
    const existingSourceKind = await getSourceKind(params.tx, existing.sourceId);
    await createConflict({
      tx: params.tx,
      setId: params.setId,
      entityType: TaxonomyEntityType.VARIATION,
      entityKey: `${params.setId}::${programId}::${variationId}`,
      conflictField: "label",
      existingSourceId: existing.sourceId,
      incomingSourceId: params.sourceId,
      existingValue: { label: existing.label, scopeNote: existing.scopeNote },
      incomingValue: { label, scopeNote },
      preferredSourceKind: preferredSourceKind({
        existingSourceKind,
        incomingSourceKind: params.sourceKind,
      }),
    });
    return { variationId, created: false, conflict: true, ambiguity: false };
  }

  if (!existing.scopeNote && scopeNote) {
    await params.tx.setVariation.update({
      where: {
        setId_programId_variationId: {
          setId: params.setId,
          programId,
          variationId,
        },
      },
      data: {
        scopeNote,
        sourceId: existing.sourceId ?? params.sourceId,
      },
    });
  }

  return { variationId, created: false, conflict: false, ambiguity: false };
}

async function upsertParallel(params: {
  tx: TaxonomyTx;
  setId: string;
  sourceId: string;
  sourceKind: TaxonomySourceKind;
  input: TaxonomyParallelInput;
}): Promise<{ parallelId: string; created: boolean; conflict: boolean }> {
  const parallelId = normalizeParallelId(params.input.label);
  const label = sanitizeTaxonomyText(params.input.label);

  const existing = await params.tx.setParallel.findUnique({
    where: {
      setId_parallelId: {
        setId: params.setId,
        parallelId,
      },
    },
    select: {
      label: true,
      serialDenominator: true,
      serialText: true,
      finishFamily: true,
      sourceId: true,
    },
  });

  if (!existing) {
    await params.tx.setParallel.create({
      data: {
        setId: params.setId,
        parallelId,
        label,
        serialDenominator: params.input.serialDenominator ?? null,
        serialText: sanitizeTaxonomyText(params.input.serialText) || null,
        finishFamily: sanitizeTaxonomyText(params.input.finishFamily) || null,
        sourceId: params.sourceId,
      },
    });
    return { parallelId, created: true, conflict: false };
  }

  const hasLabelConflict = normalizeLabelKey(existing.label) !== normalizeLabelKey(label);
  const hasSerialConflict =
    (existing.serialDenominator ?? null) !== (params.input.serialDenominator ?? null) &&
    existing.serialDenominator != null &&
    params.input.serialDenominator != null;
  const hasFinishConflict =
    Boolean(existing.finishFamily) &&
    Boolean(params.input.finishFamily) &&
    normalizeLabelKey(existing.finishFamily ?? "") !== normalizeLabelKey(params.input.finishFamily ?? "");

  if (hasLabelConflict || hasSerialConflict || hasFinishConflict) {
    const existingSourceKind = await getSourceKind(params.tx, existing.sourceId);
    await createConflict({
      tx: params.tx,
      setId: params.setId,
      entityType: TaxonomyEntityType.PARALLEL,
      entityKey: `${params.setId}::${parallelId}`,
      conflictField: hasLabelConflict ? "label" : hasSerialConflict ? "serialDenominator" : "finishFamily",
      existingSourceId: existing.sourceId,
      incomingSourceId: params.sourceId,
      existingValue: {
        label: existing.label,
        serialDenominator: existing.serialDenominator,
        serialText: existing.serialText,
        finishFamily: existing.finishFamily,
      },
      incomingValue: {
        label,
        serialDenominator: params.input.serialDenominator ?? null,
        serialText: sanitizeTaxonomyText(params.input.serialText) || null,
        finishFamily: sanitizeTaxonomyText(params.input.finishFamily) || null,
      },
      preferredSourceKind: preferredSourceKind({
        existingSourceKind,
        incomingSourceKind: params.sourceKind,
      }),
    });
    return { parallelId, created: false, conflict: true };
  }

  const nextSerialText = sanitizeTaxonomyText(params.input.serialText) || null;
  const nextFinishFamily = sanitizeTaxonomyText(params.input.finishFamily) || null;

  const shouldUpdate =
    (existing.serialDenominator == null && params.input.serialDenominator != null) ||
    (!existing.serialText && nextSerialText) ||
    (!existing.finishFamily && nextFinishFamily);

  if (shouldUpdate) {
    await params.tx.setParallel.update({
      where: {
        setId_parallelId: {
          setId: params.setId,
          parallelId,
        },
      },
      data: {
        serialDenominator: existing.serialDenominator ?? params.input.serialDenominator ?? null,
        serialText: existing.serialText || nextSerialText,
        finishFamily: existing.finishFamily || nextFinishFamily,
        sourceId: existing.sourceId ?? params.sourceId,
      },
    });
  }

  return { parallelId, created: false, conflict: false };
}

async function upsertScope(params: {
  tx: TaxonomyTx;
  setId: string;
  sourceId: string;
  input: TaxonomyScopeInput;
  programIdByLabel: Map<string, string>;
  parallelIdByLabel: Map<string, string>;
  variationIdByProgramAndLabel: Map<string, string>;
}): Promise<{ created: boolean; ambiguity: boolean }> {
  const programId = params.programIdByLabel.get(normalizeLabelKey(params.input.programLabel));
  const parallelId = params.parallelIdByLabel.get(normalizeLabelKey(params.input.parallelLabel));
  if (!programId || !parallelId) {
    await queueAmbiguity({
      tx: params.tx,
      setId: params.setId,
      sourceId: params.sourceId,
      item: {
        entityType: TaxonomyEntityType.PARALLEL_SCOPE,
        key: `scope-missing-ref::${normalizeLabelKey(params.input.programLabel)}::${normalizeLabelKey(params.input.parallelLabel)}`,
        reason: "Parallel scope row references unresolved program or parallel",
        rowIndex: params.input.rowIndex,
      },
    });
    return { created: false, ambiguity: true };
  }

  const variationLabelKey = normalizeLabelKey(params.input.variationLabel || "");
  const variationId =
    variationLabelKey.length > 0
      ? params.variationIdByProgramAndLabel.get(`${programId}::${variationLabelKey}`) ?? null
      : null;

  if (variationLabelKey && !variationId) {
    await queueAmbiguity({
      tx: params.tx,
      setId: params.setId,
      sourceId: params.sourceId,
      item: {
        entityType: TaxonomyEntityType.PARALLEL_SCOPE,
        key: `scope-missing-variation::${programId}::${parallelId}::${variationLabelKey}`,
        reason: "Parallel scope references unresolved variation",
        rowIndex: params.input.rowIndex,
      },
    });
    return { created: false, ambiguity: true };
  }

  const formatKey = normalizeFormatKey(params.input.formatKey);
  const channelKey = normalizeChannelKey(params.input.channelKey);
  const scopeKey = [programId, parallelId, variationId ?? "none", formatKey ?? "any", channelKey ?? "any"].join("::");

  const existing = await params.tx.setParallelScope.findUnique({
    where: {
      setId_scopeKey: {
        setId: params.setId,
        scopeKey,
      },
    },
    select: { id: true },
  });

  if (existing) return { created: false, ambiguity: false };

  await params.tx.setParallelScope.create({
    data: {
      setId: params.setId,
      scopeKey,
      programId,
      parallelId,
      variationId,
      formatKey,
      channelKey,
      sourceId: params.sourceId,
    },
  });

  return { created: true, ambiguity: false };
}

async function upsertOdds(params: {
  tx: TaxonomyTx;
  setId: string;
  sourceId: string;
  sourceKind: TaxonomySourceKind;
  input: TaxonomyOddsInput;
  programIdByLabel: Map<string, string>;
  parallelIdByLabel: Map<string, string>;
}): Promise<{ created: boolean; conflict: boolean; ambiguity: boolean }> {
  const oddsText = sanitizeTaxonomyText(params.input.oddsText);
  if (!oddsText) {
    return { created: false, conflict: false, ambiguity: false };
  }

  const rawProgramLabel = sanitizeTaxonomyText(params.input.programLabel || "");
  const rawParallelLabel = sanitizeTaxonomyText(params.input.parallelLabel || "");
  const programId = rawProgramLabel ? params.programIdByLabel.get(normalizeLabelKey(rawProgramLabel)) ?? null : null;
  const parallelId = rawParallelLabel ? params.parallelIdByLabel.get(normalizeLabelKey(rawParallelLabel)) ?? null : null;

  if (rawProgramLabel && !programId) {
    await queueAmbiguity({
      tx: params.tx,
      setId: params.setId,
      sourceId: params.sourceId,
      item: {
        entityType: TaxonomyEntityType.ODDS_ROW,
        key: `odds-missing-program::${normalizeLabelKey(rawProgramLabel)}::${normalizeLabelKey(oddsText)}`,
        reason: "Odds row references unresolved program/card type",
        rowIndex: params.input.rowIndex,
      },
    });
    return { created: false, conflict: false, ambiguity: true };
  }

  if (rawParallelLabel && !parallelId) {
    await queueAmbiguity({
      tx: params.tx,
      setId: params.setId,
      sourceId: params.sourceId,
      item: {
        entityType: TaxonomyEntityType.ODDS_ROW,
        key: `odds-missing-parallel::${normalizeLabelKey(rawParallelLabel)}::${normalizeLabelKey(oddsText)}`,
        reason: "Odds row references unresolved parallel",
        rowIndex: params.input.rowIndex,
      },
    });
    return { created: false, conflict: false, ambiguity: true };
  }

  const formatKey = normalizeFormatKey(params.input.formatKey);
  const channelKey = normalizeChannelKey(params.input.channelKey);
  const oddsKey = [programId ?? "none", parallelId ?? "none", formatKey ?? "any", channelKey ?? "any"].join("::");

  const existing = await params.tx.setOddsByFormat.findUnique({
    where: {
      setId_oddsKey: {
        setId: params.setId,
        oddsKey,
      },
    },
    select: {
      id: true,
      oddsText: true,
      sourceId: true,
    },
  });

  if (!existing) {
    await params.tx.setOddsByFormat.create({
      data: {
        setId: params.setId,
        oddsKey,
        programId,
        parallelId,
        formatKey,
        channelKey,
        oddsText,
        sourceId: params.sourceId,
      },
    });
    return { created: true, conflict: false, ambiguity: false };
  }

  if (normalizeLabelKey(existing.oddsText) !== normalizeLabelKey(oddsText)) {
    const existingSourceKind = await getSourceKind(params.tx, existing.sourceId);
    await createConflict({
      tx: params.tx,
      setId: params.setId,
      entityType: TaxonomyEntityType.ODDS_ROW,
      entityKey: `${params.setId}::${oddsKey}`,
      conflictField: "oddsText",
      existingSourceId: existing.sourceId,
      incomingSourceId: params.sourceId,
      existingValue: { oddsText: existing.oddsText },
      incomingValue: { oddsText },
      preferredSourceKind: preferredSourceKind({
        existingSourceKind,
        incomingSourceKind: params.sourceKind,
      }),
    });
    return { created: false, conflict: true, ambiguity: false };
  }

  return { created: false, conflict: false, ambiguity: false };
}

async function upsertCompatibilityBridge(params: {
  tx: TaxonomyTx;
  setId: string;
}) {
  const setId = params.setId;

  const [scopes, cards, variants] = (await Promise.all([
    params.tx.setParallelScope.findMany({
      where: { setId },
      select: { parallelId: true, programId: true },
      orderBy: [{ createdAt: "asc" }],
    }),
    params.tx.setCard.findMany({
      where: { setId },
      select: { cardNumber: true, programId: true },
      orderBy: [{ createdAt: "asc" }],
    }),
    params.tx.cardVariant.findMany({
      where: { setId },
      select: { id: true, setId: true, cardNumber: true, parallelId: true },
    }),
  ])) as [
    Array<{ parallelId: string; programId: string }>,
    Array<{ cardNumber: string; programId: string }>,
    Array<{ id: string; setId: string; cardNumber: string; parallelId: string }>
  ];

  if (variants.length < 1) {
    return 0;
  }

  const scopeProgramByParallel = new Map<string, string>();
  scopes.forEach((scope: { parallelId: string; programId: string }) => {
    if (!scopeProgramByParallel.has(scope.parallelId)) {
      scopeProgramByParallel.set(scope.parallelId, scope.programId);
    }
  });

  const programByCardNumber = new Map<string, string>();
  cards.forEach((card: { cardNumber: string; programId: string }) => {
    if (!programByCardNumber.has(card.cardNumber)) {
      programByCardNumber.set(card.cardNumber, card.programId);
    }
  });

  let bridges = 0;

  for (const variant of variants) {
    const cardNumber = normalizeTaxonomyCardNumber(variant.cardNumber);
    const parallelId = normalizeParallelId(variant.parallelId);
    const programIdFromCard = cardNumber ? programByCardNumber.get(cardNumber) ?? null : null;
    const programIdFromScope = scopeProgramByParallel.get(parallelId) ?? null;
    const programId = programIdFromCard ?? programIdFromScope ?? "base";

    const canonicalKey = buildTaxonomyCanonicalKey({
      setId,
      programId,
      cardNumber,
      parallelId,
    });

    await params.tx.cardVariantTaxonomyMap.upsert({
      where: {
        cardVariantId: variant.id,
      },
      create: {
        cardVariantId: variant.id,
        setId,
        programId,
        cardNumber,
        variationId: null,
        parallelId,
        canonicalKey,
      },
      update: {
        setId,
        programId,
        cardNumber,
        variationId: null,
        parallelId,
        canonicalKey,
      },
    });
    bridges += 1;
  }

  return bridges;
}

export async function backfillTaxonomyV2FromLegacyVariants(params: {
  setId: string;
  ingestionJobId?: string | null;
  sourceLabel?: string | null;
}): Promise<TaxonomyLegacyBackfillResult> {
  const setId = normalizeSetId(params.setId);
  if (!setId) {
    return {
      applied: false,
      sourceId: null,
      counts: {
        programs: 0,
        cards: 0,
        parallels: 0,
        scopes: 0,
        bridges: 0,
      },
      skippedReason: "setId is required",
    };
  }

  const variants = (await taxonomyDb.cardVariant.findMany({
    where: { setId },
    select: {
      id: true,
      cardNumber: true,
      parallelId: true,
    },
  })) as Array<{ id: string; cardNumber: string; parallelId: string }>;

  if (variants.length < 1) {
    return {
      applied: false,
      sourceId: null,
      counts: {
        programs: 0,
        cards: 0,
        parallels: 0,
        scopes: 0,
        bridges: 0,
      },
      skippedReason: "No legacy variants found for set",
    };
  }

  return await prisma.$transaction(async (tx) => {
    const db = tx as TaxonomyTx;
    const source = await db.setTaxonomySource.create({
      data: {
        setId,
        ingestionJobId: null,
        artifactType: TaxonomyArtifactType.CHECKLIST,
        sourceKind: TaxonomySourceKind.TRUSTED_SECONDARY,
        sourceLabel: sanitizeTaxonomyText(params.sourceLabel) || "legacy-variant-bootstrap",
        parserVersion: "legacy-bootstrap-v1",
        parserConfidence: 0.4,
        metadataJson: {
          mode: "legacy_variant_bootstrap",
          variantCount: variants.length,
        },
      },
    });

    const counts: TaxonomyLegacyBackfillResult["counts"] = {
      programs: 0,
      cards: 0,
      parallels: 0,
      scopes: 0,
      bridges: 0,
    };

    const programId = "base";
    const createdPrograms = await db.setProgram.createMany({
      data: [
        {
          setId,
          programId,
          label: "Base",
          programClass: "base",
          sourceId: source.id,
        },
      ],
      skipDuplicates: true,
    });
    counts.programs += createdPrograms.count;

    const parallelMap = new Map<string, string>();
    const cardNumbers = new Set<string>();

    variants.forEach((variant: { cardNumber: string; parallelId: string }) => {
      const parallelLabel = sanitizeTaxonomyText(variant.parallelId);
      const parallelId = normalizeParallelId(parallelLabel || variant.parallelId);
      if (parallelId) {
        if (!parallelMap.has(parallelId)) {
          parallelMap.set(parallelId, parallelLabel || parallelId);
        }
      }

      const cardNumber = normalizeTaxonomyCardNumber(variant.cardNumber);
      if (cardNumber) {
        cardNumbers.add(cardNumber);
      }
    });

    const parallelRows = Array.from(parallelMap.entries()).map(([parallelId, label]) => ({
      setId,
      parallelId,
      label,
      sourceId: source.id,
    }));
    if (parallelRows.length > 0) {
      const createdParallels = await db.setParallel.createMany({
        data: parallelRows,
        skipDuplicates: true,
      });
      counts.parallels += createdParallels.count;
    }

    const scopeRows = Array.from(parallelMap.keys()).map((parallelId) => ({
      setId,
      scopeKey: [programId, parallelId, "none", "any", "any"].join("::"),
      programId,
      parallelId,
      variationId: null,
      formatKey: null,
      channelKey: null,
      sourceId: source.id,
    }));
    if (scopeRows.length > 0) {
      const createdScopes = await db.setParallelScope.createMany({
        data: scopeRows,
        skipDuplicates: true,
      });
      counts.scopes += createdScopes.count;
    }

    const cardRows = Array.from(cardNumbers.values()).map((cardNumber) => ({
      setId,
      programId,
      cardNumber,
      playerName: null,
      sourceId: source.id,
    }));
    if (cardRows.length > 0) {
      const createdCards = await db.setCard.createMany({
        data: cardRows,
        skipDuplicates: true,
      });
      counts.cards += createdCards.count;
    }

    return {
      applied: true,
      sourceId: source.id,
      counts,
    } satisfies TaxonomyLegacyBackfillResult;
  });
}

function dedupeAdapterOutput(output: TaxonomyAdapterOutput): TaxonomyAdapterOutput {
  return {
    ...output,
    programs: dedupeByKey(output.programs, (item) => normalizeLabelKey(item.label)),
    cards: dedupeByKey(output.cards, (item) => `${normalizeLabelKey(item.programLabel)}::${normalizeLabelKey(item.cardNumber)}`),
    variations: dedupeByKey(output.variations, (item) => `${normalizeLabelKey(item.programLabel)}::${normalizeLabelKey(item.label)}`),
    parallels: dedupeByKey(output.parallels, (item) => normalizeLabelKey(item.label)),
    scopes: dedupeByKey(output.scopes, (item) =>
      [
        normalizeLabelKey(item.programLabel),
        normalizeLabelKey(item.parallelLabel),
        normalizeLabelKey(item.variationLabel || ""),
        normalizeLabelKey(item.formatKey || ""),
        normalizeLabelKey(item.channelKey || ""),
      ].join("::")
    ),
    oddsRows: dedupeByKey(output.oddsRows, (item) =>
      [
        normalizeLabelKey(item.programLabel || ""),
        normalizeLabelKey(item.parallelLabel || ""),
        normalizeLabelKey(item.formatKey || ""),
        normalizeLabelKey(item.channelKey || ""),
        normalizeLabelKey(item.oddsText),
      ].join("::")
    ),
    ambiguities: dedupeByKey(output.ambiguities, (item) => normalizeLabelKey(item.key)),
  };
}

function createAdapterOutput(params: TaxonomyIngestParams): { adapter: string; output: TaxonomyAdapterOutput | null; skippedReason?: string } {
  const adapterParams = {
    setId: params.setId,
    datasetType: params.datasetType,
    rawPayload: params.rawPayload,
    sourceUrl: params.sourceUrl,
    parserVersion: params.parserVersion,
    parseSummary: params.parseSummary,
  };

  const adapters: Array<{
    id: string;
    canRun: (nextParams: typeof adapterParams) => boolean;
    build: (nextParams: typeof adapterParams) => TaxonomyAdapterOutput;
  }> = [
    {
      id: "topps-v1",
      canRun: canRunToppsAdapter,
      build: buildToppsTaxonomyAdapterOutput,
    },
    {
      id: "panini-v1",
      canRun: canRunPaniniAdapter,
      build: buildPaniniTaxonomyAdapterOutput,
    },
    {
      id: "upperdeck-v1",
      canRun: canRunUpperDeckAdapter,
      build: buildUpperDeckTaxonomyAdapterOutput,
    },
  ];

  for (const adapter of adapters) {
    if (!adapter.canRun(adapterParams)) {
      continue;
    }
    const output = adapter.build(adapterParams);
    return {
      adapter: adapter.id,
      output: dedupeAdapterOutput(output),
    };
  }

  return {
    adapter: "none",
    output: null,
    skippedReason: "No eligible taxonomy adapter for this source/manufacturer",
  };
}

export async function ingestTaxonomyV2FromIngestionJob(params: TaxonomyIngestParams): Promise<TaxonomyIngestResult> {
  const setId = normalizeSetId(params.setId);
  if (!setId) {
    return {
      applied: false,
      adapter: "none",
      sourceId: null,
      sourceKind: null,
      artifactType: null,
      counts: {
        programs: 0,
        cards: 0,
        variations: 0,
        parallels: 0,
        scopes: 0,
        oddsRows: 0,
        conflicts: 0,
        ambiguities: 0,
        bridges: 0,
      },
      skippedReason: "setId is required",
    };
  }

  const adapterResult = createAdapterOutput(params);
  if (!adapterResult.output) {
    return await prisma.$transaction(async (tx) => {
      const db = tx as TaxonomyTx;
      const source = await db.setTaxonomySource.create({
        data: {
          setId,
          ingestionJobId: params.ingestionJobId,
          artifactType: TaxonomyArtifactType.CHECKLIST,
          sourceKind: TaxonomySourceKind.TRUSTED_SECONDARY,
          sourceLabel: "adapter-missing",
          sourceUrl: sanitizeTaxonomyText(params.sourceUrl) || null,
          parserVersion: sanitizeTaxonomyText(params.parserVersion) || null,
          parserConfidence: 0.3,
          metadataJson: {
            adapter: "none",
            skippedReason: adapterResult.skippedReason,
            parseSummary: params.parseSummary ?? null,
          },
        },
      });

      await queueAmbiguity({
        tx: db,
        setId,
        sourceId: source.id,
        item: {
          entityType: TaxonomyEntityType.PROGRAM,
          key: `adapter-missing::${params.ingestionJobId}`,
          reason: adapterResult.skippedReason || "taxonomy adapter not available",
        },
      });

      return {
        applied: false,
        adapter: adapterResult.adapter,
        sourceId: source.id,
        sourceKind: source.sourceKind,
        artifactType: source.artifactType,
        counts: {
          programs: 0,
          cards: 0,
          variations: 0,
          parallels: 0,
          scopes: 0,
          oddsRows: 0,
          conflicts: 0,
          ambiguities: 1,
          bridges: 0,
        },
        skippedReason: adapterResult.skippedReason,
      } satisfies TaxonomyIngestResult;
    });
  }

  const output = adapterResult.output;

  return await prisma.$transaction(async (tx) => {
    const db = tx as TaxonomyTx;
    const source = await db.setTaxonomySource.create({
      data: {
        setId,
        ingestionJobId: params.ingestionJobId,
        artifactType: output.artifactType,
        sourceKind: output.sourceKind,
        sourceLabel: sanitizeTaxonomyText(output.sourceLabel) || null,
        sourceUrl: sanitizeTaxonomyText(params.sourceUrl) || null,
        parserVersion: sanitizeTaxonomyText(params.parserVersion) || null,
        sourceTimestamp: output.sourceTimestamp ?? null,
        parserConfidence: output.parserConfidence ?? null,
        metadataJson: {
          ...(typeof output.metadata === "object" && output.metadata ? (output.metadata as Record<string, unknown>) : {}),
          parseSummary: params.parseSummary ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    const counts: TaxonomyIngestResult["counts"] = {
      programs: 0,
      cards: 0,
      variations: 0,
      parallels: 0,
      scopes: 0,
      oddsRows: 0,
      conflicts: 0,
      ambiguities: 0,
      bridges: 0,
    };

    const programIdByLabel = new Map<string, string>();
    for (const program of output.programs) {
      const result = await upsertProgram({
        tx: db,
        setId,
        sourceId: source.id,
        sourceKind: source.sourceKind,
        input: program,
      });
      programIdByLabel.set(normalizeLabelKey(program.label), result.programId);
      if (result.created) counts.programs += 1;
      if (result.conflict) counts.conflicts += 1;
    }

    const variationIdByProgramAndLabel = new Map<string, string>();
    for (const variation of output.variations) {
      const result = await upsertVariation({
        tx: db,
        setId,
        sourceId: source.id,
        sourceKind: source.sourceKind,
        input: variation,
        programIdByLabel,
      });
      if (result.variationId) {
        const programId = programIdByLabel.get(normalizeLabelKey(variation.programLabel));
        if (programId) {
          variationIdByProgramAndLabel.set(`${programId}::${normalizeLabelKey(variation.label)}`, result.variationId);
        }
      }
      if (result.created) counts.variations += 1;
      if (result.conflict) counts.conflicts += 1;
      if (result.ambiguity) counts.ambiguities += 1;
    }

    const parallelIdByLabel = new Map<string, string>();
    for (const parallel of output.parallels) {
      const result = await upsertParallel({
        tx: db,
        setId,
        sourceId: source.id,
        sourceKind: source.sourceKind,
        input: parallel,
      });
      parallelIdByLabel.set(normalizeLabelKey(parallel.label), result.parallelId);
      if (result.created) counts.parallels += 1;
      if (result.conflict) counts.conflicts += 1;
    }

    for (const card of output.cards) {
      const result = await upsertCard({
        tx: db,
        setId,
        sourceId: source.id,
        sourceKind: source.sourceKind,
        input: card,
        programIdByLabel,
      });
      if (result.created) counts.cards += 1;
      if (result.conflict) counts.conflicts += 1;
      if (result.ambiguity) counts.ambiguities += 1;
    }

    for (const scope of output.scopes) {
      const result = await upsertScope({
        tx: db,
        setId,
        sourceId: source.id,
        input: scope,
        programIdByLabel,
        parallelIdByLabel,
        variationIdByProgramAndLabel,
      });
      if (result.created) counts.scopes += 1;
      if (result.ambiguity) counts.ambiguities += 1;
    }

    for (const odd of output.oddsRows) {
      const result = await upsertOdds({
        tx: db,
        setId,
        sourceId: source.id,
        sourceKind: source.sourceKind,
        input: odd,
        programIdByLabel,
        parallelIdByLabel,
      });
      if (result.created) counts.oddsRows += 1;
      if (result.conflict) counts.conflicts += 1;
      if (result.ambiguity) counts.ambiguities += 1;
    }

    for (const ambiguity of output.ambiguities) {
      await queueAmbiguity({
        tx: db,
        setId,
        sourceId: source.id,
        item: ambiguity,
      });
      counts.ambiguities += 1;
    }

    counts.bridges = await upsertCompatibilityBridge({ tx: db, setId });

    return {
      applied: true,
      adapter: adapterResult.adapter,
      sourceId: source.id,
      sourceKind: source.sourceKind,
      artifactType: source.artifactType,
      counts,
    } satisfies TaxonomyIngestResult;
  });
}

async function resolveProgramForSet(params: { setId: string; program: string }) {
  const normalizedProgramInput = sanitizeTaxonomyText(params.program);
  if (!normalizedProgramInput) return null;

  const programIdCandidate = normalizeProgramId(normalizedProgramInput);

  const direct = await taxonomyDb.setProgram.findUnique({
    where: {
      setId_programId: {
        setId: params.setId,
        programId: programIdCandidate,
      },
    },
    select: { programId: true, label: true },
  });
  if (direct) return direct;

  const programs = (await taxonomyDb.setProgram.findMany({
    where: { setId: params.setId },
    select: { programId: true, label: true },
    take: 200,
  })) as Array<{ programId: string; label: string }>;
  const normalized = normalizeLabelKey(normalizedProgramInput);
  return (
    programs.find((program: { label: string }) => normalizeLabelKey(program.label) === normalized) ??
    programs.find(
      (program: { label: string }) =>
        normalizeLabelKey(program.label).includes(normalized) || normalized.includes(normalizeLabelKey(program.label))
    ) ??
    null
  );
}

async function resolveVariationForSet(params: {
  setId: string;
  programId: string;
  variation: string;
}) {
  const variationInput = sanitizeTaxonomyText(params.variation);
  if (!variationInput) return null;

  const variationId = normalizeVariationId(variationInput);
  const direct = await taxonomyDb.setVariation.findUnique({
    where: {
      setId_programId_variationId: {
        setId: params.setId,
        programId: params.programId,
        variationId,
      },
    },
    select: { variationId: true, label: true },
  });
  if (direct) return direct;

  const rows = (await taxonomyDb.setVariation.findMany({
    where: {
      setId: params.setId,
      programId: params.programId,
    },
    select: { variationId: true, label: true },
    take: 200,
  })) as Array<{ variationId: string; label: string }>;

  const normalized = normalizeLabelKey(variationInput);
  return (
    rows.find((row: { label: string }) => normalizeLabelKey(row.label) === normalized) ??
    rows.find((row: { label: string }) => normalizeLabelKey(row.label).includes(normalized) || normalized.includes(normalizeLabelKey(row.label))) ??
    null
  );
}

export type TaxonomyScopeResolution = {
  hasTaxonomy: boolean;
  programId: string | null;
  variationId: string | null;
  scopedParallelLabels: string[];
};

export async function resolveTaxonomyScopeForMatcher(params: {
  setId: string;
  program?: string | null;
  variation?: string | null;
  cardNumber?: string | null;
}): Promise<TaxonomyScopeResolution> {
  const setId = normalizeSetId(params.setId);
  if (!setId) {
    return {
      hasTaxonomy: false,
      programId: null,
      variationId: null,
      scopedParallelLabels: [],
    };
  }

  const taxonomyCount = await taxonomyDb.setProgram.count({ where: { setId } });
  if (taxonomyCount < 1) {
    return {
      hasTaxonomy: false,
      programId: null,
      variationId: null,
      scopedParallelLabels: [],
    };
  }

  let resolvedProgramId: string | null = null;
  if (sanitizeTaxonomyText(params.program)) {
    const program = await resolveProgramForSet({ setId, program: sanitizeTaxonomyText(params.program) });
    resolvedProgramId = program?.programId ?? null;
  }

  const normalizedCardNumber = normalizeTaxonomyCardNumber(params.cardNumber);

  let cardProgramIds: string[] | null = null;
  if (normalizedCardNumber && normalizedCardNumber !== "ALL") {
    const cardRows = (await taxonomyDb.setCard.findMany({
      where: {
        setId,
        cardNumber: normalizedCardNumber,
      },
      select: { programId: true },
    })) as Array<{ programId: string }>;
    if (cardRows.length > 0) {
      cardProgramIds = Array.from(new Set(cardRows.map((row: { programId: string }) => row.programId)));
    }
  }

  if (resolvedProgramId && cardProgramIds && !cardProgramIds.includes(resolvedProgramId)) {
    return {
      hasTaxonomy: true,
      programId: resolvedProgramId,
      variationId: null,
      scopedParallelLabels: [],
    };
  }

  const effectiveProgramIds = resolvedProgramId
    ? [resolvedProgramId]
    : cardProgramIds && cardProgramIds.length > 0
    ? cardProgramIds
    : null;

  let resolvedVariationId: string | null = null;
  if (sanitizeTaxonomyText(params.variation) && resolvedProgramId) {
    const variation = await resolveVariationForSet({
      setId,
      programId: resolvedProgramId,
      variation: sanitizeTaxonomyText(params.variation),
    });
    resolvedVariationId = variation?.variationId ?? null;
  }

  const scopes = (await taxonomyDb.setParallelScope.findMany({
    where: {
      setId,
      ...(effectiveProgramIds ? { programId: { in: effectiveProgramIds } } : {}),
      ...(resolvedVariationId ? { variationId: resolvedVariationId } : {}),
    },
    select: {
      parallel: {
        select: {
          label: true,
        },
      },
    },
    take: 1000,
  })) as Array<{ parallel: { label: string } }>;

  const scopedParallelLabels = Array.from(
    new Set(
      scopes
        .map((scope: { parallel: { label: string } }) => sanitizeTaxonomyText(scope.parallel.label))
        .filter(Boolean)
        .map((label: string) => label.toLowerCase())
    )
  ) as string[];

  return {
    hasTaxonomy: true,
    programId: resolvedProgramId,
    variationId: resolvedVariationId,
    scopedParallelLabels,
  };
}

export async function resolveTaxonomyProgramAndVariation(params: {
  setId: string;
  program?: string | null;
  variation?: string | null;
}) {
  const setId = normalizeSetId(params.setId);
  if (!setId) {
    return {
      setId: "",
      programId: null,
      programLabel: null,
      variationId: null,
      variationLabel: null,
      hasTaxonomy: false,
    };
  }

  const taxonomyCount = await taxonomyDb.setProgram.count({ where: { setId } });
  if (taxonomyCount < 1) {
    return {
      setId,
      programId: null,
      programLabel: null,
      variationId: null,
      variationLabel: null,
      hasTaxonomy: false,
    };
  }

  let program = null as { programId: string; label: string } | null;
  if (sanitizeTaxonomyText(params.program)) {
    program = await resolveProgramForSet({ setId, program: sanitizeTaxonomyText(params.program) });
  }

  let variation: { variationId: string; label: string } | null = null;
  if (program?.programId && sanitizeTaxonomyText(params.variation)) {
    variation = await resolveVariationForSet({
      setId,
      programId: program.programId,
      variation: sanitizeTaxonomyText(params.variation),
    });
  }

  return {
    setId,
    programId: program?.programId ?? null,
    programLabel: program?.label ?? null,
    variationId: variation?.variationId ?? null,
    variationLabel: variation?.label ?? null,
    hasTaxonomy: true,
  };
}

export async function resolveScopedParallelToken(params: {
  setId: string;
  programId: string | null;
  variationId?: string | null;
  parallel: string;
}) {
  const setId = normalizeSetId(params.setId);
  const parallelInput = sanitizeTaxonomyText(params.parallel);
  if (!setId || !parallelInput) return null;

  const candidateRows = (await taxonomyDb.setParallel.findMany({
    where: {
      setId,
    },
    select: {
      parallelId: true,
      label: true,
    },
    take: 500,
  })) as Array<{ parallelId: string; label: string }>;

  const normalizedParallelInput = normalizeLabelKey(parallelInput);
  const match =
    candidateRows.find((row: { label: string }) => normalizeLabelKey(row.label) === normalizedParallelInput) ??
    candidateRows.find(
      (row: { label: string }) =>
        normalizeLabelKey(row.label).includes(normalizedParallelInput) ||
        normalizedParallelInput.includes(normalizeLabelKey(row.label))
    ) ??
    null;

  if (!match) return null;

  if (!params.programId) {
    return {
      parallelId: match.parallelId,
      parallelLabel: match.label,
      inScope: true,
    };
  }

  const scoped = await taxonomyDb.setParallelScope.findFirst({
    where: {
      setId,
      programId: params.programId,
      parallelId: match.parallelId,
      ...(params.variationId ? { variationId: params.variationId } : {}),
    },
    select: { id: true },
  });

  return {
    parallelId: match.parallelId,
    parallelLabel: match.label,
    inScope: Boolean(scoped),
  };
}
