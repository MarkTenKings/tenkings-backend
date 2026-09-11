import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture, mount, photo, clone } from './rapid-intake-harness.mjs';
import { prepareIntakePhoto } from '../lib/workspace-client.mjs';
async function pair(h) { await h.select(0, photo('front')); await h.select(1, photo('back')); await h.flush(); }

test('Front and Back alone verify, identify and queue; next capture stays ready', async t => {
    const f = fixture(), h = await mount(f); t.after(() => h.close());
    assert.equal(h.nodes(node => node.type === 'input' && node.props.type === 'checkbox').length, 0);
    await h.select(0, photo('front')); assert.equal(f.requests.length, 0);
    await h.select(1, photo('back')); await h.flush();
    assert.equal(f.cards.size, 1); assert.equal(f.puts.length, 2); assert.equal(f.saved[0].card.state, 'WAITING');
    assert.equal(f.saved[0].pending, null); assert.equal(f.saved[0].identity.cardName, 'Charmander'); assert.equal(f.saved[0].identity.cardNumber, '007');
    assert.equal(f.saved[0].files.FRONT, null); assert.equal(f.saved[0].files.BACK, null);
    assert.equal(f.saved.length, 2); assert.equal(h.nodes(node => node.type === 'RapidCardCamera')[0].props.entry.id, f.saved[1].id);
    assert.deepEqual(f.requests.map(value => value.path.split('/').at(-1)), ['cards', 'upload-plan', 'upload-plan', 'upload-complete', 'upload-complete', 'identify', 'queue']);
    assert.ok(f.requests.every(value => !/claim|action/.test(value.path))); assert.match(h.text(), /8\.1 s/);
    assert.equal(f.requests[0].body.title, '', 'A local Card N placeholder must not hide discovered identity in the shared queue');
});

test('preparations overlap and a late retake cannot replace newer evidence', async t => {
    const f = fixture(), work = new Map(); f.prepare = file => new Promise(resolve => work.set(file.name, () => resolve({ file, original: null, conversion: null })));
    const h = await mount(f); t.after(() => h.close());
    await h.select(0, photo('front-old')); await h.select(1, photo('back'));
    assert.equal(work.size, 2); assert.equal(f.requests.length, 0); assert.equal(h.files()[0].props.disabled, false);
    await h.select(0, photo('front-new')); work.get('front-old.png')(); await h.flush();
    assert.ok(work.has('front-new.png')); work.get('back.png')(); work.get('front-new.png')(); await h.flush();
    assert.equal(f.saved[0].card.state, 'WAITING'); assert.deepEqual(f.puts.map(value => value.name), ['front-new.png', 'back.png']);
});

test('retakes preserve the category context of human names and blanks but clear machine-only identity', async t => {
    for (const name of ['Staff corrected name', '', null]) {
        const f = fixture();
        f.saved = [{ id: randomUUID(), title: 'Card 1', titleIsPlaceholder: true, identity: { category: 'POKEMON', cardName: name ?? 'Machine name', productSet: 'Machine set' },
            editedFields: name === null ? [] : ['cardName'], files: { FRONT: photo('earlier-front'), BACK: null }, uploads: {}, card: null, pending: null, pairConfirmed: false, autoQueue: true }];
        const h = await mount(f); t.after(() => h.close());
        await h.select(0, photo('retaken-front'));
        assert.deepEqual(f.saved[0].identity, name === null ? {} : { category: 'POKEMON', cardName: name });
        assert.deepEqual(f.saved[0].editedFields, name === null ? [] : ['cardName']);
        assert.equal(f.requests.length, 0);
    }
});

test('an explicit staff label survives discovered identity and automatic queueing', async t => {
    const f = fixture(); let h = await mount(f); t.after(() => h.close());
    f.saved[0].title = 'Mark’s comparison card'; delete f.saved[0].titleIsPlaceholder;
    h.close(); h = await mount(f); await pair(h);
    assert.equal(f.requests[0].body.title, 'Mark’s comparison card');
    assert.equal(f.saved[0].card.identity.cardName, 'Charmander');
    assert.equal(h.nodes(node => node.type === 'h2')[0].props.children[0], 'Mark’s comparison card');
});

