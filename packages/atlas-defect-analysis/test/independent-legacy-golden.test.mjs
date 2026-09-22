import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAstraDefectRequest, buildAstraBackgroundDefectRequest, restorePreparedRequest,
  parseDefectProposals } from '../src/index.mjs';
import { canonical, digest } from '../src/contract.mjs';
import { inputFixture, withLessons, outputFixture } from './fixtures.mjs';

// Independently captured using Node 20.20.1 from files read with git show
// 67b4e8c9:<path>, before the context-layout implementation. These literals must
// not be regenerated from the current builders to make a compatibility failure pass.
const goldens = [
  { memory: false, background: false, requestHash: 'b88df67a64bf6fb1b08f0d708bb2452daa22a6aa36ac69c291a522c6e3dc9736',
    evidenceHash: '1079263338b9e7f9890deeb0faec646e8983b1087f8b415781b908b1e6ec1798', requestBytes: 67469,
    resultHash: '340b1b4900a20524ce49e54aa7805c7cf36cbed2412bbfb8d781c34477852ec0' },
  { memory: false, background: true, requestHash: '8167a863eb06969b3ccc5c1f0fe088dd45f183f5f94a2a70a9a218f1c2286608',
    evidenceHash: 'cc28e29bdf5287ed9a0370fee954dcad2d85f5c4f756e8bc7b9a26cd8c09b566', requestBytes: 67487,
    resultHash: 'ac950576c7716ee073da7f7e8b976a53f4b0342edf2fe9efd0e1b7d428ce4a7f' },
  { memory: true, background: false, requestHash: '43e6315e05525dcbe54b5ba31e404098dcaca9b8d1ab17029a28361f711ff07b',
    evidenceHash: 'abad8f63aec968b46bc20939d87e2acb5a903cd0d3a80333e9ae8a19ff58b346', requestBytes: 71367,
    resultHash: 'ebab33a3f5de4ad5545808566043ead4e69d41ff1f0cc71b1ac5da3c482ac2bb' },
  { memory: true, background: true, requestHash: '009357b976710d88c7748a1217e709acf806aaff3ddd952302650f5d5332d3de',
    evidenceHash: '334ca324fafa0b2299a3dd272eb77823a5fb32140ca198f6dbaa5d54835e6ff0', requestBytes: 71385,
    resultHash: 'cffa6224e241241347d65ca2a0884fe31d65c75d62a7d0fdd0c0e2dc475c6f07' },
];

for (const golden of goldens) test(`checkpoint legacy ${golden.background ? 'V2' : 'V1'} bytes, evidence, restoration and proposals (${golden.memory ? 'reviewed' : 'empty'} memory)`, () => {
  const input = inputFixture();
  if (golden.memory) withLessons(input);
  const prepared = (golden.background ? buildAstraBackgroundDefectRequest : buildAstraDefectRequest)(input);
  assert.equal(prepared.requestHash, golden.requestHash);
  assert.equal(digest(prepared.requestText), golden.requestHash);
  assert.equal(Buffer.byteLength(prepared.requestText), golden.requestBytes);
  assert.equal(prepared.evidenceHash, golden.evidenceHash);
  assert.equal(Object.hasOwn(prepared.evidence, 'cropLayoutVersion'), false);
  assert.equal(prepared.evidence.sourceBindingSha256, '1e81ca275c8c05f446219667685a227db14db34849cbb47b6ac321f8ea4e96cc');
  assert.equal(prepared.evidence.promptSha256, 'ffdf36dd06afbaba89c29c8cf7c849047206c8662b3bceeb6af3fcee88212241');
  assert.equal(prepared.evidence.schemaSha256, '4ff10247eb9975de53f63eafcdb08bf2b177c67c8f69d6c67a52c0284ccb26d3');
  const restored = restorePreparedRequest(prepared);
  assert.equal(restored.requestText, prepared.requestText);
  assert.equal(restored.requestHash, golden.requestHash);
  assert.equal(restored.evidenceHash, golden.evidenceHash);
  const result = parseDefectProposals(outputFixture(restored.evidence), restored.evidence);
  assert.equal(digest(canonical(result)), golden.resultHash);
  assert.equal(Object.hasOwn(result.proposals[0].provenance, 'cropLayoutVersion'), false);
  assert.deepEqual(result.proposals[0].canonicalContour, [
    { x: 0, y: 0 }, { x: 10 / 1269, y: 0 }, { x: 10 / 1269, y: 12 / 1777 }, { x: 0, y: 12 / 1777 },
  ]);
});
