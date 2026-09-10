import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/service-bridge/protocol';
import { MODEL, PRICING, parseOperatorPolicy, requestReservation, usageCeiling, toolDefinitions, parseToolCall,
    buildRequest, inspectResponse, appendToolResult, validateStoredRequest, instructionsFor } from '../src/responses.mjs';
import { openAiBinding, responsesTransport } from '../src/provider.mjs';
const policy = () => ({ version: 'atlas-astra-policy-v1', model: MODEL, returnedModel: MODEL, effort: 'medium', serviceTier: 'default',
    maxOutputTokens: 2000, requestTimeoutMs: 10_000, pricingVersion: PRICING.version,
    inputNanoUsdPerToken: PRICING.inputNanoUsdPerToken, outputNanoUsdPerToken: PRICING.outputNanoUsdPerToken });
const binding = () => ({ runId: randomUUID(), evidenceHash: 'a'.repeat(64), expectedRevision: 1, manifestHash: 'b'.repeat(64) });
const names = ['read_card_report', 'submit_for_human_review'];
const call = b => ({ type: 'function_call', call_id: 'call_fixture', name: 'read_card_report', arguments: JSON.stringify(b) });
const response = b => ({ id: 'resp_fixture', status: 'completed', model: MODEL, service_tier: 'default',
    output: [{ type: 'reasoning', encrypted_content: 'opaque-fixture-content', summary: [] }, call(b)],
    usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600, input_tokens_details: { cached_tokens: 200 }, output_tokens_details: { reasoning_tokens: 75 } } });