test('reload during HEIC preparation resumes saved original bytes without selecting again', async t => {
    const f = fixture(); let release;
    f.prepare = file => new Promise(resolve => { release = () => resolve({ file: photo('stale-import'), original: file, conversion: null }); });
    let h = await mount(f); t.after(() => h.close());
    const original = new File(['unchanged HEIC'], 'front.heic', { type: 'image/heic' });
    await h.select(0, original); assert.deepEqual(await f.saved[0].selections.FRONT.file.arrayBuffer(), await original.arrayBuffer());
    h.close(); f.prepare = (file, options) => prepareIntakePhoto(file, { ...options, convert: async () => ({ blob: new Blob(['PNG'], { type: 'image/png' }), width: 3024, height: 4032, colorSpace: 'display-p3' }) });
    h = await mount(f); await h.flush(); release(); await h.flush();
    assert.equal(f.saved[0].files.FRONT.name, 'front.heic.png'); assert.deepEqual(await f.saved[0].sourceFiles.FRONT.arrayBuffer(), await original.arrayBuffer());
    assert.equal(f.saved[0].photoImports.FRONT.width, 3024); assert.equal(f.requests.length, 0);
});

test('failed local selection keeps the previous photo and permits retry', async t => {
    const f = fixture(), h = await mount(f); t.after(() => h.close());
    await h.select(0, photo('old-front')); const prior = clone(f.saved[0]); f.failWrite = true;
    await h.select(0, photo('replacement')); assert.deepEqual(f.saved[0], prior); assert.match(h.text(), /Your previous photo is kept/);
    await h.select(0, photo('replacement')); assert.equal(f.saved[0].files.FRONT.name, 'replacement.png'); assert.equal(f.requests.length, 0);
});

test('staff edits and deliberate blanks during identification win before automatic queueing', async t => {
    const f = fixture(); f.holdIdentity = true; const h = await mount(f); t.after(() => h.close());
    await pair(h); assert.ok(f.releaseIdentity);
    await h.change('Category', 'POKEMON'); await h.change('Card name', 'Human correction'); await h.change('Card number', '');
    f.releaseIdentity(); await h.flush();
    assert.equal(f.saved[0].card.state, 'WAITING'); assert.equal(f.saved[0].card.identity.cardName, 'Human correction'); assert.equal(f.saved[0].card.identity.cardNumber, '');
    assert.ok(f.requests.find(value => value.path.endsWith('/identity')).body.editedFields.includes('cardNumber'));
    assert.equal(f.requests.filter(value => value.path.endsWith('/identify')).length, 1);
});

test('identity editing is locked before the queue manifest commits, including stale rendered handlers', async t => {
    const f = fixture(), write = f.write; let releaseQueueWrite, held = false;
    f.write = async entries => {
        if (!held && entries[0]?.pending?.path.endsWith('/queue')) {
            held = true; await new Promise(resolve => { releaseQueueWrite = resolve; });
        }
        await write(entries);
    };
    const h = await mount(f); t.after(() => { releaseQueueWrite?.(); h.close(); });
    await pair(h); await h.flush(20);
    assert.ok(releaseQueueWrite); assert.equal(f.saved[0].pending, null);
    assert.equal(h.nodes(node => node.type === 'fieldset')[0].props.disabled, true);
    // A previously rendered event handler is guarded too. This event is after
    // the visible edit handoff, so it must not become a local-only correction.
    await h.change('Card name', 'Stale handler after editing closed');
    assert.equal(f.saved[0].identity.cardName, 'Charmander');
    releaseQueueWrite(); await h.flush(20);
    assert.equal(f.saved[0].card.state, 'WAITING'); assert.equal(f.saved[0].card.identity.cardName, f.saved[0].identity.cardName);
    assert.equal(f.saved[0].editedFields.includes('cardName'), false);
});

