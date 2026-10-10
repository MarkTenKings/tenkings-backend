import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { parseCatalogDemandSourceFile, parseUploadedSourceFile } from '../lib/server/setOpsDiscovery';
const parse = (body: string) => parseCatalogDemandSourceFile({ fileName: '2024-chrome.txt', contentType: 'text/plain', fileBuffer: Buffer.from(body) });
test('new evidence parser preserves literal sections and rejects legacy inferred base/prefix as evidence', () => {
  const body = '1 Example Player\n2 Other Player\n';
  const old = parseUploadedSourceFile({ fileName: 'checklist.txt', fileBuffer: Buffer.from(body) });
  assert.ok(old.rows.some(row => row.parallel === 'Base Set'));
  const current = parse(body); assert.ok(current.rows.length > 0); assert.ok(current.rows.every(row => row.parallel === null && row.evidenceKind === 'unclassified'));
  const prefix = parse('ABC-1 Example Player\nABC-2 Other Player\n'); assert.ok(prefix.rows.every(row => row.evidenceKind === 'unclassified'));
  const explicit = parse('GOLD REFRACTORS\n1 Example Player\n2 Other Player\n');
  assert.ok(explicit.rows.some(row => row.evidenceKind === 'literal_section' && /gold refractors/i.test(String(row.parallel))));
});
test('literal CSV fields retain provenance without supplying missing language or printing', () => {
  const parsed = parseCatalogDemandSourceFile({ fileName: 'checklist.csv', contentType: 'text/csv', fileBuffer: Buffer.from('Card Number,Player,Parallel\n25,Example Player,Silver Prizm\n') });
  assert.equal(parsed.rows.length, 1); assert.equal(parsed.rows[0].evidenceKind, 'literal_columns'); assert.equal('language' in parsed.rows[0], false);
});
test('source bytes and decompression are bounded without modifying legacy PDF defaults', () => {
  assert.throws(() => parseCatalogDemandSourceFile({ fileName: 'big.txt', contentType: 'text/plain', fileBuffer: Buffer.alloc(2 * 1024 * 1024 + 1) }), /size limit/);
  const compressed = deflateSync(Buffer.alloc(5 * 1024 * 1024, 65));
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Filter /FlateDecode >>\nstream\n'), compressed, Buffer.from('\nendstream\nendobj\n%%EOF')]);
  const parsed = parseCatalogDemandSourceFile({ fileName: 'bomb.pdf', contentType: 'application/pdf', fileBuffer: pdf });
  assert.equal(parsed.rows.length, 0, 'over-budget stream cannot produce partial inferred identity evidence');
});
