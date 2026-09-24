import { createHash } from 'node:crypto';
import { MANIFEST_VERSION, PROPOSAL_VERSION, hashManifest, printingIdentityId } from '../src/index.mjs';

// Synthetic protocol examples only. These names, source bytes, IDs, media and
// reviewer records are not evidence of a real card, source review or publication.
export const sha = value => createHash('sha256').update(value).digest('hex');
export const copy = value => JSON.parse(JSON.stringify(value));
export function fixture(category = 'SPORTS') {
  const prefix = category === 'SPORTS' ? 'sports' : 'pokemon';
  const setId = `fixture:${prefix}:set`, official = `${prefix}:source:checklist`, listing = `${prefix}:source:listing`;
  const source = (sourceId, kind, origin) => ({ sourceId, kind, sourceRef: `fixture:${sourceId}`, sourceUrl: null,
    sha256: sha(`synthetic bytes ${sourceId}`), parentSourceIds: [], originKeys: [origin] });
  const makePrinting = (programId, parallelId, label) => {
    const printing = { programId, parallelId, parallelRowId: `${prefix}:parallel:${parallelId}`, variationId: null,
      variationRowId: null, scopeRowId: `${prefix}:scope:${programId}:${parallelId}`, label,
      language: category === 'SPORTS' ? 'en' : 'fr', edition: 'standard', format: 'not_applicable', channel: 'not_applicable',
      sourceIds: [official], diagnostics: [{ id: `${programId}:${parallelId}:feature`, description: 'Synthetic source-described diagnostic; not a real finish claim.', sourceIds: [official] }] };
    return { printingId: printingIdentityId(category, setId, printing), ...printing };
  };
  const printings = [makePrinting('base', 'first', category === 'SPORTS' ? 'Silver' : 'Reverse Holo'),
    makePrinting('base', 'second', category === 'SPORTS' ? 'Gold' : 'Holo'), makePrinting('insert', 'first', category === 'SPORTS' ? 'Silver' : 'Reverse Holo')];
  const cards = [
    { cardId: `${prefix}:card:a`, programId: 'base', number: category === 'SPORTS' ? 'HM-CF' : '001/165', name: category === 'SPORTS' ? 'Fixture Player' : 'Évoli' },
    { cardId: `${prefix}:card:b`, programId: 'base', number: category === 'SPORTS' ? 'HM-01' : '1/165', name: category === 'SPORTS' ? 'Fixture Teammate' : 'Évoli' },
    { cardId: `${prefix}:card:c`, programId: 'insert', number: category === 'SPORTS' ? 'HM-CF' : '001', name: category === 'SPORTS' ? 'Fixture Player' : 'Évoli' },
  ].map(card => ({ ...card, numberingScheme: category === 'SPORTS' ? 'prefixed_insert_number' : 'collector_number', sourceIds: [official] }));
  const scope = programId => ({ category, setId, programId, language: category === 'SPORTS' ? 'en' : 'fr' });
  const applicability = [
    [0, 0, 'supported'], [1, 0, 'supported'], [0, 1, 'excluded'], [1, 1, 'unknown'], [2, 2, 'supported'],
  ].map(([card, printing, status]) => ({ cardId: cards[card].cardId, printingId: printings[printing].printingId,
    status, sourceIds: status === 'unknown' ? [] : [official], note: `Synthetic ${status} relation.` }));
  const image = { imageId: `${prefix}:image:representative`, mediaRef: `fixture:private:${prefix}:image`,
    sha256: sha(`synthetic image ${prefix}`), mimeType: 'image/jpeg', width: 1600, height: 2200, role: 'front',
    sourceIds: [listing], parentImageIds: [], depicted: { cardId: cards[1].cardId, printingId: printings[0].printingId },
    representsPrintingIds: [printings[0].printingId], visibleDiagnosticIds: [printings[0].diagnostics[0].id] };
  return { schemaVersion: MANIFEST_VERSION,
    set: { category, setId, label: `Synthetic ${prefix} product`, year: '2024', manufacturer: category === 'SPORTS' ? 'Fixture Maker' : null,
      publisher: category === 'POKEMON' ? 'Fixture Publisher' : null, sourceIds: [official] },
    setOps: { draftId: `${prefix}:draft`, draftVersionId: `${prefix}:draft:version:1`, legacyVersionHash: sha('synthetic legacy draft subset') },
    revision: 1, supersedes: null,
    coverage: Object.fromEntries(['text', 'applicability', 'images'].map(kind => [kind, { status: 'partial', detail: `Only the synthetic ${kind} examples in this fixture are covered.`, sourceIds: [official] }])),
    sources: [source(official, 'OFFICIAL_CHECKLIST', `fixture:checklist:${prefix}`), source(listing, 'LISTING', `listing:fixture:${prefix}`)],
    programs: ['base', 'insert'].map(programId => ({ programId, rowId: `${prefix}:program:${programId}`, label: `Fixture ${programId}`, sourceIds: [official] })),
    cards, printings, applicability,
    aliases: [
      { kind: 'set_label', value: `Fixture ${prefix} alias`, targetId: setId, scope: { category, setId, programId: null, language: null }, sourceIds: [official] },
      { kind: 'card_number', value: category === 'SPORTS' ? 'HM-CF-ALT' : 'F-001/165', targetId: cards[0].cardId, scope: scope('base'), sourceIds: [official] },
      ...(category === 'POKEMON' ? [{ kind: 'card_name', value: 'Evoli', targetId: cards[0].cardId, scope: scope('base'), sourceIds: [official] }] : []),
    ], images: [image] };
}
export function queryFor(manifest) {
  return { category: manifest.set.category, setId: manifest.set.setId, programId: 'base', cardNumber: manifest.cards[0].number,
    printingLabel: manifest.printings[0].label, language: manifest.printings[0].language, edition: 'standard' };
}
export function hostFixture(manifest) {
  const pin = { publicationId: `fixture:publication:${manifest.set.category.toLowerCase()}:${manifest.revision}`,
    setId: manifest.set.setId, revision: manifest.revision, manifestSha256: hashManifest(manifest) };
  return { pin, loaded: { manifest, authority: { ...pin, state: 'current', draftId: manifest.setOps.draftId, draftVersionId: manifest.setOps.draftVersionId,
    setApprovalId: 'fixture:setops:approval', reviewedById: 'fixture:reviewer', reviewedAt: '2026-09-16T00:00:00.000Z' } } };
}
export function observationFixture(producer = 'inventory') {
  const category = 'POKEMON', sourceId = 'fixture:physical:source';
  return { schemaVersion: PROPOSAL_VERSION, producer, observationId: 'fixture:observation:1', inputRevision: 'capture:1',
    physicalCardRef: `fixture:${producer}:physical:1`, observedAt: '2026-09-16T00:00:00.000Z', basedOnPublication: null,
    identity: { category, setId: null, programId: null, cardId: null, printingId: null, year: '2024', manufacturer: null,
      publisher: null, setLabel: null, name: 'Unconfirmed fixture name', cardNumber: '001/165', language: 'fr', edition: null, format: null, channel: null },
    sources: [{ sourceId, kind: 'PHYSICAL_OBSERVATION', sourceRef: `fixture:${producer}:capture`, sourceUrl: null,
      sha256: sha('synthetic observation bytes'), parentSourceIds: [], originKeys: [`physical:${producer}:fixture1`] }],
    images: [{ imageId: 'fixture:observation:front', mediaRef: `fixture:${producer}:front`, sha256: sha('synthetic observed image bytes'),
      mimeType: 'image/jpeg', width: 1600, height: 2200, role: 'front', sourceIds: [sourceId], parentImageIds: [] }],
    note: 'Unreviewed synthetic observation. No grade, comp selection or model output approves reference reuse.' };
}
