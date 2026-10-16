import test from 'node:test';
import assert from 'node:assert/strict';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler, { config } from '../pages/api/internal/atlas/public-media';

test('the retired public-media endpoint refuses without reading any request or body', () => {
    const request = new Proxy({} as NextApiRequest, {
        get() { throw new Error('Retired public media must not inspect or consume the request.'); },
    });
    const state = { status: 0, body: undefined as unknown, headers: {} as Record<string, string> };
    const response = {
        setHeader(name: string, value: string) { state.headers[name] = value; return this; },
        status(value: number) { state.status = value; return this; },
        json(body: unknown) { state.body = body; return this; },
    } as unknown as NextApiResponse;
    handler(request, response);
    assert.equal(config.api.bodyParser, false);
    assert.equal(state.status, 503);
    assert.deepEqual(state.body, { error: 'ATLAS_PUBLIC_IMAGE_UNAVAILABLE' });
    assert.deepEqual(state.headers, { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
});