test('an edit accepted before the final handoff is committed and synchronized before queue admission', async t => {
    const f = fixture(), write = f.write; let releaseIdentificationWrite, held = false;
    f.write = async entries => {
        if (!held && entries[0]?.identification && !entries[0].pending && entries[0].card.state === 'DRAFT') {
            held = true; await new Promise(resolve => { releaseIdentificationWrite = resolve; });
        }
        await write(entries);
    };
    const h = await mount(f); t.after(() => { releaseIdentificationWrite?.(); h.close(); });
    await h.change('Category', 'POKEMON'); await pair(h); await h.flush(20);
    assert.ok(releaseIdentificationWrite); assert.equal(h.nodes(node => node.type === 'fieldset')[0].props.disabled, false);
    const edit = h.change('Card name', 'Correction accepted before queue');
    releaseIdentificationWrite(); await edit; await h.flush(20);
    assert.equal(f.saved[0].card.state, 'WAITING'); assert.equal(f.saved[0].card.identity.cardName, 'Correction accepted before queue');
    const queueIndex = f.requests.findIndex(value => value.path.endsWith('/queue'));
    const correctionIndex = f.requests.findIndex(value => value.path.endsWith('/identity') && value.body.identity.cardName === 'Correction accepted before queue');
    assert.ok(correctionIndex >= 0 && correctionIndex < queueIndex);
    assert.equal(f.saved[0].card.identity.cardName, f.saved[0].identity.cardName);
});

test('choosing the initial category leaves names and hidden fields available to identification', async t => {
    const f = fixture(), h = await mount(f); t.after(() => h.close());
    await h.change('Category', 'POKEMON');
    assert.deepEqual(f.saved[0].editedFields, ['category']);
    await pair(h);
    assert.equal(f.saved[0].card.state, 'WAITING'); assert.equal(f.saved[0].card.identity.cardName, 'Charmander');
    assert.equal(Object.hasOwn(f.saved[0].card.identity, 'layoutType'), false);
    for (const request of f.requests.filter(value => value.path.endsWith('/identity'))) assert.deepEqual(request.body.editedFields, ['category']);
});

test('a category transition clears only existing incompatible values and preserves deliberate blanks', async t => {
    const f = fixture(), h = await mount(f); t.after(() => h.close());
    await h.change('Category', 'SPORTS'); await h.change('Player name', 'Previous sports name'); await h.change('Manufacturer', 'Previous maker');
    await h.change('Card number', ''); await h.change('Category', 'POKEMON');
    assert.deepEqual(f.saved[0].editedFields, ['category', 'playerName', 'manufacturer', 'cardNumber']);
    assert.equal(Object.hasOwn(f.saved[0].identity, 'playerName'), false); assert.equal(Object.hasOwn(f.saved[0].identity, 'manufacturer'), false);
    await pair(h);
    assert.equal(f.saved[0].card.state, 'WAITING'); assert.equal(f.saved[0].card.identity.cardName, 'Charmander');
    assert.equal(f.saved[0].card.identity.cardNumber, '');
    assert.equal(Object.hasOwn(f.saved[0].card.identity, 'layoutType'), false);
});

test('lost verification and queue responses resume exactly without replacing or reuploading photos', async t => {
    for (const action of ['upload-complete', 'queue']) {
        const f = fixture(); f.failAfter.set(action, new Error('Reply lost after commit'));
        let h = await mount(f); t.after(() => h.close()); await pair(h);
        const pending = clone(f.saved[0].pending); assert.ok(pending.path.endsWith(`/${action}`)); assert.equal(f.puts.length, 2);
        if (action === 'queue') { f.cards.get(f.saved[0].card.id).state = 'IN_PROGRESS'; f.cards.get(f.saved[0].card.id).stage = 'IDENTITY'; }
        h.close(); h = await mount(f); await h.flush();
        assert.equal(f.saved[0].card.state, action === 'queue' ? 'IN_PROGRESS' : 'WAITING'); assert.equal(f.puts.length, 2); assert.equal(f.cards.size, 1);
        const repeated = f.requests.filter(value => value.body.operationId === pending.body.operationId); assert.equal(repeated.length, 2); assert.deepEqual(repeated[1].body, pending.body);
    }
});

