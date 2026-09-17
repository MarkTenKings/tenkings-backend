import { isDeepStrictEqual } from "node:util";
import { SetDatasetType, type Prisma } from "@tenkings/database";
import type { TaxonomyAdapterOutput, TaxonomyAdapterParams, TaxonomyCardInput } from "./taxonomyV2AdapterTypes";
import { TaxonomyArtifactType, TaxonomySourceKind } from "./taxonomyV2Enums";
import { normalizeProgramId, normalizeTaxonomyCardNumber, sanitizeTaxonomyText } from "./taxonomyV2Utils";

type RecordValue = Record<string, unknown>;
type ChecklistPin = {
  sourceId: string;
  url: string;
  sha256: string;
  byteSize: number;
  provider: string;
  canonicalSetId: string | null;
  pages: number;
};

// Source pins classify provenance, not transcription correctness or reuse rights.
// Pokémon remains disabled until an authorized host reconciles its actual set ID.
const CHECKLIST_PINS: readonly ChecklistPin[] = [
  {
    sourceId: "sports-checklist",
    url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/2023BowmanUChromeFBChecklistNEW.pdf",
    sha256: "bf2f692f03dc215238001ed465d7ecda8bbf361cb459276b60482b839bc2a4ca",
    byteSize: 529104,
    provider: "Topps",
    canonicalSetId: "2023_Bowman_University_Chrome_Football",
    pages: 18,
  },
  {
    sourceId: "pokemon-checklist",
    url: "https://assets.pokemon.com/assets/cms2/pdf/trading-card-game/checklist/bw11_web_cardlist_en.pdf",
    sha256: "d597ba707c20f1f8ec11e4809bb1f6e85bb0e502c05a93df41f36116a56dc923",
    byteSize: 2227474,
    provider: "Pokémon",
    canonicalSetId: null,
    pages: 1,
  },
];

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function boundSource(params: TaxonomyAdapterParams): { pin: ChecklistPin; sourceFetchMeta: RecordValue } | null {
  if (params.datasetType !== SetDatasetType.PLAYER_WORKSHEET) return null;
  const pin = CHECKLIST_PINS.find((entry) => entry.url === params.sourceUrl);
  const sourceFetchMeta = record(params.parseSummary?.sourceFetchMeta);
  if (!pin?.canonicalSetId || params.setId !== pin.canonicalSetId || !sourceFetchMeta
    || params.parseSummary?.sourceProvider !== pin.provider
    || sourceFetchMeta.sourceId !== pin.sourceId || sourceFetchMeta.url !== pin.url
    || sourceFetchMeta.sha256 !== pin.sha256 || sourceFetchMeta.byteSize !== pin.byteSize
    || (sourceFetchMeta.setId != null && sourceFetchMeta.setId !== pin.canonicalSetId)
    || [params.parseSummary?.sourceKind, sourceFetchMeta.sourceKind].some(
      (kind) => kind != null && kind !== TaxonomySourceKind.OFFICIAL_CHECKLIST
    )) return null;
  return { pin, sourceFetchMeta };
}

function jsonCopy<T>(value: T, maxBytes: number): T {
  const text = JSON.stringify(value, (_key, entry: unknown) => {
    if (entry === undefined || typeof entry === "function" || typeof entry === "symbol" || typeof entry === "bigint"
      || (typeof entry === "number" && !Number.isFinite(entry))) throw new Error("Checklist metadata must be finite JSON.");
    return entry;
  });
  if (!text || Buffer.byteLength(text) > maxBytes) throw new Error("Checklist metadata exceeds its bounded JSON size.");
  return JSON.parse(text) as T;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length > 256 || /[<>]/.test(value)
    || [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error(`Checklist ${field} must be bounded text.`);
  }
  const text = sanitizeTaxonomyText(value);
  if (!text) throw new Error(`Checklist ${field} is required.`);
  return text;
}

export function canRunPilotChecklistAdapter(params: TaxonomyAdapterParams): boolean {
  return boundSource(params) !== null;
}

