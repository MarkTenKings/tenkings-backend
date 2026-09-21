import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { createPublishedCatalogReader, type LookupResult, type DeepReadonly } from '@tenkings/card-catalog-evidence';
import { createResearchCatalogAdapter } from '../lib/server/staffInventoryResearchCatalog';
import { researchStaffInventoryCard } from '../lib/server/staffInventoryResearch';
import { StaffInventoryResearchResultSchema, type StaffInventoryResearchInput } from '../lib/staffInventoryResearch';
// @ts-expect-error Synthetic protocol fixtures are outside the public package contract.
import { fixture, hostFixture } from '../../../packages/card-catalog-evidence/tests/fixtures.mjs';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const key = (bytes: Buffer) => `inventory-photos/11111111-1111-4111-8111-111111111111/${sha(bytes)}.jpg`;

for (const category of ['SPORTS', 'POKEMON'] as const) for (const truncatedField of ['text', 'applicability', null] as const) {
  test(`real reader → adapter → V4 engine completes ${category} ${truncatedField ?? 'ordinary partial'} coverage`, async () => {
    const manifest = fixture(category); manifest.images = [];
    if (truncatedField) manifest.coverage[truncatedField].status = 'truncated';
    const stored = hostFixture(manifest), reader = createPublishedCatalogReader({ loadAuthorizedPublication: async () => stored.loaded });
    const lookups: DeepReadonly<LookupResult>[] = [];
    let rechecks = 0;
    const adapter = createResearchCatalogAdapter({
      host: {
        findCurrentSetCatalogPublications: async () => [stored.pin],
        lookupPublishedSetCatalogEvidence: async ({ publication, query }) => {
          const lookup = await reader.lookup({ publication, query }); lookups.push(lookup); return lookup;
        },
        isSetCatalogPublicationCurrent: async publication => { assert.deepEqual(publication, stored.pin); rechecks++; return true; },
        readPublishedSetCatalogImage: async () => assert.fail('No image was included in this text/applicability fixture.'),
      },
      resolveScope: async ({ photos, choices }) => {
        const language = category === 'SPORTS' ? 'en' : 'fr'; assert.ok(choices.language.includes(language));
        return { evidence: [
          { field: 'language', value: language, side: 'front', photo_sha256: photos.front!.sha256, observation: 'Synthetic visible language evidence.' },
          { field: 'edition', value: 'standard', side: 'back', photo_sha256: photos.back!.sha256, observation: 'Synthetic explicit edition mark.' },
        ], receipt: { attempt_id: 'fixture:attempt', invocation_id: 'fixture:scope', receipt_ref: 'fixture:receipt', request_sha256: 'd'.repeat(64), response_sha256: 'e'.repeat(64), http_status: 200, acknowledgement: 'adapter',
          images: (['front', 'back'] as const).map(side => ({ side, mime_type: 'image/jpeg', transmitted_sha256: photos[side]!.sha256, source_sha256: null })) } };
      },
    });
    const bytes = await Promise.all(['white', 'blue'].map(background => sharp({ create: { width: 30, height: 40, channels: 3, background } }).jpeg().toBuffer()));
    const input: StaffInventoryResearchInput = { schema_version: 1, unit_id: 'fixture-unit', description_event_id: 'fixture-event', description_hash: 'b'.repeat(64),
      description: { name: manifest.cards[0].name, category: category === 'SPORTS' ? 'Sports cards' : 'Pokémon', manufacturer: manifest.set.manufacturer ?? manifest.set.publisher,
        year: manifest.set.year, set_name: manifest.set.label, card_number: manifest.cards[0].number, variant: null, card_type: null },
      front_photo_key: key(bytes[0]), back_photo_key: key(bytes[1]) };
    let modelCalls = 0;
    const result = await researchStaffInventoryCard(input, {
      env: { OPENAI_API_KEY: 'fixture-openai-key', SOLDCOMPS_API_KEY: 'fixture-sold-key' },
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      loadPhoto: async photoKey => { const source = photoKey === input.front_photo_key ? bytes[0] : bytes[1]; return { key: photoKey, sha256: sha(source), bytes: source }; },
      loadReferences: async () => assert.fail('V4 must not use legacy fallback.'),
      loadCatalog: adapter.load, isCatalogCurrent: adapter.current,
      fetchImpl: async (url, init) => {
        const uri = String(url);
        if (uri.startsWith('https://api.sold-comps.com/v1/scrape?')) return Response.json({ keyword: new URL(uri).searchParams.get('keyword'), page: 1, totalItems: 0, hasNextPage: false, items: [] });
        assert.equal(uri, 'https://api.openai.com/v1/responses'); modelCalls++;
        const request = JSON.parse(String(init?.body));
        if (truncatedField) assert.ok(request.input[0].content.some((part: { type: string; text?: string }) => part.type === 'input_text' && part.text?.includes('Published evidence: []')));
        const analysis = { identity: { status: 'unresolved', variant_name: null, suggestion: null, reason: 'Synthetic unresolved review; no card identity is asserted.', reference_ids: [], photo_features: [] },
          target_condition: { status: 'raw', grader: null, numeric_grade: null, photo_evidence: 'Synthetic ungraded fixture card views.' }, selected_candidate_ids: [], comparisons: [], refinement: null };
        return Response.json({ model: 'gpt-6-astra', status: 'completed', error: null, incomplete_details: null,
          output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(analysis) }] }] });
      },
    });
    assert.equal(modelCalls, 1); assert.equal(rechecks, 1); assert.equal(lookups.length, 2);
    const scoped = lookups[1]; assert.equal(scoped.truncated, false); assert.ok(scoped.returnedCount > 0);
    assert.ok(scoped.candidates.some(candidate => candidate.applicability === 'supported'), 'the real reader supplies positive evidence before converter eligibility');
    assert.equal(StaffInventoryResearchResultSchema.safeParse(result).success, true);
    assert.equal(result.engine_version, 'staff-inventory-research-v4'); assert.equal(result.catalog_context?.status, 'current');
    const coverage = result.catalog_context!.publications[0];
    assert.equal(coverage.coverage.text, truncatedField === 'text' ? 'truncated' : 'partial');
    assert.equal(coverage.coverage.applicability, truncatedField === 'applicability' ? 'truncated' : 'partial');
    assert.deepEqual(coverage.publication, stored.pin); assert.equal(coverage.returned_count, scoped.returnedCount); assert.equal(coverage.truncated, false);
    assert.equal(result.identity.status, 'unresolved'); assert.equal(result.estimate.status, 'unknown'); assert.deepEqual(result.selected_candidate_ids, []);
    if (truncatedField) {
      assert.deepEqual(result.references, []); assert.ok(result.diagnostics!.reason_codes.includes('CATALOG_COVERAGE_MISSING'));
    } else assert.ok(result.references.length > 0, 'normal partial coverage keeps supported positive references');
  });
}
