import { createHash } from 'node:crypto';

export const MANIFEST_VERSION = 'setops-catalog-evidence/v1';
export const PROPOSAL_VERSION = 'catalog-observation-proposal/v1';
export const LOOKUP_VERSION = 'catalog-evidence-lookup/v1';
const HASH = /^[a-f0-9]{64}$/;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}$/;
const AUTHORITATIVE = new Set(['OFFICIAL_CHECKLIST', 'OFFICIAL_PRODUCT', 'APPROVED_SECONDARY']);
const DIMENSIONS = ['language', 'edition', 'format', 'channel'];
const MAX_BYTES = 4 * 1024 * 1024;

export class CatalogContractError extends Error {
  constructor(code, path) {
    super(`${code}: ${path}`);
    this.name = 'CatalogContractError';
    this.code = code;
    this.path = path;
  }
}
function fail(code, path) { throw new CatalogContractError(code, path); }
function check(test, code, path) { if (!test) fail(code, path); }
function object(value, keys, path) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_OBJECT', path);
  check(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'INVALID_FIELDS', path);
}
function text(value, path, nullable = false, max = 500) {
  if (nullable && value === null) return;
  check(typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value), 'INVALID_TEXT', path);
}
function id(value, path, nullable = false) { if (nullable && value === null) return; text(value, path, false, 240); }
function opaque(value, path) { check(typeof value === 'string' && OPAQUE.test(value), 'INVALID_OPAQUE_REFERENCE', path); }
function hash(value, path) { check(typeof value === 'string' && HASH.test(value), 'INVALID_HASH', path); }
function oneOf(value, options, path) { check(options.includes(value), 'INVALID_ENUM', path); }
function list(value, path, max = 5000) { check(Array.isArray(value) && value.length <= max, 'INVALID_ARRAY', path); }
function unique(values, path) { check(new Set(values).size === values.length, 'DUPLICATE', path); }
function ref(value, index, path) { check(index.has(value), 'UNKNOWN_REFERENCE', path); }
function timestamp(value, path) {
  text(value, path);
  check(Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'INVALID_TIMESTAMP', path);
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Sorted object keys, ordered arrays, exact strings, safe integer numbers only.
 * No omission, coercion, toJSON hooks, Unicode/number normalization or ignored fields. */
export function canonicalJson(value) {
  const visiting = new Set();
  function serialize(item, depth) {
    check(depth <= 48, 'JSON_TOO_DEEP', '$');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return JSON.stringify(item);
    if (typeof item === 'number') {
      check(Number.isSafeInteger(item) && !Object.is(item, -0), 'INVALID_JSON_NUMBER', '$');
      return String(item);
    }
    check(typeof item === 'object' && item !== null, 'INVALID_JSON_VALUE', '$');
    check(!visiting.has(item), 'CIRCULAR_JSON', '$');
    visiting.add(item);
    let result;
    if (Array.isArray(item)) {
      check(Reflect.ownKeys(item).length === item.length + 1 && Object.keys(item).length === item.length &&
        Array.from({ length: item.length }, (_, i) => Object.hasOwn(Object.getOwnPropertyDescriptor(item, i) ?? {}, 'value')).every(Boolean), 'INVALID_JSON_ARRAY', '$');
      result = `[${item.map(child => serialize(child, depth + 1)).join(',')}]`;
    } else {
      check(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, 'INVALID_JSON_OBJECT', '$');
      check(Reflect.ownKeys(item).length === Object.keys(item).length, 'INVALID_JSON_FIELDS', '$');
      result = `{${Object.keys(item).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        check(descriptor && Object.hasOwn(descriptor, 'value'), 'INVALID_JSON_ACCESSOR', '$');
        return `${JSON.stringify(key)}:${serialize(descriptor.value, depth + 1)}`;
      }).join(',')}}`;
    }
    visiting.delete(item);
    return result;
  }
  const result = serialize(value, 0);
  check(Buffer.byteLength(result, 'utf8') <= MAX_BYTES, 'PAYLOAD_TOO_LARGE', '$');
  return result;
}
const digest = value => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
const clone = value => JSON.parse(canonicalJson(value));

/** Printing IDs are derived from existing SetOps keys and reviewed scope, never a fuzzy label. */
export function printingIdentityId(category, setId, printing) {
  return `setops-printing:v1:${digest({ category, setId, programId: printing.programId,
    parallelId: printing.parallelId, variationId: printing.variationId,
    language: printing.language, edition: printing.edition, format: printing.format, channel: printing.channel })}`;
}

function indexRows(rows, key, path) {
  list(rows, path);
  rows.forEach((row, i) => id(row?.[key], `${path}[${i}].${key}`));
  unique(rows.map(row => row[key]), path);
  return new Map(rows.map(row => [row[key], row]));
}
function graph(index, parentKey, path) {
  const active = new Set(), done = new Set();
  function visit(key) {
    check(!active.has(key), 'CIRCULAR_EVIDENCE', path);
    if (done.has(key)) return;
    active.add(key);
    check(active.size <= 48, 'LINEAGE_TOO_DEEP', path);
    for (const parent of index.get(key)[parentKey]) { ref(parent, index, path); visit(parent); }
    active.delete(key); done.add(key);
  }
  for (const key of index.keys()) visit(key);
}
function sourceIndex(sources) {
  const index = indexRows(sources, 'sourceId', 'sources');
  for (const source of sources) {
    object(source, ['sourceId', 'kind', 'sourceRef', 'sourceUrl', 'sha256', 'parentSourceIds', 'originKeys'], 'source');
    oneOf(source.kind, [...AUTHORITATIVE, 'LISTING', 'PHYSICAL_OBSERVATION', 'DERIVED'], 'source.kind');
    opaque(source.sourceRef, 'source.sourceRef'); hash(source.sha256, 'source.sha256');
    if (source.sourceUrl !== null) {
      text(source.sourceUrl, 'source.sourceUrl', false, 2000);
      let url;
      try { url = new URL(source.sourceUrl); } catch { fail('INVALID_SOURCE_URL', 'source.sourceUrl'); }
      check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'INVALID_SOURCE_URL', 'source.sourceUrl');
    }
    list(source.parentSourceIds, 'source.parentSourceIds', 100); unique(source.parentSourceIds, 'source.parentSourceIds');
    source.parentSourceIds.forEach(parent => id(parent, 'source.parentSourceIds'));
    list(source.originKeys, 'source.originKeys', 100); unique(source.originKeys, 'source.originKeys');
    source.originKeys.forEach(key => opaque(key, 'source.originKeys'));
    check(source.originKeys.length > 0, 'MISSING_ORIGIN', 'source.originKeys');
    if (source.kind === 'DERIVED') check(source.parentSourceIds.length > 0, 'MISSING_LINEAGE', 'source.parentSourceIds');
  }
  graph(index, 'parentSourceIds', 'sources');
  return index;
}
function sourceRefs(ids, sources, path, authoritative = false, allowEmpty = false) {
  list(ids, path, 100); unique(ids, path);
  check(allowEmpty || ids.length > 0, 'MISSING_SOURCE', path);
  const authorityCache = new Map();
  function hasAuthority(key) {
    if (authorityCache.has(key)) return authorityCache.get(key);
    const source = sources.get(key);
    const authority = (AUTHORITATIVE.has(source.kind) || source.kind === 'DERIVED') &&
      source.parentSourceIds.every(hasAuthority);
    authorityCache.set(key, authority);
    return authority;
  }
  for (const key of ids) {
    ref(key, sources, path);
    if (authoritative) check(hasAuthority(key), 'NON_AUTHORITATIVE_SOURCE', path);
  }
}
function publicationPin(pin, path) {
  object(pin, ['publicationId', 'setId', 'revision', 'manifestSha256'], path);
  id(pin.publicationId, `${path}.publicationId`); id(pin.setId, `${path}.setId`); hash(pin.manifestSha256, `${path}.manifestSha256`);
  check(Number.isSafeInteger(pin.revision) && pin.revision >= 1, 'INVALID_REVISION', path);
}
function imageFields(image, sources) {
  id(image.imageId, 'image.imageId'); opaque(image.mediaRef, 'image.mediaRef'); hash(image.sha256, 'image.sha256');
  oneOf(image.mimeType, ['image/jpeg', 'image/png', 'image/webp'], 'image.mimeType');
  oneOf(image.role, ['front', 'back', 'detail'], 'image.role');
  check(Number.isSafeInteger(image.width) && Number.isSafeInteger(image.height) && image.width > 0 && image.height > 0 && image.width * image.height <= 100000000, 'INVALID_IMAGE_DIMENSIONS', 'image');
  sourceRefs(image.sourceIds, sources, 'image.sourceIds');
  list(image.parentImageIds, 'image.parentImageIds', 100); unique(image.parentImageIds, 'image.parentImageIds');
}

