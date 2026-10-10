export const MANIFEST_VERSION: 'setops-catalog-evidence/v1';
export const PROPOSAL_VERSION: 'catalog-observation-proposal/v1';
export const LOOKUP_VERSION: 'catalog-evidence-lookup/v1';
export type Category = 'SPORTS' | 'POKEMON';
export type ApplicabilityStatus = 'supported' | 'excluded' | 'unknown';
export type Coverage = { status: 'complete' | 'partial' | 'truncated' | 'unknown'; detail: string; sourceIds: string[] };
export type PublicationPin = { publicationId: string; setId: string; revision: number; manifestSha256: string };
export type CatalogSource = {
  sourceId: string;
  kind: 'OFFICIAL_CHECKLIST' | 'OFFICIAL_PRODUCT' | 'APPROVED_SECONDARY' | 'LISTING' | 'PHYSICAL_OBSERVATION' | 'DERIVED';
  sourceRef: string; sourceUrl: string | null; sha256: string; parentSourceIds: string[]; originKeys: string[];
};
export type CatalogSet = {
  category: Category; setId: string; label: string; year: string;
  manufacturer: string | null; publisher: string | null; sourceIds: string[];
};
export type CatalogProgram = { programId: string; rowId: string; label: string; sourceIds: string[] };
export type CatalogCard = { cardId: string; programId: string; number: string; name: string; numberingScheme: string; sourceIds: string[] };
export type PrintingScope = { language: string | null; edition: string | null; format: string | null; channel: string | null };
export type PrintingKey = PrintingScope & { programId: string; parallelId: string; variationId: string | null };
export type CatalogPrinting = PrintingKey & {
  printingId: string; parallelRowId: string; variationRowId: string | null; scopeRowId: string; label: string;
  sourceIds: string[]; diagnostics: { id: string; description: string; sourceIds: string[] }[];
};
export type CatalogApplicability = { cardId: string; printingId: string; status: ApplicabilityStatus; sourceIds: string[]; note: string };
export type CatalogAlias = {
  kind: 'set_label' | 'program_label' | 'card_name' | 'card_number' | 'printing_label';
  value: string; targetId: string; scope: { category: Category; setId: string; programId: string | null; language: string | null };
  sourceIds: string[];
};
export type ObservationImage = {
  imageId: string; mediaRef: string; sha256: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number; height: number; role: 'front' | 'back' | 'detail'; sourceIds: string[]; parentImageIds: string[];
};
export type CatalogImage = ObservationImage & {
  depicted: { cardId: string; printingId: string }; representsPrintingIds: string[]; visibleDiagnosticIds: string[];
};
export type CatalogManifest = {
  schemaVersion: typeof MANIFEST_VERSION; set: CatalogSet;
  setOps: { draftId: string; draftVersionId: string; legacyVersionHash: string };
  revision: number; supersedes: PublicationPin | null;
  coverage: { text: Coverage; applicability: Coverage; images: Coverage };
  sources: CatalogSource[]; programs: CatalogProgram[]; cards: CatalogCard[]; printings: CatalogPrinting[];
  applicability: CatalogApplicability[]; aliases: CatalogAlias[]; images: CatalogImage[];
};
export type CatalogQuery = {
  category: Category; setId?: string; setLabel?: string; year?: string; manufacturer?: string; publisher?: string;
  programId?: string; programLabel?: string; cardId?: string; cardNumber?: string; cardName?: string;
  printingId?: string; printingLabel?: string; language?: string; edition?: string; format?: string; channel?: string; limit?: number;
};
export type LookupCandidate = {
  card: CatalogCard; program: CatalogProgram; printing: CatalogPrinting; applicability: ApplicabilityStatus;
  recordedApplicability: ApplicabilityStatus; applicabilitySourceIds: string[]; unresolvedScopeFields: (keyof PrintingScope)[];
  images: (CatalogImage & { relationship: 'depicts_candidate_identity' | 'representative_finish' })[];
};
export type LookupResult = {
  schemaVersion: typeof LOOKUP_VERSION; authority: 'host_authorized_setops_publication' | 'unreviewed_manifest';
  publication: (PublicationPin & { setApprovalId: string; reviewedAt: string }) | null;
  set: CatalogSet; coverage: CatalogManifest['coverage']; sources: CatalogSource[];
  outcome: 'not_found' | 'one_candidate' | 'ambiguous'; totalCandidateCount: number; returnedCount: number;
  truncated: boolean; absenceEstablishesExclusion: false; identityDecision: 'consumer_review_required'; candidates: LookupCandidate[];
};
export type PublicationAuthority = PublicationPin & {
  state: 'current' | 'superseded' | 'revoked'; draftId: string; draftVersionId: string;
  setApprovalId: string; reviewedById: string; reviewedAt: string;
};
export type ObservationProposal = {
  schemaVersion: typeof PROPOSAL_VERSION; producer: 'inventory' | 'atlas'; observationId: string; inputRevision: string;
  physicalCardRef: string; observedAt: string; basedOnPublication: PublicationPin | null;
  identity: PrintingScope & {
    category: Category; setId: string | null; programId: string | null; cardId: string | null; printingId: string | null;
    year: string | null; manufacturer: string | null; publisher: string | null; setLabel: string | null;
    name: string | null; cardNumber: string | null;
  };
  sources: CatalogSource[]; images: ObservationImage[]; note: string;
};
export type DeepReadonly<T> = T extends object ? { readonly [P in keyof T]: DeepReadonly<T[P]> } : T;
export type ProposalReceipt = { idempotencyKey: string; proposalSha256: string };
export type PreparedProposal = ProposalReceipt & { disposition: 'requires_authorized_review'; proposal: ObservationProposal };
export class CatalogContractError extends Error { readonly code: string; readonly path: string; constructor(code: string, path: string); }
export function canonicalJson(value: unknown): string;
export function printingIdentityId(category: Category, setId: string, printing: PrintingKey): string;
export function validateManifest(input: unknown): DeepReadonly<CatalogManifest>;
export function hashManifest(manifest: unknown): string;
export function lookupManifestCandidates(manifest: unknown, query: CatalogQuery): DeepReadonly<LookupResult>;
export function compareEvidenceLineage(manifest: unknown, left: { sourceIds: string[]; imageIds: string[] }, right: { sourceIds: string[]; imageIds: string[] }): DeepReadonly<{ relationship: 'shared_lineage' | 'distinct_declared_roots'; sharedRoots: string[] }>;
/** Server composition only. The injected loader must authorize access and read
 * durable human-reviewed authority. Returning arbitrary caller JSON is unsafe. */
