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