export function validateManifest(input) {
  const manifest = clone(input);
  object(manifest, ['schemaVersion', 'set', 'setOps', 'revision', 'supersedes', 'coverage', 'sources', 'programs', 'cards', 'printings', 'applicability', 'aliases', 'images'], 'manifest');
  check(manifest.schemaVersion === MANIFEST_VERSION, 'UNSUPPORTED_VERSION', 'manifest.schemaVersion');
  check(Number.isSafeInteger(manifest.revision) && manifest.revision >= 1, 'INVALID_REVISION', 'manifest.revision');
  object(manifest.set, ['category', 'setId', 'label', 'year', 'manufacturer', 'publisher', 'sourceIds'], 'set');
  const { set } = manifest;
  oneOf(set.category, ['SPORTS', 'POKEMON'], 'set.category');
  for (const field of ['setId', 'label', 'year']) text(set[field], `set.${field}`);
  text(set.manufacturer, 'set.manufacturer', set.category === 'POKEMON');
  text(set.publisher, 'set.publisher', set.category === 'SPORTS');
  check(set.category === 'SPORTS' ? set.publisher === null : set.manufacturer === null, 'CATEGORY_FIELD_MISMATCH', 'set');
  object(manifest.setOps, ['draftId', 'draftVersionId', 'legacyVersionHash'], 'setOps');
  id(manifest.setOps.draftId, 'setOps.draftId'); id(manifest.setOps.draftVersionId, 'setOps.draftVersionId');
  hash(manifest.setOps.legacyVersionHash, 'setOps.legacyVersionHash');
  if (manifest.supersedes !== null) {
    publicationPin(manifest.supersedes, 'supersedes');
    check(manifest.supersedes.setId === set.setId && manifest.supersedes.revision === manifest.revision - 1, 'INVALID_SUPERSESSION', 'supersedes');
  } else check(manifest.revision === 1, 'MISSING_SUPERSESSION', 'supersedes');
  const sources = sourceIndex(manifest.sources);
  sourceRefs(set.sourceIds, sources, 'set.sourceIds', true);
  object(manifest.coverage, ['text', 'applicability', 'images'], 'coverage');
  for (const [kind, coverage] of Object.entries(manifest.coverage)) {
    object(coverage, ['status', 'detail', 'sourceIds'], `coverage.${kind}`);
    oneOf(coverage.status, ['complete', 'partial', 'truncated', 'unknown'], `coverage.${kind}.status`);
    text(coverage.detail, `coverage.${kind}.detail`);
    sourceRefs(coverage.sourceIds, sources, `coverage.${kind}.sourceIds`, kind !== 'images', coverage.status === 'unknown');
  }
  const programs = indexRows(manifest.programs, 'programId', 'programs');
  unique(manifest.programs.map(program => program.rowId), 'programs.rowId');
  for (const program of manifest.programs) {
    object(program, ['programId', 'rowId', 'label', 'sourceIds'], 'program');
    id(program.rowId, 'program.rowId'); text(program.label, 'program.label');
    sourceRefs(program.sourceIds, sources, 'program.sourceIds', true);
  }
  const cards = indexRows(manifest.cards, 'cardId', 'cards');
  for (const card of manifest.cards) {
    object(card, ['cardId', 'programId', 'number', 'name', 'numberingScheme', 'sourceIds'], 'card');
    ref(card.programId, programs, 'card.programId');
    for (const field of ['number', 'name', 'numberingScheme']) text(card[field], `card.${field}`);
    sourceRefs(card.sourceIds, sources, 'card.sourceIds', true);
  }
  // Do not reject case/Unicode lookup collisions: expose all candidates. Persisted keys remain exact.
  unique(manifest.cards.map(card => canonicalJson([card.programId, card.number])), 'cards.programNumber');
  const printings = indexRows(manifest.printings, 'printingId', 'printings');
  const parallelRows = new Map(), variationRows = new Map(), scopeRows = new Map();
  const rowKeys = new Map();
  for (const printing of manifest.printings) {
    object(printing, ['printingId', 'programId', 'parallelId', 'parallelRowId', 'variationId', 'variationRowId', 'scopeRowId', 'label', ...DIMENSIONS, 'sourceIds', 'diagnostics'], 'printing');
    ref(printing.programId, programs, 'printing.programId');
    for (const field of ['parallelId', 'parallelRowId', 'scopeRowId']) id(printing[field], `printing.${field}`);
    id(printing.variationId, 'printing.variationId', true); id(printing.variationRowId, 'printing.variationRowId', true);
    check((printing.variationId === null) === (printing.variationRowId === null), 'VARIATION_ID_MISMATCH', 'printing');
    const keys = [[parallelRows, printing.parallelId, printing.parallelRowId], [variationRows, canonicalJson([printing.programId, printing.variationId]), printing.variationRowId]];
    for (const [map, key, rowId] of keys) {
      check(!map.has(key) || map.get(key) === rowId, 'SETOPS_ID_COLLISION', 'printing'); map.set(key, rowId);
      if (rowId !== null) {
        const namespacedRow = `${map === parallelRows ? 'parallel' : 'variation'}:${rowId}`;
        check(!rowKeys.has(namespacedRow) || rowKeys.get(namespacedRow) === key, 'SETOPS_ID_COLLISION', 'printing');
        rowKeys.set(namespacedRow, key);
      }
    }
    const scopeIdentity = canonicalJson([printing.programId, printing.parallelId, printing.variationId]);
    check(!scopeRows.has(printing.scopeRowId) || scopeRows.get(printing.scopeRowId) === scopeIdentity, 'SETOPS_ID_COLLISION', 'printing.scopeRowId');
    scopeRows.set(printing.scopeRowId, scopeIdentity);
    text(printing.label, 'printing.label');
    DIMENSIONS.forEach(field => text(printing[field], `printing.${field}`, true));
    check(printing.printingId === printingIdentityId(set.category, set.setId, printing), 'PRINTING_ID_MISMATCH', 'printing.printingId');
    sourceRefs(printing.sourceIds, sources, 'printing.sourceIds', true);
    list(printing.diagnostics, 'printing.diagnostics', 30); unique(printing.diagnostics.map(feature => feature?.id), 'printing.diagnostics');
    for (const feature of printing.diagnostics) {
      object(feature, ['id', 'description', 'sourceIds'], 'diagnostic'); id(feature.id, 'diagnostic.id'); text(feature.description, 'diagnostic.description');
      sourceRefs(feature.sourceIds, sources, 'diagnostic.sourceIds', true);
    }
  }
  unique(manifest.printings.flatMap(printing => printing.diagnostics.map(feature => feature.id)), 'printings.diagnosticIds');
  list(manifest.applicability, 'applicability', 20000);
  unique(manifest.applicability.map(row => canonicalJson([row?.cardId, row?.printingId])), 'applicability');
  const applications = new Map();
  for (const row of manifest.applicability) {
    object(row, ['cardId', 'printingId', 'status', 'sourceIds', 'note'], 'applicability');
    ref(row.cardId, cards, 'applicability.cardId'); ref(row.printingId, printings, 'applicability.printingId');
    check(cards.get(row.cardId).programId === printings.get(row.printingId).programId, 'PROGRAM_SCOPE_MISMATCH', 'applicability');
    oneOf(row.status, ['supported', 'excluded', 'unknown'], 'applicability.status'); text(row.note, 'applicability.note');
    sourceRefs(row.sourceIds, sources, 'applicability.sourceIds', true, row.status === 'unknown');
    applications.set(canonicalJson([row.cardId, row.printingId]), row);
  }
  list(manifest.aliases, 'aliases'); unique(manifest.aliases.map(canonicalJson), 'aliases');
  for (const alias of manifest.aliases) {
    object(alias, ['kind', 'value', 'targetId', 'scope', 'sourceIds'], 'alias');
    oneOf(alias.kind, ['set_label', 'program_label', 'card_name', 'card_number', 'printing_label'], 'alias.kind'); text(alias.value, 'alias.value');
    object(alias.scope, ['category', 'setId', 'programId', 'language'], 'alias.scope');
    check(alias.scope.category === set.category && alias.scope.setId === set.setId, 'ALIAS_SCOPE_MISMATCH', 'alias.scope');
    text(alias.scope.language, 'alias.scope.language', true);
    if (alias.kind === 'set_label') {
      check(alias.targetId === set.setId && alias.scope.programId === null && alias.scope.language === null, 'ALIAS_SCOPE_MISMATCH', 'alias');
    } else {
      ref(alias.scope.programId, programs, 'alias.scope.programId');
      const targets = alias.kind === 'program_label' ? programs : alias.kind === 'printing_label' ? printings : cards;
      ref(alias.targetId, targets, 'alias.targetId');
      check((alias.kind === 'program_label' ? alias.targetId : targets.get(alias.targetId).programId) === alias.scope.programId, 'ALIAS_SCOPE_MISMATCH', 'alias');
      if (alias.kind === 'printing_label') check(alias.scope.language !== null && alias.scope.language === printings.get(alias.targetId).language, 'ALIAS_SCOPE_MISMATCH', 'alias.scope.language');
    }
    sourceRefs(alias.sourceIds, sources, 'alias.sourceIds', true);
  }
  const images = indexRows(manifest.images, 'imageId', 'images');
  for (const image of manifest.images) {
    object(image, ['imageId', 'mediaRef', 'sha256', 'mimeType', 'width', 'height', 'role', 'sourceIds', 'parentImageIds', 'depicted', 'representsPrintingIds', 'visibleDiagnosticIds'], 'image');
    imageFields(image, sources);
    object(image.depicted, ['cardId', 'printingId'], 'image.depicted');
    ref(image.depicted.cardId, cards, 'image.depicted.cardId'); ref(image.depicted.printingId, printings, 'image.depicted.printingId');
    check(applications.get(canonicalJson([image.depicted.cardId, image.depicted.printingId]))?.status === 'supported', 'UNSUPPORTED_DEPICTED_IDENTITY', 'image.depicted');
    list(image.representsPrintingIds, 'image.representsPrintingIds', 100); unique(image.representsPrintingIds, 'image.representsPrintingIds');
    check(image.representsPrintingIds.length > 0, 'MISSING_IMAGE_SCOPE', 'image.representsPrintingIds');
    image.representsPrintingIds.forEach(key => ref(key, printings, 'image.representsPrintingIds'));
    list(image.visibleDiagnosticIds, 'image.visibleDiagnosticIds', 30); unique(image.visibleDiagnosticIds, 'image.visibleDiagnosticIds');
    const diagnostics = new Set(image.representsPrintingIds.flatMap(key => printings.get(key).diagnostics.map(feature => feature.id)));
    image.visibleDiagnosticIds.forEach(key => check(diagnostics.has(key), 'UNKNOWN_DIAGNOSTIC', 'image.visibleDiagnosticIds'));
  }
  graph(images, 'parentImageIds', 'images');
  return freeze(manifest);
}