export function createPublishedCatalogReader(options: {
  loadAuthorizedPublication: (pin: DeepReadonly<PublicationPin>) => Promise<{ authority: PublicationAuthority; manifest: unknown } | null>;
}): { readonly lookup: (request: { publication: PublicationPin; query: CatalogQuery }) => Promise<DeepReadonly<LookupResult>> };
export function prepareObservationProposal(input: unknown): DeepReadonly<PreparedProposal>;
export function observationRetryDisposition(existingReceipt: ProposalReceipt | null, proposal: unknown): DeepReadonly<{ disposition: 'new' | 'replay'; prepared: PreparedProposal }>;

export const VARIANT_REVIEW_VERSION: 'atlas-variant-catalog/v1';
export const VARIANT_CATALOG_REVISION: 'variant-catalog-2026-10-09-v1';
export const VARIANT_REVIEW_LIMITS: Readonly<{ candidates: 48; imagesPerCandidate: 4; diagnostics: 16; bytes: number }>;
export const VARIANT_WARNING_CODES: readonly string[];
export const VARIANT_PROBLEM_CODES: readonly string[];
export type VariantIdentity = { category: Category; name: string | null; year: string | null; setName: string | null;
  cardNumber: string | null; manufacturer: string | null; language: string | null };
export type VariantImage = { imageId: string; relationship: 'exact' | 'representative' | 'card_art_only'; url: string | null;
  sha256: string | null; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | null; width: number | null; height: number | null;
  publication: PublicationPin | null; provenance: { provider: string; sourceUrl: string | null; sourceSha256: string;
    usage: 'reviewed_catalog' | 'provider_reference' | 'permission_required' }; visibleDiagnosticIds: string[] };
export type VariantCandidate = { candidateId: string; authority: 'reviewed_catalog' | 'provider_candidate'; label: string;
  identity: VariantIdentity; parallel: string | null; canonical: { publication: PublicationPin; cardId: string; printingId: string } | null;
  applicability: 'supported' | 'unknown'; diagnostics: { id: string; description: string }[]; images: VariantImage[];
  source: { provider: string; recordId: string; url: string | null; sha256: string; references: { url: string | null; sha256: string }[] }; warnings: string[] };
