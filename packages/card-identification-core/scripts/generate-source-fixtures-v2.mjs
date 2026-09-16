// Deliberate regeneration against immutable Inventory source; offline and no app
// initialization. Ordinary tests use the checked-in fixture without git or TS.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import sharp from 'sharp';
import { z } from 'zod';

const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('../source-manifest-v2.json', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
const readSource = path => {
  const bytes = execFileSync('git', ['show', `${manifest.source_commit}:${path}`], { cwd: root });
  if (hash(bytes) !== manifest.files.find(file => file.path === path)?.sha256) throw new Error('Reviewed source hash mismatch');
  return bytes.toString('utf8');
};
const contract = readSource('frontend/nextjs-app/lib/staffInventoryIdentification.ts');
const source = readSource('frontend/nextjs-app/lib/server/staffInventoryIdentification.ts');
const constants = contract.slice(contract.indexOf('export const STAFF_INVENTORY_IDENTIFICATION_MODEL'), contract.indexOf('\nconst photoKey'));
const definitions = source.slice(source.indexOf('const confidence ='), source.indexOf('\n/** No persistence, grading, catalog writes'));
const executable = stripTypeScriptTypes(`${constants}\n${definitions}`.replaceAll('export ', ''));
const baseline = vm.runInNewContext(`const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;\n${executable}\n({buildRequest,parseStaffInventoryIdentificationOutput})`, {
  z, sharp, Buffer, StaffInventoryIdentificationError: class extends Error {},
});
const legacy = JSON.parse(await readFile(new URL('../test/fixtures/source-parity.json', import.meta.url)));
const photos = Object.fromEntries(Object.entries(legacy.photos).map(([side, base64]) => [side, { bytes: Buffer.from(base64, 'base64') }]));
const cases = [];
for (const [name, ocr] of [
  ['sports', legacy.ocr],
  ['pokemon', { front: { text: 'Snivy\nPokémon RC1/RC25 ©2013', status: 'read' }, back: { text: 'Pokémon', status: 'read' } }],
  ['pokemon_back_only', { front: { text: 'Snivy RC1/RC25', status: 'read' }, back: { text: 'back\nPokemon', status: 'read' } }],
]) {
  const request = await baseline.buildRequest(photos, ocr);
  cases.push({ name, ocr, request, request_sha256: hash(JSON.stringify(request)) });
}
const responseFields = source.match(/const GOOGLE_TEXT_FIELDS = '([^']+)'/)[1];
const fixture = {
  source_commit: manifest.source_commit,
  purpose: 'Synthetic exact request/parser parity against immutable Inventory source; no recognition accuracy or runtime claim.',
  sharp_versions: sharp.versions,
  photos: legacy.photos, response_fields: responseFields, cases,
  provider_payload: legacy.provider_payload,
  parsed_suggestions: baseline.parseStaffInventoryIdentificationOutput(legacy.provider_payload),
};
await writeFile(new URL('../test/fixtures/source-parity-v2.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
