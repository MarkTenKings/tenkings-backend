import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovedReportView } from '@atlas/manual-workspace/report-review';
import { manualPublicClient, MANUAL_PUBLIC_ORIGIN, MANUAL_PUBLIC_PATH } from '@atlas/service-bridge/manual-public';
import { decodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';
import { createApprovedManualReader, createManualPublicHandler } from '../../../packages/atlas-connected-manual/src/publication-reader.mjs';
import { publicationFixture } from '../../../packages/atlas-connected-manual/test/publication-fixture.mjs';
import { PublicReportReader } from '../lib/server/reader.mjs';
import { makePublicConfig } from '../lib/server/policy.mjs';

// Synthetic persistence remains confined to this qualification script. The
// publication, artifact, transport, read, and render implementations are real.
export async function qualifyManualPublicRoundtrip() {
    const fixture = await publicationFixture();
    await fixture.publication.publish({}, fixture.cardId, fixture.actionId);
    const config = makePublicConfig({ mode: 'LOCAL_FIXTURE', origin: 'https://atlasgrading.com',
        deploymentId: 'manual-public-fixture.vercel.app', releaseSha: 'a'.repeat(40),
        manualOrigin: MANUAL_PUBLIC_ORIGIN, manualKey: Buffer.alloc(32, 19) });
    let enabled = true, queries = 0, requests = 0, checks = 0;
    const client = { async $transaction(work) { return work({ async $queryRawUnsafe(sql, token, version, deployment, release, hash) {
        queries++;
        assert.equal(sql, 'SELECT * FROM atlas_manual.read_publication($1::text,$2::integer,$3::text,$4::text,$5::text)');
        return enabled && token === fixture.row.public_token && (version === null || version === 1)
            && deployment === config.deploymentId && release === config.releaseSha && hash === config.configHash
            ? [structuredClone(fixture.row)] : [];
    } }); } };
    const privateReader = createApprovedManualReader({ client, artifacts: fixture.artifacts, storage: fixture.storage });
    const handler = createManualPublicHandler({ key: config.manualKey, reader: privateReader });
    const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.statusCode = 404; res.end(); } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    // Transport injection changes only the destination socket. The signed URL,
    // headers, body, response type and HTTP handler are the production protocol.
    const fetchLocal = (url, options) => new Promise((resolve, reject) => {
        assert.equal(url, MANUAL_PUBLIC_ORIGIN + MANUAL_PUBLIC_PATH);
        assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST'); requests++;
        const req = request({ host: '127.0.0.1', port: server.address().port, path: MANUAL_PUBLIC_PATH,
            method: options.method, signal: options.signal, headers: { ...options.headers, host: 'private.atlasgrading.com' } }, res => {
            const parts = []; res.on('data', part => parts.push(part)); res.on('error', reject);
            res.on('end', () => {
                assert.equal(res.headers['set-cookie'], undefined);
                assert.equal(res.headers['cache-control'], 'no-store');
                resolve(new Response(Buffer.concat(parts), { status: res.statusCode, headers: res.headers }));
            });
        });
        req.on('error', reject); req.end(options.body);
    });
    const openReader = (changes = {}) => new PublicReportReader(config, manualPublicClient({ ...config, ...changes }, fetchLocal));
    const selector = { token: fixture.row.public_token, version: 1 };
    try {
        let reader = openReader();
        const published = await reader.read(selector);
        assert.equal(published.publicHash, fixture.row.public_hash);
        assert.equal(published.packet.report.finalGrade, fixture.full.finalGrade); checks++;
        assert.deepEqual(await reader.read({ ...selector, version: null }), published); checks++;
        for (const side of ['FRONT', 'BACK']) {
            assert.deepEqual(await reader.image({ ...selector, side }), { bytes: fixture.bytes[side], contentType: 'image/webp' }); checks++;
        }
        const trace = await reader.trace({ ...selector, findingId: fixture.full.findings[0].id });
        assert.equal(trace.publicHash, published.publicHash);
        assert.ok(decodeSpeedsterTraceBitmapWireV1(trace.traceWire).some(Boolean)); checks++;
        const html = renderToStaticMarkup(React.createElement(ApprovedReportView, {
            report: published.packet.report, explanation: published.explanation, geometry: published.packet.geometry,
            publication: { version: 1, reportHash: published.publicHash, reportNumber: published.packet.reportNumber,
                approvedAt: published.packet.approvedAt, url: `/reports/${selector.token}?v=1` },
        }));
        assert.ok(html.includes(fixture.row.report_number)); assert.ok(html.includes('How this grade is calculated'));
        for (const forbidden of [fixture.actorId, fixture.cardId, 'private/', 'Approve final report', 'Rejected Astra suggestions'])
            assert.equal(html.includes(forbidden), false, forbidden);
        checks++;
        for (const missing of [{ ...selector, version: 2 }, { ...selector, token: 'ar_' + 'B'.repeat(24) }]) {
            assert.equal(await reader.read(missing), null); checks++;
        }
        assert.equal(await reader.trace({ ...selector, findingId: 'private-removed-finding' }), null); checks++;
        assert.equal(await reader.image({ ...selector, version: null, side: 'FRONT' }), null); checks++;
        assert.equal(await openReader({ releaseSha: 'b'.repeat(40) }).read(selector), null); checks++;
        const beforeBadKey = queries;
        await assert.rejects(openReader({ manualKey: Buffer.alloc(32, 20) }).read(selector), /MANUAL_PUBLIC_UNAVAILABLE/);
        assert.equal(queries, beforeBadKey); checks++;
        // A fresh public client has no database or media fallback and reads the
        // same immutable publication through the signed bridge.
        reader = openReader(); assert.deepEqual(await reader.read(selector), published); checks++;
        fixture.corruptBytes();
        await assert.rejects(reader.image({ ...selector, side: 'FRONT' }), /MANUAL_PUBLIC_UNAVAILABLE/); checks++;
        fixture.corruptBytes(false);
        const readDerivative = fixture.storage.readDerivative;
        fixture.storage.readDerivative = async input => { const value = await readDerivative(input); enabled = false; return value; };
        await assert.rejects(reader.image({ ...selector, side: 'FRONT' }), /MANUAL_PUBLIC_UNAVAILABLE/); checks++;
        assert.equal(await reader.read(selector), null); assert.equal(await openReader().read(selector), null); checks++;
        return { ok: true, checks, requests, publicationReads: queries, transport: 'signed-manual-public', persistence: 'synthetic-in-memory' };
    } finally {
        server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    console.log(JSON.stringify({ status: 'MANUAL_PUBLIC_HTTP_ROUNDTRIP_PASS', ...await qualifyManualPublicRoundtrip() }));
