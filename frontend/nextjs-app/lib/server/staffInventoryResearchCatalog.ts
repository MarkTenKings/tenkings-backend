import { createHash } from 'node:crypto';
import { canonicalJson, type CatalogQuery, type DeepReadonly, type LookupResult, type PublicationPin } from '@tenkings/card-catalog-evidence';
import { StaffInventoryResearchReferenceSchema, type StaffInventoryResearchCatalogContext, type StaffInventoryResearchDescription, type StaffInventoryResearchReference } from '../staffInventoryResearch';


export type CatalogPhotos = Partial<Record<'front' | 'back', { key?: string; sha256: string; bytes: Buffer; mimeType?: 'image/jpeg' | 'image/png' | 'image/webp'; sourceSha256?: string | null }>>;
export type CatalogScopeEvidence = StaffInventoryResearchCatalogContext['scope_evidence'];
export type ResearchCatalogSnapshot = { context: StaffInventoryResearchCatalogContext; references: StaffInventoryResearchReference[] };
type CatalogHost = Pick<typeof import('./setCatalogEvidence'), 'findCurrentSetCatalogPublications' | 'lookupPublishedSetCatalogEvidence' | 'isSetCatalogPublicationCurrent' | 'readPublishedSetCatalogImage'>;
export type CatalogScopeResolver = (input: { choices: Record<'language' | 'edition' | 'format' | 'channel', string[]>; photos: CatalogPhotos }, signal: AbortSignal) => Promise<{ evidence: CatalogScopeEvidence; receipt: StaffInventoryResearchCatalogContext['scope_receipt'] }>;
const fields = ['language', 'edition', 'format', 'channel'] as const;
const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const pinKey = (pin: PublicationPin) => canonicalJson(pin);

export function researchCatalogQuery(description: StaffInventoryResearchDescription): CatalogQuery | null {
  const category = description.category?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const family = category === 'pokemon' ? 'POKEMON' : category === 'sports' || category === 'sports cards' ? 'SPORTS' : null;
  if (!family || !description.year || !description.set_name || !description.card_number || !description.name) return null;
  return { category: family, year: description.year, setLabel: description.set_name, cardNumber: description.card_number, cardName: description.name,
    ...(description.manufacturer ? family === 'SPORTS' ? { manufacturer: description.manufacturer } : { publisher: description.manufacturer } : {}), limit: 24 };
}

/** Converts host-authorized positive card/printing applicability, including
 * supported evidence in a partial catalog. Truncation or unknown scope cannot
 * supply reference authority. */