export type VariantReviewSnapshot = { schemaVersion: typeof VARIANT_REVIEW_VERSION; demandKey: string; snapshotHash: string; capturedAt: string;
  coverage: Record<'metadata' | 'applicability' | 'images', 'partial' | 'unknown' | 'truncated'>; candidates: VariantCandidate[]; problems: string[] };
export function normalizeVariantIdentity(input: Partial<VariantIdentity> & { category: Category }): DeepReadonly<VariantIdentity>;
export function variantDemandKey(identity: Partial<VariantIdentity> & { category: Category }): string;
export function compareVariantCardNumber(a: string | null, b: string | null): 'match' | 'conflict' | 'unknown';
export function compareVariantIdentity(expected: VariantIdentity, observed: VariantIdentity): DeepReadonly<{ conflicts: (keyof VariantIdentity)[]; unknown: (keyof VariantIdentity)[] }>;
export function isVariantProviderImageUrl(value: unknown, provider: string): boolean;
export function isVariantPhotoComparable(candidate: unknown, image: unknown): boolean;
export function variantCandidateId(candidate: Omit<VariantCandidate, 'candidateId'> | VariantCandidate): string;
export function variantSelectionParallel(candidate: unknown): string;
export function validateVariantCandidate(input: unknown): DeepReadonly<VariantCandidate>;
export function variantSnapshotHash(input: unknown): string;
export function createVariantReviewSnapshot(input: { identity: Partial<VariantIdentity> & { category: Category }; candidates?: readonly DeepReadonly<VariantCandidate>[];
  problems?: string[]; capturedAt: string; truncated?: boolean }): DeepReadonly<VariantReviewSnapshot>;
export function validateVariantReviewSnapshot(input: unknown): DeepReadonly<VariantReviewSnapshot>;
/** Server-only: use results from the authenticated current SetOps publication reader. */
export function variantChoicesFromPublishedLookup(result: DeepReadonly<LookupResult>): readonly DeepReadonly<VariantCandidate>[];

export const VARIANT_SOURCE_CACHE_VERSION: 'variant-source-cache/v1';
export const VARIANT_SOURCE_LIMITS: Readonly<{ responseBytes: number; timeoutMs: number; ttlMs: number; memoryEntries: number }>;
export type VariantSourceCacheEntry = { schemaVersion: typeof VARIANT_SOURCE_CACHE_VERSION; key: string; url: string; body: string;
  sha256: string; capturedAt: string; expiresAt: string };
export type VariantSourceCache = { get(key: string): Promise<VariantSourceCacheEntry | null | undefined>; put(key: string, value: VariantSourceCacheEntry): Promise<unknown> };
export type VariantSourceReceipt = { url: string; sha256: string; capturedAt: string };
export type VariantSourceReader = { json(url: string, options?: { signal?: AbortSignal; budget?: { remaining: number } }): Promise<{ data: unknown; source: VariantSourceReceipt }> };
export function variantSourceCacheKey(url: string): string;
export function validateVariantSourceCacheEntry(entry: unknown, url: string): VariantSourceCacheEntry;
export function createVariantSourceReader(options?: { cache?: VariantSourceCache | null; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number }): VariantSourceReader;
export const TCGDEX_VARIANT_PROVIDER_REVISION: 'tcgdex-variant-import/v1';
export function importTcgdexVariantCandidates(input: { identity: Partial<VariantIdentity> & { category: Category }; language: string;
  card: unknown; set: unknown; cardSource: VariantSourceReceipt; setSource: VariantSourceReceipt }): readonly DeepReadonly<VariantCandidate>[];
export function createTcgdexVariantProvider(options?: { reader?: VariantSourceReader; discoveryLanguage?: string }): {
  readonly id: 'tcgdex'; readonly revision: typeof TCGDEX_VARIANT_PROVIDER_REVISION;
  prepare(identity: Partial<VariantIdentity> & { category: Category }, options?: { signal?: AbortSignal }): Promise<{ candidates: readonly DeepReadonly<VariantCandidate>[]; problems: string[]; truncated: boolean }>;
};