function exactShape(value: unknown, keys: readonly string[], label: string): RecordValue {
  const result = record(value);
  if (!result || Object.keys(result).some((key) => !keys.includes(key))) {
    throw new Error(`Checklist ${label} has an unsupported raw shape.`);
  }
  return result;
}

/** Validate every original row before legacy normalization can deduplicate or
 * filter it. This is deliberately limited to the pinned checklist path. */
export function validatePilotChecklistOriginalInput(params: TaxonomyAdapterParams): boolean {
  if (params.datasetType !== SetDatasetType.PLAYER_WORKSHEET) return false;
  const sourceMeta = record(params.parseSummary?.sourceFetchMeta);
  const claimsPilot = CHECKLIST_PINS.some((pin) => pin.url === params.sourceUrl
    || pin.url === sourceMeta?.url || pin.sourceId === sourceMeta?.sourceId);
  if (!claimsPilot) return false;
  if (!boundSource(params)) throw new Error("Exact pinned checklist source and configured canonical set binding are required.");
  if (params.rawPayload === undefined) throw new Error("Pinned checklist original raw payload is required.");
  const raw = jsonCopy(params.rawPayload, 2 * 1024 * 1024);
  const projected: RecordValue[] = [];
  const append = (row: RecordValue) => {
    if (projected.length >= 1000) throw new Error("Checklist original input exceeds 1000 rows.");
    projected.push(row);
  };
  if (Array.isArray(raw)) {
    // One explicit flat form; aliases and embedded alternate row containers are
    // rejected rather than interpreted by a permissive legacy parser.
    for (const value of raw) {
      append(exactShape(value, ["setId", "sourceUrl", "programLabel", "cardNumber", "playerName", "team", "isRookie", "metadataJson"], "flat row"));
    }
  } else {
    const payload = exactShape(raw, ["setId", "sourceUrl", "programs"], "payload");
    if (payload.setId !== params.setId || payload.sourceUrl !== params.sourceUrl
      || !Array.isArray(payload.programs) || payload.programs.length < 1 || payload.programs.length > 1000) {
      throw new Error("Checklist original payload has invalid set/source/program binding.");
    }
    for (const value of payload.programs) {
      const program = exactShape(value, ["label", "cards"], "program");
      if (!Array.isArray(program.cards) || program.cards.length < 1 || program.cards.length > 1000) {
        throw new Error("Checklist original program requires a bounded nonempty card roster.");
      }
      for (const value of program.cards) {
        const card = exactShape(value, ["cardNumber", "playerName", "team", "isRookie", "metadata"], "card");
        append({
          setId: payload.setId,
          sourceUrl: payload.sourceUrl,
          programLabel: program.label,
          cardNumber: card.cardNumber,
          playerName: card.playerName,
          team: card.team ?? null,
          isRookie: card.isRookie ?? null,
          metadataJson: card.metadata,
        });
      }
    }
  }
  // No row was filtered or deduplicated before this all-or-nothing validation.
  buildPilotChecklistTaxonomyAdapterOutput({ ...params, rawPayload: projected });
  return true;
}

