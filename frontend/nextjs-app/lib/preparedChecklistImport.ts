import { z } from "zod";

export const PREPARED_CHECKLIST_MAX_BYTES = 768 * 1024;
const text = (max = 256) => z.string().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f<>]/.test(value), "Unsupported text");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const url = z.string().url().max(2048).refine(value => value.startsWith("https://"), "HTTPS source required");
const authority = z.literal("unreviewed_source_transcription");
const sourceId = z.literal("pokemon-checklist");
const sourceKind = z.literal("OFFICIAL_CHECKLIST");
const metadataSchema = z.strictObject({
  authority, sourceId, sourceUrl: url, sourceSha256: hash, sourceKind,
  sourcePage: z.number().int().positive(), sourceColumn: z.number().int().positive(), sourceRowOrdinal: z.number().int().positive(),
  transcriptionSha256: hash, printedNumber: text(), printedName: text(),
  literalChecklistMarkers: z.array(text()).max(10), literalRarityMarker: z.strictObject({ label: text(), symbol: text() }),
  language: z.literal("en"), numberingScheme: z.literal("manufacturer_checklist_number_no_denominator_in_source"),
  collectorNumberDenominator: z.null(), physicalFinish: z.null(), edition: z.null(), format: z.null(), channel: z.null(), humanReviewed: z.literal(false),
});
const wrapperSchema = z.strictObject({
  schemaVersion: z.literal("tenkings-complete-checklist-import-draft/v1"),
  status: z.literal("UNSUBMITTED_NEW_SET_BINDING_NO_DATABASE_RECORD"), authority,
  transcriptionSha256: hash, mappingReceiptSha256: hash,
  binding: z.strictObject({
    setId: text(), displayLabel: text(), programLabel: text(), proposedProgramId: text(),
    draftId: z.null(), programRowId: z.null(), separateRcProgram: z.null(), databaseRecordCreated: z.literal(false),
  }),
  requestDraft: z.strictObject({
    setId: text(), datasetType: z.literal("PLAYER_WORKSHEET"), sourceUrl: url,
    sourceProvider: z.literal("Pokémon"), parserVersion: z.literal("catalog-pilot-complete-pokemon-transcription-v1"),
    sourceQuery: z.strictObject({ pilot: z.literal("pokemon"), product: text(), program: text(), scope: text(512) }),
    sourceFetchMeta: z.strictObject({
      setId: text(), sourceId, url, sha256: hash, byteSize: z.number().int().positive(), sourceKind,
      sourcePage: z.number().int().positive(), sourceManifestSha256: hash, transcriptionSha256: hash, mappingReceiptSha256: hash,
      displaySourceLabel: text(), printedRowCount: z.number().int().min(1).max(1000), fullCardPrintingUniverse: z.literal("unknown"),
      sourceBytesVerifiedByPreparation: z.literal(false), humanReviewed: z.literal(false), rightsVerified: z.literal(false),
      grant: z.null(), images: z.array(z.never()).length(0),
    }),
    rawPayload: z.strictObject({
      setId: text(), sourceUrl: url, programs: z.array(z.strictObject({
        label: text(), cards: z.array(z.strictObject({
          cardNumber: text(), playerName: text(), team: z.null(), isRookie: z.null(), metadata: metadataSchema,
        })).min(1).max(1000),
      })).length(1),
    }),
  }),
  limits: z.array(text(512)).min(1).max(20), grant: z.null(), images: z.array(z.never()).length(0), reviewer: z.null(), publication: z.null(),
});

/** Browser shape/consistency checks only. The existing server original-input
 * validator remains authoritative for configured source pins when building a
 * draft. Neither this parser nor the uploaded hashes attest source PDF bytes. */
export function parsePreparedChecklistImport(input: string) {
  if (new TextEncoder().encode(input).byteLength > PREPARED_CHECKLIST_MAX_BYTES) {
    throw new Error("Prepared checklist file exceeds 768 KiB.");
  }
  let value: unknown;
  try { value = JSON.parse(input); } catch { throw new Error("Prepared checklist must be a JSON file."); }
  const parsed = wrapperSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Unsupported prepared checklist at ${issue.path.join(".") || "wrapper"}: ${issue.message}`);
  }
  const wrapper = parsed.data;
  const request = wrapper.requestDraft;
  const source = request.sourceFetchMeta;
  const program = request.rawPayload.programs[0];
  const cards = program.cards;
  if (wrapper.binding.setId !== request.setId || request.rawPayload.setId !== request.setId || source.setId !== request.setId
    || request.rawPayload.sourceUrl !== request.sourceUrl || source.url !== request.sourceUrl
    || wrapper.transcriptionSha256 !== source.transcriptionSha256 || wrapper.mappingReceiptSha256 !== source.mappingReceiptSha256
    || wrapper.binding.programLabel !== program.label || request.sourceQuery.program !== program.label
    || wrapper.binding.displayLabel !== source.displaySourceLabel || request.sourceQuery.product !== wrapper.binding.displayLabel
    || source.printedRowCount !== cards.length || new Set(cards.map(card => card.cardNumber)).size !== cards.length) {
    throw new Error("Prepared checklist has inconsistent set, source, program or row-count fields.");
  }
  for (const [index, card] of cards.entries()) {
    const metadata = card.metadata;
    if (metadata.sourceUrl !== request.sourceUrl || metadata.sourceSha256 !== source.sha256 || metadata.sourcePage !== source.sourcePage
      || metadata.transcriptionSha256 !== wrapper.transcriptionSha256 || metadata.printedNumber !== card.cardNumber
      || metadata.printedName !== card.playerName || metadata.sourceRowOrdinal !== index + 1) {
      throw new Error(`Prepared checklist row ${index + 1} has inconsistent source fields.`);
    }
  }
  return { requestDraft: request, requestBody: JSON.stringify(request), displayLabel: wrapper.binding.displayLabel, rowCount: cards.length };
}

export type PreparedChecklistImport = ReturnType<typeof parsePreparedChecklistImport>;

export function assertGenericImportPayload(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)
    && (Object.hasOwn(value, "requestDraft") || ("schemaVersion" in value
      && String(value.schemaVersion).startsWith("tenkings-complete-checklist-import-draft/")))) {
    throw new Error("Use Prepared checklist import for this envelope; generic upload cannot preserve its source fields.");
  }
}