export function catalogResearchReferences(lookups: readonly DeepReadonly<LookupResult>[], target?: { sha256s: readonly string[]; originKeys: readonly string[] }): StaffInventoryResearchReference[] {
  const references: StaffInventoryResearchReference[] = [];
  for (const lookup of lookups) {
    if (lookup.authority !== 'host_authorized_setops_publication' || !lookup.publication || lookup.truncated
      || lookup.coverage.text.status === 'truncated' || lookup.coverage.applicability.status === 'truncated'
      || !Number.isSafeInteger(lookup.returnedCount) || lookup.returnedCount <= 0 || lookup.returnedCount !== lookup.candidates.length
      || !Number.isSafeInteger(lookup.totalCandidateCount) || lookup.totalCandidateCount !== lookup.returnedCount) continue;
    const { setApprovalId: _approval, reviewedAt, ...publication } = lookup.publication;
    const sources = new Map(lookup.sources.map(source => [source.sourceId, source]));
    const images = new Map(lookup.candidates.flatMap(candidate => candidate.images).map(image => [image.imageId, image]));
    const independentImage = (imageId: string): boolean => {
      if (!target) return true;
      const seenSources = new Set<string>(), seenImages = new Set<string>();
      const sourceAllowed = (sourceId: string): boolean => {
        if (seenSources.has(sourceId)) return true;
        seenSources.add(sourceId);
        const source = sources.get(sourceId);
        return Boolean(source && !target.sha256s.includes(source.sha256) && !source.originKeys.some(root => target.originKeys.includes(root))
          && source.parentSourceIds.every(sourceAllowed));
      };
      const imageAllowed = (id: string): boolean => {
        if (seenImages.has(id)) return true;
        seenImages.add(id);
        const image = images.get(id);
        // A parent absent from this bounded lookup cannot establish independent
        // image lineage. Keep the authoritative text, omit that visual example.
        return Boolean(image && !target.sha256s.includes(image.sha256) && image.sourceIds.every(sourceAllowed)
          && image.parentImageIds.every(imageAllowed));
      };
      return imageAllowed(imageId);
    };
    for (const candidate of lookup.candidates) {
      if (candidate.applicability !== 'supported' || candidate.unresolvedScopeFields.length || fields.some(field => candidate.printing[field] === null)) continue;
      const catalogId = `catalog:${sha([publication, candidate.card.cardId, candidate.printing.printingId])}`;
      const features = candidate.printing.diagnostics.map(d => d.description).slice(0, 16);
      const common = {
        catalog_id: catalogId, identity: { name: candidate.card.name, category: lookup.set.category === 'SPORTS' ? 'Sports cards' : 'Pokémon',
          year: lookup.set.year, manufacturer: lookup.set.manufacturer ?? lookup.set.publisher, set_name: lookup.set.label, card_number: candidate.card.number },
        variant_name: candidate.printing.label,
        variant_kind: candidate.printing.variationId ? 'VARIANT' : candidate.printing.parallelId.toLowerCase() === 'base' ? 'BASE' : 'PARALLEL',
        source_url: null, source_sha256: publication.manifestSha256, captured_at: reviewedAt,
        distinguishing_features: features,
        catalog_binding: { publication, card_id: candidate.card.cardId, printing_id: candidate.printing.printingId, applicability: 'supported',
          scope: Object.fromEntries(fields.map(field => [field, candidate.printing[field]])), image_id: null, image_relationship: null,
          image_depicted: null, image_represents_printing_ids: [], image_visible_diagnostic_ids: [] },
      };
      const catalog = StaffInventoryResearchReferenceSchema.safeParse({ ...common, id: catalogId, kind: 'catalog', trust: 'published_catalog', image: null });
      if (!catalog.success) continue;
      references.push(catalog.data);
      // Only reviewed diagnostics visible in this representative image are
      // exposed as image evidence. The depicted card can be a different card.
      for (const image of candidate.images.slice(0, 4)) {
        if (!independentImage(image.imageId)) continue;
        const visibleFeatures = candidate.printing.diagnostics.filter(d => image.visibleDiagnosticIds.includes(d.id)).map(d => d.description).slice(0, 16);
        if (!visibleFeatures.length) continue;
        const entry = StaffInventoryResearchReferenceSchema.safeParse({ ...common, id: `reference:${sha([catalogId, image.imageId])}`, kind: 'reference', trust: 'approved_reference',
          distinguishing_features: visibleFeatures,
          catalog_binding: { ...common.catalog_binding, image_id: image.imageId, image_relationship: image.relationship,
            image_depicted: { card_id: image.depicted.cardId, printing_id: image.depicted.printingId },
            image_represents_printing_ids: [...image.representsPrintingIds], image_visible_diagnostic_ids: [...image.visibleDiagnosticIds] },
          image: { source_url: null, storage_key: null, sha256: image.sha256, content_type: image.mimeType } });
        if (entry.success) references.push(entry.data);
      }
    }
  }
  // Never silently truncate competing evidence and then imply exhaustive coverage.
  return references.length > 24 ? [] : references;
}