export function hashManifest(manifest) { return digest(validateManifest(manifest)); }

/** All source ancestors, original/cropped image hashes and stable origin keys are retained.
 * Disjoint declared roots are not a claim of independently verified real-world sales. */
export function compareEvidenceLineage(input, left, right) {
  const manifest = validateManifest(input), sources = new Map(manifest.sources.map(source => [source.sourceId, source]));
  const images = new Map(manifest.images.map(image => [image.imageId, image]));
  function tokens(selection) {
    object(selection, ['sourceIds', 'imageIds'], 'lineageSelection');
    list(selection.sourceIds, 'lineageSelection.sourceIds'); list(selection.imageIds, 'lineageSelection.imageIds');
    const result = new Set(), visitedSources = new Set(), visitedImages = new Set();
    function visitSource(key) {
      ref(key, sources, 'lineageSelection.sourceIds'); if (visitedSources.has(key)) return; visitedSources.add(key);
      const source = sources.get(key); result.add(`bytes:${source.sha256}`);
      source.originKeys.forEach(origin => result.add(`origin:${origin}`)); source.parentSourceIds.forEach(visitSource);
    }
    function visitImage(key) {
      ref(key, images, 'lineageSelection.imageIds'); if (visitedImages.has(key)) return; visitedImages.add(key);
      const image = images.get(key); result.add(`bytes:${image.sha256}`);
      image.sourceIds.forEach(visitSource); image.parentImageIds.forEach(visitImage);
    }
    selection.sourceIds.forEach(visitSource); selection.imageIds.forEach(visitImage);
    check(result.size > 0, 'EMPTY_EVIDENCE', 'lineageSelection');
    return result;
  }
  const a = tokens(left), b = tokens(right), sharedRoots = [...a].filter(key => b.has(key)).sort();
  return freeze({ relationship: sharedRoots.length ? 'shared_lineage' : 'distinct_declared_roots', sharedRoots });
}