test('exact duplicate queue recovery opens the original card and retains HEIC originals', async t => {
    const f = fixture(); f.duplicate = { state: 'EXISTING_CARD', cardId: randomUUID(), title: 'Original Charmander', cardState: 'IN_PROGRESS', stage: 'IDENTITY' };
    f.failAfter.set('queue', new Error('Lost duplicate reply')); let h = await mount(f); t.after(() => h.close()); await pair(h);
    const pending = clone(f.saved[0].pending), count = f.requests.length;
    f.saved[0].sourceFiles = { FRONT: new File(['original HEIC'], 'front.heic', { type: 'image/heic' }) };
    h.close(); h = await mount(f); await h.flush();
    assert.equal(f.requests.length, count + 1); assert.deepEqual(f.requests.at(-1).body, pending.body);
    assert.equal(f.saved[0].resolvedCard.cardId, f.duplicate.cardId); assert.equal(f.saved[0].autoQueue, false); assert.equal(f.saved[0].pending, null);
    assert.equal(await f.saved[0].sourceFiles.FRONT.text(), 'original HEIC'); assert.match(h.text(), /Open existing card/);
    await h.event('focus'); assert.equal(f.requests.length, count + 1);
});

test('rejected or mismatched verification preserves the pair and cannot identify or queue', async t => {
    for (const malformed of [false, true]) {
        const f = fixture(); if (malformed) f.malformedVerification = true; else f.rejectSide = 'FRONT';
        const h = await mount(f); t.after(() => h.close()); await pair(h);
        assert.equal(f.requests.filter(value => /identify|queue/.test(value.path)).length, 0); assert.notEqual(f.saved[0].files.FRONT, null); assert.notEqual(f.saved[0].files.BACK, null);
        assert.equal(h.files()[0].props.disabled, malformed); if (!malformed) assert.equal(f.saved[0].pairConfirmed, false);
    }
});

test('identity response for another pair stays pending and cannot queue', async t => {
    const f = fixture(); f.wrongIdentityPair = true; const h = await mount(f); t.after(() => h.close()); await pair(h);
    assert.ok(f.saved[0].pending.path.endsWith('/identify')); assert.equal(f.requests.filter(value => value.path.endsWith('/queue')).length, 0); assert.equal(f.saved[0].identity.cardName, undefined);
});

test('unknown category is correctable while waiting without another model call', async t => {
    const f = fixture(); f.unknownIdentity = true; const h = await mount(f); t.after(() => h.close()); await pair(h);
    assert.equal(f.saved[0].card.state, 'WAITING'); assert.match(h.text(), /Choose the card category/);
    await h.change('Category', 'POKEMON'); await h.change('Card name', 'Verified by staff'); await h.click('Save corrected details');
    assert.equal(f.saved[0].card.identity.cardName, 'Verified by staff'); assert.equal(f.saved[0].card.identityReview.status, 'READY'); assert.equal(f.requests.filter(value => value.path.endsWith('/identify')).length, 1);
});

test('sign-in recovery continues the original queue operation on focus', async t => {
    const f = fixture(); f.failAfter.set('queue', Object.assign(new Error('Sign in'), { code: 'SIGN_IN_REQUIRED' }));
    const h = await mount(f); t.after(() => h.close()); await pair(h);
    const pending = clone(f.saved[0].pending); assert.match(h.text(), /Sign in to continue/);
    await h.event('focus'); assert.equal(f.saved[0].pending, null); assert.equal(f.saved[0].card.state, 'WAITING'); assert.deepEqual(f.requests.at(-1).body, pending.body); assert.equal(f.puts.length, 2);
});