export function createResearchCatalogAdapter(dependencies: { host?: CatalogHost; resolveScope?: CatalogScopeResolver; targetOriginKeys?: readonly string[] } = {}) {
  const host = async () => dependencies.host ?? await import('./setCatalogEvidence');
  async function load(description: StaffInventoryResearchDescription, photos: CatalogPhotos, signal: AbortSignal): Promise<ResearchCatalogSnapshot> {
    const context: StaffInventoryResearchCatalogContext = { schema_version: 1, status: 'no_publication', publications: [], scope_evidence: [], scope_receipt: null };
    const query = researchCatalogQuery(description);
    if (!query || signal.aborted) return { context, references: [] };
    const api = await host(), pins = await api.findCurrentSetCatalogPublications({ query, consumer: 'inventory' });
    if (pins.length > 8 || new Set(pins.map(pinKey)).size !== pins.length) throw new Error('Invalid catalog discovery.');
    if (!pins.length) return { context, references: [] };
    const read = (q: CatalogQuery) => Promise.all(pins.map(publication => api.lookupPublishedSetCatalogEvidence({ publication, query: q, consumer: 'inventory' })));
    let lookups = await read(query);
    const choices = Object.fromEntries(fields.map(field => [field, [...new Set(lookups.flatMap(l => l.candidates.map(c => c.printing[field])).filter((v): v is string => v !== null && v !== 'not_applicable'))].slice(0, 32)])) as Record<typeof fields[number], string[]>;
    if (dependencies.resolveScope && photos.front && photos.back && photos.front.sha256 !== photos.back.sha256 && fields.some(f => choices[f].length)) {
      const { evidence, receipt } = await dependencies.resolveScope({ choices, photos }, signal);
      if (evidence.length && !receipt || receipt?.images.some(image => photos[image.side]?.sha256 !== image.transmitted_sha256) || evidence.length > 4 || new Set(evidence.map(e => e.field)).size !== evidence.length || evidence.some(e => !choices[e.field].includes(e.value) || photos[e.side]?.sha256 !== e.photo_sha256)) throw new Error('Invalid observed catalog scope.');
      context.scope_evidence = evidence; context.scope_receipt = receipt;
      lookups = await read({ ...query, ...Object.fromEntries(evidence.map(e => [e.field, e.value])) });
    }
    for (const [index, lookup] of lookups.entries()) {
      if (!lookup.publication || lookup.authority !== 'host_authorized_setops_publication') throw new Error('Missing catalog authority.');
      const { setApprovalId: _approval, reviewedAt: _reviewed, ...pin } = lookup.publication;
      if (pinKey(pin) !== pinKey(pins[index])) throw new Error('Catalog pin changed.');
      context.publications.push({ publication: pin, lookup_sha256: sha(lookup), coverage: { text: lookup.coverage.text.status, applicability: lookup.coverage.applicability.status, images: lookup.coverage.images.status },
        candidate_count: lookup.totalCandidateCount, returned_count: lookup.returnedCount, truncated: lookup.truncated });
    }
    if (signal.aborted) throw new Error('Catalog lookup cancelled.');
    context.status = 'current';
    return { context, references: catalogResearchReferences(lookups, {
      sha256s: Object.values(photos).flatMap(photo => photo ? [photo.sha256, ...(photo.sourceSha256 ? [photo.sourceSha256] : [])] : []),
      originKeys: dependencies.targetOriginKeys ?? [],
    }) };
  }
  async function current(snapshot: ResearchCatalogSnapshot, signal: AbortSignal) {
    if (signal.aborted) return false;
    const api = await host();
    const results = await Promise.all(snapshot.context.publications.map(entry => api.isSetCatalogPublicationCurrent(entry.publication, 'inventory')));
    return !signal.aborted && results.every(Boolean);
  }
  async function image(reference: StaffInventoryResearchReference, signal: AbortSignal) {
    const binding = reference.catalog_binding;
    if (signal.aborted || !binding?.image_id || !reference.image) throw new Error('Unbound catalog image.');
    const verified = await (await host()).readPublishedSetCatalogImage({ publication: binding.publication, imageId: binding.image_id, consumer: 'inventory' });
    if (signal.aborted || verified.sha256 !== reference.image.sha256 || verified.mimeType !== reference.image.content_type) throw new Error('Catalog image binding changed.');
    return verified.bytes;
  }
  return { load, current, image };
}