const normalizedText = value => value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
// A prefix, denominator, punctuation or leading zero is never discarded.
const normalizedNumber = value => value.normalize('NFC').trim().toUpperCase();
function validateQuery(input) {
  const query = clone(input), keys = ['category', 'setId', 'setLabel', 'year', 'manufacturer', 'publisher', 'programId', 'programLabel', 'cardId', 'cardNumber', 'cardName', 'printingId', 'printingLabel', ...DIMENSIONS, 'limit'];
  check(query && typeof query === 'object' && !Array.isArray(query) && Object.keys(query).every(key => keys.includes(key)), 'INVALID_FIELDS', 'query');
  oneOf(query.category, ['SPORTS', 'POKEMON'], 'query.category');
  for (const [key, value] of Object.entries(query)) if (!['category', 'limit'].includes(key)) text(value, `query.${key}`);
  check(query.limit === undefined || Number.isSafeInteger(query.limit) && query.limit > 0 && query.limit <= 100, 'INVALID_LIMIT', 'query.limit');
  return query;
}
function lookup(manifest, input, publication) {
  const query = validateQuery(input), { set } = manifest;
  function matches(kind, value, label, targetId, programId, normalizer = normalizedText) {
    if (value === undefined) return true;
    if (normalizer(value) === normalizer(label)) return true;
    return manifest.aliases.some(alias => alias.kind === kind && alias.targetId === targetId &&
      alias.scope.programId === programId && (alias.scope.language === null || alias.scope.language === query.language) &&
      normalizer(alias.value) === normalizer(value));
  }
  const scopeMatches = query.category === set.category && (!query.setId || query.setId === set.setId) &&
    matches('set_label', query.setLabel, set.label, set.setId, null) &&
    ['year', 'manufacturer', 'publisher'].every(field => query[field] === undefined || set[field] !== null && normalizedText(query[field]) === normalizedText(set[field]));
  const candidates = [], applications = new Map(manifest.applicability.map(row => [canonicalJson([row.cardId, row.printingId]), row]));
  if (scopeMatches) for (const card of manifest.cards) {
    const program = manifest.programs.find(row => row.programId === card.programId);
    if (query.programId && query.programId !== card.programId || query.cardId && query.cardId !== card.cardId ||
      !matches('program_label', query.programLabel, program.label, program.programId, program.programId) ||
      !matches('card_number', query.cardNumber, card.number, card.cardId, card.programId, normalizedNumber) ||
      !matches('card_name', query.cardName, card.name, card.cardId, card.programId)) continue;
    for (const printing of manifest.printings) {
      if (printing.programId !== card.programId || query.printingId && query.printingId !== printing.printingId ||
        !matches('printing_label', query.printingLabel, printing.label, printing.printingId, printing.programId) ||
        DIMENSIONS.some(field => query[field] !== undefined && printing[field] !== null && query[field] !== printing[field])) continue;
      const application = applications.get(canonicalJson([card.cardId, printing.printingId]));
      const unresolvedScopeFields = DIMENSIONS.filter(field => printing[field] === null || query[field] === undefined && printing[field] !== 'not_applicable');
      const applicability = unresolvedScopeFields.length ? 'unknown' : application?.status ?? 'unknown';
      candidates.push({ card, program, printing, applicability, recordedApplicability: application?.status ?? 'unknown',
        applicabilitySourceIds: application?.sourceIds ?? [], unresolvedScopeFields,
        images: applicability !== 'supported' ? [] : manifest.images.filter(image => image.representsPrintingIds.includes(printing.printingId)).map(image => ({
          ...image, relationship: image.depicted.cardId === card.cardId && image.depicted.printingId === printing.printingId ? 'depicts_candidate_identity' : 'representative_finish',
        })),
      });
    }
  }
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  candidates.sort((a, b) => compare(a.card.cardId, b.card.cardId) || compare(a.printing.printingId, b.printing.printingId));
  const limit = query.limit ?? 24;
  return freeze({ schemaVersion: LOOKUP_VERSION, authority: publication ? 'host_authorized_setops_publication' : 'unreviewed_manifest',
    publication, set, coverage: manifest.coverage, sources: manifest.sources,
    outcome: candidates.length === 0 ? 'not_found' : candidates.length === 1 ? 'one_candidate' : 'ambiguous',
    totalCandidateCount: candidates.length, returnedCount: Math.min(limit, candidates.length), truncated: candidates.length > limit,
    absenceEstablishesExclusion: false, identityDecision: 'consumer_review_required', candidates: candidates.slice(0, limit) });
}

