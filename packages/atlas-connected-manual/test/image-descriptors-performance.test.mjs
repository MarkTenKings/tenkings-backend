import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageDescriptors } from '../src/image-descriptors.mjs';
import { ManualServiceError } from '@atlas/manual-service/contract';

const SIDES = ['FRONT', 'BACK'], KINDS = ['rectified', 'inspection', 'normalized', 'microDefect', 'directional'];
const image = id => ({ id, raster: { content: { sha256: 'a'.repeat(64), byteCount: 100, mime: 'image/webp' } } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const f = { sources: [], manifests: [], current: 0, grants: [], active: 0, maximum: 0 };
  f.card = { cardId: 'synthetic-card', draft: { source: { uploads: { FRONT: 'front-upload', BACK: 'back-upload' } } } };
  f.state = { geometry: { sides: Object.fromEntries(SIDES.map(side => [side, { prepared: { frame: { id: side } } }])) } };
  f.photos = Object.fromEntries(SIDES.map(side => [side, { workingFrame: image(`${side}-original`) }]));
  const dependencies = {
    async current() { f.current++; if (f.beforeCurrent) await f.beforeCurrent(); },
    async readSource(_staff, _cardId, upload) {
      f.sources.push(upload); const side = upload === 'front-upload' ? 'FRONT' : 'BACK';
      return { photo: f.photos[side] };
    },
    async readManifest(_card, side) {
      f.manifests.push(side); return { frameId: f.badFrame ? 'wrong' : side,
        images: Object.fromEntries(KINDS.map(kind => [kind, image(`${side}-${kind}`)])) };
    },
    async imageReadUrl({ kind, descriptor, photo }) {
      const side = descriptor.id.startsWith('FRONT') ? 'FRONT' : 'BACK';
      assert.equal(photo, f.photos[side]); f.grants.push(descriptor.id); f.maximum = Math.max(f.maximum, ++f.active);
      try { if (f.beforeGrant) await f.beforeGrant(side, kind); else await new Promise(resolve => setImmediate(resolve));
        return { url: `https://synthetic.invalid/${descriptor.id}`, ...descriptor.raster.content };
      } finally { f.active--; }
    },
    imageUrl: (_cardId, side, kind, hash) => `/private/${side}/${kind}/${hash}`,
  };
  f.run = () => createImageDescriptors(dependencies)({ card: f.card, state: f.state, staff: {} });
  f.dependencies = dependencies;
  return f;
}

test('one verified source per side returns all12 descriptors with at most2 raster reads and final freshness', async () => {
  const f = fixture(), first = await f.run();
  assert.deepEqual(f.sources.sort(), ['back-upload', 'front-upload']);
  assert.deepEqual(f.manifests.sort(), SIDES.slice().sort()); assert.equal(f.current, 2);
  assert.equal(f.grants.length, 12); assert.equal(f.maximum, 2); assert.equal(f.active, 0);
  for (const side of SIDES) assert.deepEqual(Object.keys(first[side]), ['original', ...KINDS]);
  assert.deepEqual(await f.run(), first); assert.equal(f.sources.length, 4, 'a later request rereads and reauthorizes both sources');
});

test('the response waits for both sides and performs its fresh authorization after the final image', async () => {
  const f = fixture(), entered = deferred(), release = deferred(); let finished = false;
  f.beforeGrant = async (side, kind) => { if (side === 'BACK' && kind === 'directional') { entered.resolve(); await release.promise; } };
  const pending = f.run().then(result => { finished = true; return result; });
  await entered.promise; assert.equal(finished, false); assert.equal(f.current, 1);
  release.resolve(); await pending; assert.equal(f.current, 2); assert.equal(finished, true);
});

for (const [status, code] of [[409, 'MANUAL_PHOTOS_CHANGED'], [401, 'SIGN_IN_REQUIRED']]) {
  test(`late ${code} refuses the entire batch without returning any cached grants`, async () => {
    const f = fixture(); f.beforeCurrent = () => { if (f.current === 2) throw new ManualServiceError(status, code); };
    await assert.rejects(f.run(), { status, code }); assert.equal(f.grants.length, 12);
  });
}

test('initial authorization and prepared-frame mismatches remain fail closed', async () => {
  const f = fixture(); f.beforeCurrent = () => { throw new ManualServiceError(401, 'SIGN_IN_REQUIRED'); };
  await assert.rejects(f.run(), { code: 'SIGN_IN_REQUIRED' }); assert.equal(f.sources.length, 0); assert.equal(f.grants.length, 0);
  const g = fixture(); g.badFrame = true;
  await assert.rejects(g.run(), { code: 'MANUAL_IMAGE_BINDING_INVALID' });
  assert(g.grants.every(id => id.endsWith('-original')));
});

test('private-route fallback preserves exact hashes and does not mint external grants', async () => {
  const f = fixture(); f.dependencies.imageReadUrl = null;
  const result = await f.run(); assert.equal(f.grants.length, 0); assert.equal(f.current, 2);
  assert.equal(result.FRONT.inspection.url, `/private/FRONT/inspection/${'a'.repeat(64)}`);
  assert.equal(result.BACK.original.sha256, 'a'.repeat(64));
});