export type VariantDurableCache = { get(key: string): Promise<unknown>; getRetained(key: string): Promise<unknown>; put(key: string, value: unknown): Promise<unknown> };
export type AcquiredVariantImage = { bytes: Uint8Array; sha256: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number };
export type VariantProviderImageReader = {
  read(url: string, options?: { signal?: AbortSignal; expectedSha256?: string | null }): Promise<AcquiredVariantImage>;
  readRetained(url: string, options: { signal?: AbortSignal; expectedSha256: string }): Promise<AcquiredVariantImage>;
};
export const VARIANT_PROVIDER_MEDIA_LIMITS: Readonly<{ bytes: number; pixels: number; timeoutMs: number; ttlMs: number }>;
export function createVariantProviderImageReader(options: { cache: VariantDurableCache;
  inspectImage(bytes: Uint8Array): Promise<{ mimeType: string; width: number; height: number }>; fetchImpl?: typeof fetch; now?: () => number }): VariantProviderImageReader;
export const SCRYDEX_METADATA_LIMITS: Readonly<{ bytes: number; timeoutMs: number; ttlMs: number; requestsPerPrepare: number }>;
export type ScrydexMetadataReader = VariantSourceReader & { retained(url: string, sha256: string): Promise<{ data: unknown; source: VariantSourceReceipt }> };
export function isScrydexMetadataUrl(url: unknown): boolean;
export function createScrydexMetadataReader(options: { apiKey: string; teamId: string; cache: VariantDurableCache; fetchImpl?: typeof fetch; now?: () => number }): ScrydexMetadataReader;
export const SCRYDEX_VARIANT_PROVIDER_REVISION: 'scrydex-variant-import/v1';
export function scrydexVariantSearchUrl(identity: Partial<VariantIdentity> & { category: Category }): string;
export function importScrydexVariantCandidates(input: { identity: Partial<VariantIdentity> & { category: Category }; card: unknown; source: VariantSourceReceipt }): readonly DeepReadonly<VariantCandidate>[];
export function createScrydexVariantProvider(options: { reader: ScrydexMetadataReader; imageReader?: VariantProviderImageReader | null }): {
  readonly id: 'scrydex'; readonly revision: typeof SCRYDEX_VARIANT_PROVIDER_REVISION;
  prepare(identity: Partial<VariantIdentity> & { category: Category }, options?: { signal?: AbortSignal }): Promise<{ candidates: readonly DeepReadonly<VariantCandidate>[]; problems: string[]; truncated: boolean }>;
  readImage(input: { candidate: DeepReadonly<VariantCandidate>; image: DeepReadonly<VariantImage> }, options?: { signal?: AbortSignal }): Promise<AcquiredVariantImage>;
};

export interface CatalogDemand { category: 'SPORTS' | 'POKEMON'; year: string; manufacturer: string | null; setName: string; language: string | null }
export interface CatalogDemandSource { sourceId: string; url: string; sha256: string; kind: 'manufacturer' | 'secondary'; byteSize: number }
export interface CatalogDemandChoice { rowId: string; identity: CatalogDemand & { name: string; cardNumber: string }; parallel: string; sourceId: string; locator: string; diagnostics: string[] }
export interface CatalogDemandResult { schemaVersion: 'catalog-demand-result/v1'; demandKey: string; demand: CatalogDemand;
  state: 'QUEUED' | 'RUNNING' | 'READY' | 'UNAVAILABLE'; attempt: number; coverage: 'partial' | 'unknown' | 'truncated';
  sources: CatalogDemandSource[]; choices: CatalogDemandChoice[];
  context: { parallel: string; program: string | null; serial: string | null; sourceId: string; locator: string }[];
  problems: string[]; capturedAt: string; snapshotHash: string }
export const CATALOG_DEMAND_VERSION: 'catalog-demand-result/v1';
export const CATALOG_DEMAND_POLICY: string;
export const CATALOG_DEMAND_LIMITS: Readonly<{ sources: number; rows: number; choices: number; context: number; resultBytes: number }>;
export function normalizeCatalogDemand(input: unknown): CatalogDemand;
export function catalogDemandKey(input: unknown): string;
export function catalogDemandResultHash(input: unknown): string;
export function validateCatalogDemandResult(input: unknown): CatalogDemandResult;
export function validateCatalogDemandAcquisition(input: unknown): CatalogDemandResult;
export function filterCatalogDemandResult(input: unknown, card?: { name: string; cardNumber: string } | null): CatalogDemandResult;
export function isCatalogDemandSourceUrl(input: unknown): boolean;
export function catalogDemandSourceKind(url: string): 'manufacturer' | 'secondary';