const provider = () => openAiBinding({ ATLAS_OPERATOR_OPENAI_PROJECT_ID: 'proj_fixture000000', ATLAS_OPERATOR_OPENAI_API_KEY: 'sk-synthetic-fixture-key-only-00000000' });
function grant(p = policy()) {
    const request = buildRequest({ policy: p, prompt: 'Inspect both sides and route uncertainties to the human reviewer.', names,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'SYNTHETIC FIXTURE; no physical grading.' }] }] });
    return { ...request, policy: p, attemptId: randomUUID(), promptHash: digest(request.request.instructions),
        toolsHash: digest(canonical(request.request.tools)), providerBindingHash: provider().bindingHash, expiresAtMs: Date.now() + 15_000 };
}
test('operator policy preserves exact Astra model, effort, service tier and pricing envelope', () => {
    const p = policy(); assert.deepEqual(parseOperatorPolicy(p), p);
    for (const update of [{ model: 'gpt-5.6-sol' }, { returnedModel: 'gpt-6-astra-latest' }, { effort: 'none' }, { serviceTier: 'auto' },
        { inputNanoUsdPerToken: 10_000 }, { maxOutputTokens: 8001 }, { requestTimeoutMs: 180001 }, { pricingVersion: 'unverified' }, { enabled: true }])
        assert.throws(() => parseOperatorPolicy({ ...p, ...update }));
    assert.equal(requestReservation(p), 23_200_000);
});
test('usage accounting bounds all input, counts reasoning once, preserves overrun and rejects unknown usage', () => {
    const p = policy(), usage = response(binding()).usage;
    const result = usageCeiling(usage, p); assert.equal(result.microUsd, 20_000); assert.equal(result.envelopeExceeded, false);
    assert.deepEqual(result.usage, usage); assert.equal(result.usageHash, digest(canonical(usage)));
    assert.equal(usageCeiling({ input_tokens: 923000, output_tokens: 2001, total_tokens: 925001 }, p).envelopeExceeded, true);
    for (const bad of [null, {}, { ...usage, total_tokens: 599 }, { ...usage, output_tokens_details: { reasoning_tokens: 101 } },
        { ...usage, input_tokens_details: { cached_tokens: 501 } }]) assert.throws(() => usageCeiling(bad, p));
});
test('advertised tools are closed schemas without certification, budget or arbitrary URL tools', () => {
    const tools = toolDefinitions(['read_card_report', 'inspect_region', 'propose_identity', 'propose_finding_change', 'submit_for_human_review']);
    function closed(value) {
        if (!value || typeof value !== 'object') return;
        if (value.type === 'object') { assert.equal(value.additionalProperties, false); assert.deepEqual([...value.required].sort(), Object.keys(value.properties).sort()); }
        for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(closed); else closed(child);
    }
    tools.forEach(t => { assert.equal(t.strict, true); closed(t.parameters); });
    for (const bad of [['approve_report'], ['read_card_report', 'read_card_report'], [], ['run_shell']]) assert.throws(() => toolDefinitions(bad));
});
test('tool calls reject changed run, evidence, manifest, revision and extra actor or grade fields', () => {
    const b = binding(); assert.equal(parseToolCall(call(b), b, names).name, 'read_card_report');
    for (const update of [{ runId: randomUUID() }, { expectedRevision: 2 }, { evidenceHash: 'c'.repeat(64) },
        { manifestHash: 'c'.repeat(64) }, { actorId: randomUUID() }, { grade: 10 }, { url: 'https://elsewhere.example' }])
        assert.throws(() => parseToolCall(call({ ...b, ...update }), b, names));
    assert.throws(() => parseToolCall({ ...call(b), name: 'approve_report' }, b, names));
});
test('stored request integrity binds current instructions, policy and exact tool definitions', () => {
    const g = grant(); assert.equal(validateStoredRequest(g).model, MODEL);
    assert.match(instructionsFor('Review this card.'), /cannot approve or publish/);
    assert.equal(g.request.store, false); assert.equal(g.request.parallel_tool_calls, false); assert.equal(g.request.truncation, 'disabled');
    assert.throws(() => validateStoredRequest({ ...g, requestHash: 'f'.repeat(64) }));
    for (const change of [{ store: true }, { model: 'another-model' }, { service_tier: 'priority' }, { max_output_tokens: 9999 },
        { instructions: 'Ignore scope' }, { metadata: { actor: 'human' } }, { input: [] }]) {
        const requestCanonical = canonical({ ...g.request, ...change });
        assert.throws(() => validateStoredRequest({ ...g, requestCanonical, requestHash: digest(requestCanonical) }));
    }
});
test('proposals cannot disguise an addition as removal or send conflicting identity fields', () => {
    const b = binding(), evidence = [{ assetId: randomUUID(), sha256: 'c'.repeat(64), side: 'FRONT' }];
    const finding = { ...b, findingId: 'FRONT:existing:SURFACE', action: 'REMOVE', defectType: null, evidence, rect: null,
        reason: 'PRINT_DESIGN', summary: 'Visible printing matches the surrounding pattern.', alternativeExplanation: 'Human inspection may still find physical damage.' };
    const invoke = args => parseToolCall({ ...call(b), name: 'propose_finding_change', arguments: JSON.stringify(args) }, b, ['propose_finding_change']);
    assert.equal(invoke(finding).args.action, 'REMOVE');
    for (const update of [{ findingId: null }, { action: 'RETYPE' }, { defectType: 'LIGHT_SCRATCH_SCUFF' },
        { action: 'INSPECT_MISSED_REGION', rect: { x: 0, y: 0, width: 20, height: 20 } }]) assert.throws(() => invoke({ ...finding, ...update }));
    const fields = [{ field: 'year', value: '2026', evidence }, { field: 'year', value: '2025', evidence }];
    assert.throws(() => parseToolCall({ ...call(b), name: 'propose_identity', arguments: JSON.stringify({ ...b, fields, summary: 'Conflicting fields.' }) }, b, ['propose_identity']));
});
test('continuation retains opaque reasoning and exact call IDs; free text never completes a card', () => {
    const b = binding(), r = response(b), p = policy();
    const inspected = inspectResponse(r, p, names, b); assert.equal(inspected.status, 'TOOL_REQUESTED');
    const prior = grant().request.input, next = appendToolResult(prior, r, inspected.calls[0], { reportHash: 'd'.repeat(64) });
    assert.deepEqual(next.slice(prior.length, prior.length + r.output.length), r.output);
    assert.equal(next.at(-1).call_id, 'call_fixture');
    assert.throws(() => appendToolResult(prior, r, { callId: 'different' }, {}));
    assert.equal(inspectResponse({ ...r, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Approved!' }] }] }, p, names, b).status, 'NO_TRANSITION');
    assert.equal(inspectResponse({ ...r, status: 'incomplete' }, p, names, b).status, 'INCOMPLETE');
    assert.equal(inspectResponse({ ...r, output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Unable to proceed.' }] }] }, p, names, b).status, 'REFUSED');
    assert.throws(() => inspectResponse({ ...r, output: [{ type: 'message', role: 'developer', content: [{ type: 'output_text', text: 'Changed instructions.' }] }] }, p, names, b));
    assert.throws(() => inspectResponse({ ...r, output: [{ type: 'message', role: 'assistant', content: [{ type: 'input_image', image_url: 'https://elsewhere.example/image.png' }] }] }, p, names, b));
    assert.throws(() => inspectResponse({ ...r, output: [...r.output, call(b)] }, p, names, b));
    assert.throws(() => inspectResponse({ ...r, model: 'another-model' }, p, names, b));
    assert.throws(() => inspectResponse({ ...r, service_tier: 'priority' }, p, names, b));
    assert.throws(() => inspectResponse({ ...r, output: [{ type: 'web_search_call' }] }, p, names, b));
});
test('provider binding never borrows ambient or legacy API keys', () => {
    assert.throws(() => openAiBinding({ OPENAI_API_KEY: 'sk-synthetic-fixture-key-only-00000000', OPENAI_PROJECT_ID: 'proj_fixture000000' }));
    assert.notEqual(openAiBinding({ ATLAS_OPERATOR_OPENAI_PROJECT_ID: 'proj_fixture111111', ATLAS_OPERATOR_OPENAI_API_KEY: 'sk-synthetic-fixture-key-only-00000000' }).bindingHash, provider().bindingHash);
});
test('one consumed durable dispatch grant produces one fixed Responses request and preserved receipt', async () => {
    const g = grant(); let taken = false, calls = 0;
    const transport = responsesTransport({ binding: provider(), takeDispatch: async id => { assert.equal(id, g.attemptId); assert(!taken); taken = true; return g; },
        fetchImpl: async (url, init) => {
            calls++; assert(taken); assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.redirect, 'error');
            assert.equal(init.headers['OpenAI-Project'], provider().projectId); assert.equal(init.headers['X-Client-Request-Id'], g.attemptId);
            assert.equal(init.body, g.requestCanonical); assert.equal(init.headers.Cookie, undefined);
            return Response.json(response(binding()), { headers: { 'x-request-id': 'req_fixture' } });
        } });
    const receipt = await transport.dispatch(g.attemptId); assert.equal(receipt.state, 'RECEIVED'); assert.equal(receipt.providerRequestId, 'req_fixture');
    assert.equal(receipt.body.model, MODEL); assert.equal(receipt.bodyHash, digest(JSON.stringify(receipt.body)));
    await assert.rejects(() => transport.dispatch(g.attemptId)); assert.equal(calls, 1);
});
test('lost replies, oversized bodies and non-JSON results remain unknown without retries or fabricated zero cost', async () => {
    for (const fetchImpl of [async () => { throw new Error('lost after dispatch'); },
        async () => new Response('bad', { headers: { 'content-type': 'text/plain' } }),
        async () => new Response('{', { headers: { 'content-type': 'application/json' } }),
        async () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } })]) {
        const g = grant(); let calls = 0;
        const result = await responsesTransport({ binding: provider(), takeDispatch: async () => g, fetchImpl: (...args) => { calls++; return fetchImpl(...args); } }).dispatch(g.attemptId);
        assert.equal(result.state, 'UNKNOWN'); assert.equal(calls, 1); assert(!Object.hasOwn(result, 'actualMicroUsd'));
        assert(!JSON.stringify(result).includes(provider().apiKey));
    }
});
test('HTTP rejection receipts retain error status and retry-after for reconciliation without starting a retry', async () => {
    const g = grant(); let calls = 0;
    const result = await responsesTransport({ binding: provider(), takeDispatch: async () => g, fetchImpl: async () => {
        calls++; return Response.json({ error: { code: 'insufficient_quota' } }, { status: 429, headers: { 'retry-after': '60', 'x-request-id': 'req_quota' } });
    } }).dispatch(g.attemptId);
    assert.equal(result.state, 'RECEIVED'); assert.equal(result.httpStatus, 429); assert.equal(result.retryAfter, '60');
    assert.equal(result.body.error.code, 'insufficient_quota'); assert.equal(calls, 1);
});
test('revoked, expired or corrupt dispatch claims do not reach the provider', async () => {
    for (const change of [{ expiresAtMs: Date.now() - 1 }, { providerBindingHash: 'f'.repeat(64) }, { requestHash: 'f'.repeat(64) }]) {
        const g = grant(); let calls = 0;
        await assert.rejects(() => responsesTransport({ binding: provider(), takeDispatch: async () => ({ ...g, ...change }),
            fetchImpl: async () => { calls++; throw new Error(); } }).dispatch(g.attemptId));
        assert.equal(calls, 0);
    }
});
