import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { workspaceOperatorSqlPort } from '../lib/server/access/workspace-operator.mjs';
import { createHandler } from '../lib/server/http.mjs';
import { isBoundaryError, LOCAL_ORIGIN } from '../lib/server/policy.mjs';
import { isNotDispatched, workspaceMessage } from '../lib/workspace-client.mjs';

function fixture(error) {
    const card = { id: randomUUID(), claimFence: 3, revision: 9 }, identity = { id: randomUUID() };
    const input = { action: 'ABANDON_AND_STEP', commandId: randomUUID(), recovery: {
        reviewHash: 'a'.repeat(64), reason: 'Retain the unconfirmed charge and continue one step.' } };
    const context = { identity, session: { tokenHash: 'b'.repeat(64) }, databaseTx: {
        async $queryRaw() { throw error; }
    } };
    const invoke = () => workspaceOperatorSqlPort.control(context, { card, ...input });
    const handler = createHandler({ origin: LOCAL_ORIGIN, assertRequest() {},
        auth: { async authenticate() { return identity; } }, workspace: { operator: { control: invoke } } });
    async function http() {
        const output = {};
        await handler({ url: `/api/staff/workspace/cards/${card.id}/control`, method: 'POST', body: input,
            headers: { origin: LOCAL_ORIGIN, 'content-type': 'application/json', 'x-atlas-csrf': 'fixture' },
            socket: { remoteAddress: '127.0.0.1' } }, {
            setHeader() {}, status(value) { output.status = value; return this; },
            json(value) { output.body = value; return this; }
        });
        return output;
    }
    return { invoke, http };
}

test('exact PostgreSQL abandonment denials reach HTTP and release only the rejected review request', async () => {
    for (const [code, status] of [
        ['ASTRA_ABANDONMENT_AUTHORITY_REQUIRED', 403], ['ASTRA_ABANDONMENT_FRESH_OPERATIONS_REQUIRED', 403],
        ['ASTRA_ABANDONMENT_NOT_AVAILABLE', 409], ['ASTRA_ABANDONMENT_REVIEW_CHANGED', 409]
    ]) for (const prefix of ['', 'ERROR: ']) {
        const error = Object.assign(new Error('Private Prisma query detail'), { code: 'P2010',
            meta: { code: 'P0001', message: `${prefix}${code}` } });
        const f = fixture(error);
        await assert.rejects(f.invoke, caught => isBoundaryError(caught) && caught.status === status
            && caught.code === code && caught.outcome === 'NOT_DISPATCHED');
        const result = await f.http();
        assert.deepEqual(result, { status, body: { error: code, outcome: 'NOT_DISPATCHED' } });
        assert(isNotDispatched({ code: result.body.error, outcome: result.body.outcome }));
        if (code.includes('FRESH_OPERATIONS')) assert.match(workspaceMessage({ code }), /Sign in again/);
    }
});

test('unconfirmed database failures stay private and retain their pending recovery request', async () => {
    const known = 'ASTRA_ABANDONMENT_FRESH_OPERATIONS_REQUIRED';
    for (const error of [new Error(known),
        Object.assign(new Error('private detail'), { meta: { code: '40001', message: known } }),
        Object.assign(new Error('private detail'), { meta: { code: 'P0001', message: `${known}: private detail` } }),
        Object.assign(new Error('private detail'), { meta: { code: 'P0001', message: 'ASTRA_ABANDONMENT_COMMAND_NOT_COMMITTED' } })
    ]) {
        const f = fixture(error);
        await assert.rejects(f.invoke, caught => caught === error);
        assert.deepEqual(await f.http(), { status: 503, body: { error: 'TEMPORARILY_UNAVAILABLE' } });
        assert.equal(isNotDispatched({ code: 'TEMPORARILY_UNAVAILABLE' }), false);
    }
});
