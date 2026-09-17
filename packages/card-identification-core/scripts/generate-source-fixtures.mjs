// Run deliberately from this repository to regenerate the golden fixture from
// immutable reviewed source. Ordinary tests need neither git nor the old app.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import sharp from 'sharp';
import { z } from 'zod';

const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../source-manifest.json', import.meta.url)));
const readSource = path => {
  const source = execFileSync('git', ['show', `${manifest.source_commit}:${path}`], { cwd: root, encoding: 'utf8' });
  const expected = manifest.files.find(file => file.path === path);
  if (createHash('sha256').update(source).digest('hex') !== expected?.sha256) throw new Error('Reviewed source hash mismatch');
  return source;
};
const contract = readSource('frontend/nextjs-app/lib/staffInventoryIdentification.ts');
const source = readSource('frontend/nextjs-app/lib/server/staffInventoryIdentification.ts');
const constants = contract.slice(contract.indexOf('export const STAFF_INVENTORY_IDENTIFICATION_MODEL'), contract.indexOf('\nconst photoKey'))
  .replaceAll('export ', '').replace(/^type StaffInventoryIdentificationField.*\n/m, '').replaceAll(' as const', '')
  .replace(': Record<StaffInventoryIdentificationField, number>', '');
const definitions = source.slice(source.indexOf('const confidence ='), source.indexOf('\n/** No persistence, grading, catalog writes'))
  .replace('function suggestionSchema(max: number)', 'function suggestionSchema(max)')
  .replace(' as Record<StaffInventoryIdentificationField, ReturnType<typeof suggestionSchema>>', '')
  .replace('function unsafeText(text: string)', 'function unsafeText(text)')
  .replace('export function parseStaffInventoryIdentificationOutput(payload: unknown): StaffInventoryIdentificationSuggestions', 'function parseStaffInventoryIdentificationOutput(payload)')
  .replace('const texts: string[] = []', 'const texts = []').replace('let decoded: unknown', 'let decoded')
  .replace('function buildRequest(photos: Record<Side, Photo>, ocr: Record<Side, OcrEvidence>)', 'function buildRequest(photos, ocr)')
  .replaceAll(' as const', '');
const baseline = vm.runInNewContext(`${constants}\nconst object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;\n${definitions}\n({buildRequest,parseStaffInventoryIdentificationOutput})`, {
  z, StaffInventoryIdentificationError: class extends Error {}, Buffer,
});
const photos = {
  front: { bytes: await sharp({ create: { width: 12, height: 16, channels: 3, background: '#1234ab' } }).jpeg({ quality: 88 }).toBuffer() },
  back: { bytes: await sharp({ create: { width: 12, height: 16, channels: 3, background: '#ab3412' } }).jpeg({ quality: 88 }).toBuffer() },
};
const ocr = { front: { text: '2023-24 Panini #00023/099', status: 'read' }, back: { text: 'Maker wordmark on back', status: 'read' } };
const fields = ['name', 'category', 'manufacturer', 'card_number', 'year', 'set_name', 'variant', 'card_type'];
const suggestions = Object.fromEntries(fields.map(field => [field, { value: null, confidence: 'unknown', evidence: null }]));
Object.assign(suggestions, {
  name: { value: 'Example Player', confidence: 'high', evidence: 'Front: Example Player' },
  category: { value: 'Sports cards', confidence: 'high', evidence: 'Front: basketball player' },
  card_number: { value: '00023/099', confidence: 'medium', evidence: 'Back: 00023/099' },
  year: { value: '2023-24', confidence: 'high', evidence: 'Front: 2023-24' },
});
const payload = {
  model: 'gpt-6-astra', status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(Object.fromEntries(Object.entries(suggestions).reverse())) }] }],
};
const parsed = baseline.parseStaffInventoryIdentificationOutput(payload);
const request = baseline.buildRequest(photos, ocr);
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const fixture = {
  source_commit: manifest.source_commit, purpose: 'Synthetic request and parsed-output parity against the reviewed source, not card recognition accuracy.',
  photos: Object.fromEntries(Object.entries(photos).map(([side, photo]) => [side, photo.bytes.toString('base64')])),
  ocr, request, request_sha256: hash(request), provider_payload: payload, parsed_suggestions: parsed, parsed_suggestions_sha256: hash(parsed),
};
await mkdir(new URL('../test/fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('../test/fixtures/source-parity.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