/** Pure preview only. Even a JSON field saying "approved" cannot grant publication authority. */
export function lookupManifestCandidates(manifest, query) { return lookup(validateManifest(manifest), query, null); }

/** SERVER-ONLY integration boundary. The host supplies this loader at composition time,
 * authenticates the consuming app, reads immutable publication storage/current state,
 * and verifies the original human SetOps review. Never accept a loader or authority
 * record from an HTTP caller. No default loader, environment flag or trusted JSON mode. */
export function createPublishedCatalogReader({ loadAuthorizedPublication } = {}) {
  check(typeof loadAuthorizedPublication === 'function', 'HOST_AUTHORITY_REQUIRED', 'loadAuthorizedPublication');
  return freeze({
    async lookup(request) {
      const input = clone(request);
      object(input, ['publication', 'query'], 'request'); publicationPin(input.publication, 'request.publication'); validateQuery(input.query);
      const loaded = await loadAuthorizedPublication(freeze(clone(input.publication)));
      check(loaded !== null && loaded !== undefined, 'PUBLICATION_UNAVAILABLE', 'publication');
      object(loaded, ['authority', 'manifest'], 'loadedPublication');
      const authority = clone(loaded.authority);
      object(authority, ['publicationId', 'setId', 'revision', 'manifestSha256', 'state', 'draftId', 'draftVersionId', 'setApprovalId', 'reviewedById', 'reviewedAt'], 'authority');
      for (const field of ['publicationId', 'setId', 'draftId', 'draftVersionId', 'setApprovalId', 'reviewedById']) id(authority[field], `authority.${field}`);
      hash(authority.manifestSha256, 'authority.manifestSha256'); timestamp(authority.reviewedAt, 'authority.reviewedAt');
      check(authority.state === 'current', 'PUBLICATION_NOT_CURRENT', 'authority.state');
      for (const field of ['publicationId', 'setId', 'revision', 'manifestSha256']) check(authority[field] === input.publication[field], 'PUBLICATION_PIN_MISMATCH', `authority.${field}`);
      const manifest = validateManifest(loaded.manifest);
      check(digest(manifest) === authority.manifestSha256, 'MANIFEST_HASH_MISMATCH', 'authority.manifestSha256');
      check(manifest.set.setId === authority.setId && manifest.revision === authority.revision && manifest.setOps.draftId === authority.draftId && manifest.setOps.draftVersionId === authority.draftVersionId, 'AUTHORITY_BINDING_MISMATCH', 'authority');
      return lookup(manifest, input.query, freeze({ ...input.publication, setApprovalId: authority.setApprovalId, reviewedAt: authority.reviewedAt }));
    },
  });
}