export function buildPilotChecklistTaxonomyAdapterOutput(params: TaxonomyAdapterParams): TaxonomyAdapterOutput {
  const binding = boundSource(params);
  if (!binding) throw new Error("Exact pinned checklist source and configured canonical set binding are required.");
  const { pin } = binding;
  const sourceFetchMeta = jsonCopy(binding.sourceFetchMeta, 16384);
  if (!Array.isArray(params.rawPayload) || params.rawPayload.length < 1 || params.rawPayload.length > 1000) {
    throw new Error("Checklist requires between 1 and 1000 projected rows.");
  }
  const rows = jsonCopy(params.rawPayload, 2 * 1024 * 1024);
  const programs = new Map<string, TaxonomyAdapterOutput["programs"][number]>();
  const cards = new Map<string, TaxonomyCardInput>();
  for (const [rowIndex, value] of rows.entries()) {
    const row = record(value);
    const metadata = record(row?.metadataJson);
    if (!row || row.setId !== pin.canonicalSetId || row.sourceUrl !== pin.url || !metadata
      || metadata.sourceId !== pin.sourceId || metadata.sourceSha256 !== pin.sha256
      || (metadata.sourceUrl != null && metadata.sourceUrl !== pin.url)
      || !Number.isInteger(metadata.sourcePage) || Number(metadata.sourcePage) < 1 || Number(metadata.sourcePage) > pin.pages
      || (sourceFetchMeta.sourcePage != null && metadata.sourcePage !== sourceFetchMeta.sourcePage)
      || (metadata.sourceKind != null && metadata.sourceKind !== TaxonomySourceKind.OFFICIAL_CHECKLIST)) {
      throw new Error(`Checklist row ${rowIndex + 1} has invalid source binding.`);
    }
    const programLabel = requiredText(row.programLabel, "program label");
    if ([row.program, row.cardType].some((label) => label != null && requiredText(label, "program alias") !== programLabel)) {
      throw new Error(`Checklist row ${rowIndex + 1} has conflicting program labels.`);
    }
    const number = requiredText(row.cardNumber, "card number");
    const cardNumber = normalizeTaxonomyCardNumber(number);
    if (!cardNumber || cardNumber === "ALL" || !/^[A-Z0-9][A-Z0-9./_-]{0,63}$/.test(cardNumber)) throw new Error("Checklist card number is invalid.");
    const playerName = requiredText(row.playerName, "printed name");
    if (row.playerSeed != null && requiredText(row.playerSeed, "printed name alias") !== playerName) {
      throw new Error(`Checklist row ${rowIndex + 1} has conflicting printed names.`);
    }
    if (row.isRookie != null && typeof row.isRookie !== "boolean") throw new Error("Checklist rookie field must be explicit boolean or null.");
    const programId = normalizeProgramId(programLabel);
    const priorProgram = programs.get(programId);
    if (priorProgram && priorProgram.label !== programLabel) throw new Error("Checklist program labels collide after canonical normalization.");
    programs.set(programId, priorProgram ?? { label: programLabel, codePrefix: null, programClass: null, rowIndex });
    const card: TaxonomyCardInput = {
      programLabel,
      cardNumber,
      playerName,
      team: row.team == null ? null : requiredText(row.team, "team"),
      isRookie: (row.isRookie as boolean | null | undefined) ?? null,
      metadata: jsonCopy(metadata, 16384),
    };
    const key = JSON.stringify([programId, cardNumber]);
    const existing = cards.get(key);
    if (existing && !isDeepStrictEqual(existing, card)) throw new Error(`Checklist has conflicting duplicate identity ${cardNumber}.`);
    if (!existing) cards.set(key, card);
  }
  // Return only after every row is validated. The existing writer owns the
  // transaction and approval lifecycle; pins confer no new review authority.
  return {
    sourceKind: TaxonomySourceKind.OFFICIAL_CHECKLIST,
    artifactType: TaxonomyArtifactType.CHECKLIST,
    sourceLabel: "pinned_pilot_checklist_v1",
    parserConfidence: null,
    metadata: {
      adapter: "pinned-pilot-checklist-v1",
      authority: "unreviewed_source_transcription",
      sourcePinMatched: true,
      sourceProvider: pin.provider,
      sourceUrl: pin.url,
      parserVersion: params.parserVersion ?? null,
      sourceBytesVerifiedByAdapter: false,
      transcriptionVerified: false,
      rightsVerified: false,
      humanReviewed: false,
      sourceFetchMeta: sourceFetchMeta as Prisma.InputJsonObject,
      rowCount: rows.length,
      programCount: programs.size,
      cardCount: cards.size,
    },
    programs: [...programs.values()],
    cards: [...cards.values()],
    variations: [], parallels: [], scopes: [], oddsRows: [], ambiguities: [],
  };
}
