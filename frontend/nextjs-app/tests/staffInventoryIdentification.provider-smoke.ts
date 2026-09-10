/** Manual, synthetic-only provider proof. This file is deliberately not a *.test.ts.
 * Run with the existing OPENAI_API_KEY and GOOGLE_VISION_API_KEY in the process.
 * Storage is an in-memory fixture: it never reads or uploads a production object. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { identifyStaffInventoryCard, StaffInventoryIdentificationError } from '../lib/server/staffInventoryIdentification';

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim() || !process.env.GOOGLE_VISION_API_KEY?.trim()) {
    throw new Error('Existing OpenAI and Google Vision configuration is required.');
  }
  const photos = await Promise.all(['FRONT', 'BACK'].map(async side => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1100">
      <rect width="800" height="1100" fill="#f6f2e8"/>
      <rect x="35" y="35" width="730" height="1030" rx="16" fill="none" stroke="#243052" stroke-width="12"/>
      <g font-family="Arial, sans-serif" text-anchor="middle" fill="#243052">
        <text x="400" y="130" font-size="38">2024 Fixture Cards</text>
        <text x="400" y="215" font-size="42">Sample Baseball Set</text>
        <text x="400" y="350" font-size="70">Alex Sample</text>
        <text x="400" y="460" font-size="40">Baseball</text>
        <text x="400" y="620" font-size="64">Card #007</text>
        <text x="400" y="745" font-size="38">TEST EDITION</text>
        <text x="400" y="910" font-size="40">${side}</text>
        <text x="400" y="1000" font-size="22">Synthetic test artwork</text>
      </g>
    </svg>`;
    const bytes = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    const hash = createHash('sha256').update(bytes).digest('hex');
    return { bytes, key: `inventory-photos/11111111-1111-4111-8111-111111111111/${hash}.jpg` };
  }));
  const source = new Map(photos.map(photo => [photo.key, photo.bytes]));
  const result = await identifyStaffInventoryCard({ front_photo_key: photos[0].key, back_photo_key: photos[1].key }, {
    storageMode: () => 's3',
    headObject: async storageKey => ({ storageKey, byteSize: source.get(storageKey)!.length, contentType: 'image/jpeg', metadata: {}, checksumSha256: null }),
    openRead: async storageKey => ({ storageKey, byteSize: source.get(storageKey)!.length, body: Readable.from([source.get(storageKey)!]) }),
  });
  assert.equal(result.provenance.model, 'gpt-6-astra');
  assert.equal(result.provenance.ocr.front, 'read');
  assert.equal(result.provenance.ocr.back, 'read');
  assert.equal(result.suggestions.name.value, 'Alex Sample');
  assert.equal(result.suggestions.category.value, 'Sports cards');
  assert.equal(result.suggestions.card_number.value?.replace(/^#/, ''), '007');
  console.log(JSON.stringify({ outcome: 'PASS', model: result.provenance.model, reasoning_effort: result.provenance.reasoning_effort, elapsed_ms: result.provenance.elapsed_ms, ocr: result.provenance.ocr, suggestions: result.suggestions, warnings: result.warnings, storage: 'in_memory_synthetic_only', production_writes: 0 }, null, 2));
}
main().catch(error => {
  console.error(JSON.stringify({ outcome: 'FAIL', code: error instanceof StaffInventoryIdentificationError ? error.code : 'smoke_failed', message: error instanceof StaffInventoryIdentificationError ? error.message : 'Synthetic provider proof did not pass.' }));
  process.exitCode = 1;
});