/** Proposal data is private observation evidence, never catalog publication or image promotion. */
export function prepareObservationProposal(input) {
  const proposal = clone(input);
  object(proposal, ['schemaVersion', 'producer', 'observationId', 'inputRevision', 'physicalCardRef', 'observedAt', 'basedOnPublication', 'identity', 'sources', 'images', 'note'], 'proposal');
  check(proposal.schemaVersion === PROPOSAL_VERSION, 'UNSUPPORTED_VERSION', 'proposal.schemaVersion');
  oneOf(proposal.producer, ['inventory', 'atlas'], 'proposal.producer');
  for (const field of ['observationId', 'inputRevision', 'physicalCardRef']) opaque(proposal[field], `proposal.${field}`);
  timestamp(proposal.observedAt, 'proposal.observedAt'); text(proposal.note, 'proposal.note');
  if (proposal.basedOnPublication !== null) publicationPin(proposal.basedOnPublication, 'proposal.basedOnPublication');
  object(proposal.identity, ['category', 'setId', 'programId', 'cardId', 'printingId', 'year', 'manufacturer', 'publisher', 'setLabel', 'name', 'cardNumber', ...DIMENSIONS], 'proposal.identity');
  oneOf(proposal.identity.category, ['SPORTS', 'POKEMON'], 'proposal.identity.category');
  for (const [key, value] of Object.entries(proposal.identity)) if (key !== 'category') text(value, `proposal.identity.${key}`, true);
  check(proposal.identity.category === 'SPORTS' ? proposal.identity.publisher === null : proposal.identity.manufacturer === null, 'CATEGORY_FIELD_MISMATCH', 'proposal.identity');
  if (proposal.basedOnPublication !== null) check(proposal.identity.setId === proposal.basedOnPublication.setId, 'PUBLICATION_PIN_MISMATCH', 'proposal.identity.setId');
  const sources = sourceIndex(proposal.sources), images = indexRows(proposal.images, 'imageId', 'images');
  check(sources.size > 0, 'MISSING_SOURCE', 'proposal.sources');
  for (const image of proposal.images) {
    object(image, ['imageId', 'mediaRef', 'sha256', 'mimeType', 'width', 'height', 'role', 'sourceIds', 'parentImageIds'], 'proposal.image');
    imageFields(image, sources);
  }
  graph(images, 'parentImageIds', 'proposal.images');
  return freeze({ disposition: 'requires_authorized_review',
    idempotencyKey: `catalog-observation:v1:${digest([proposal.producer, proposal.observationId, proposal.inputRevision])}`,
    proposalSha256: digest(proposal), proposal });
}

/** Host persists a UNIQUE(producer, observationId, inputRevision) atomically.
 * Existing receipt must be loaded by that host, never supplied by the caller. */
export function observationRetryDisposition(existingReceipt, proposal) {
  const prepared = prepareObservationProposal(proposal);
  if (existingReceipt === null) return freeze({ disposition: 'new', prepared });
  object(existingReceipt, ['idempotencyKey', 'proposalSha256'], 'existingReceipt');
  check(existingReceipt.idempotencyKey === prepared.idempotencyKey, 'IDEMPOTENCY_KEY_MISMATCH', 'existingReceipt');
  check(existingReceipt.proposalSha256 === prepared.proposalSha256, 'IDEMPOTENCY_CONFLICT', 'existingReceipt');
  return freeze({ disposition: 'replay', prepared });
}
