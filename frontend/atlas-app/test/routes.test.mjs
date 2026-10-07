import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../next.config.mjs';
import { STAFF_BASE_PATH, STAFF_SIGN_IN_PATH, STAFF_GRADING_PATH, STAFF_REAUTHENTICATE_PATH, staffApiPath } from '../lib/routes.mjs';

test('staff native URLs and Next artifact use the same exact admin mount', () => {
    assert.equal(config.basePath, STAFF_BASE_PATH);
    assert.equal(STAFF_SIGN_IN_PATH, '/admin');
    assert.equal(STAFF_GRADING_PATH, '/admin/grading');
    assert.equal(STAFF_REAUTHENTICATE_PATH, '/admin?reauthenticate=1');
    assert.equal(staffApiPath('session?reauthenticate=1'), '/admin/api/staff/session?reauthenticate=1');
    assert.equal(staffApiPath('evidence/sample-001/FRONT'), '/admin/api/staff/evidence/sample-001/FRONT');
    assert.equal(staffApiPath('cards/sample-001/finishing/label'), '/admin/api/staff/cards/sample-001/finishing/label');
});
test('staff browser transport rejects unmounted, cross-origin and traversal paths', () => {
    for (const path of ['', '/session', '//customer.example/session', '../account', 'cards/../session',
        'cards/%2e%2e/session', 'session#fragment', 'session\\account', 'session\naccount', 'https://atlasgrading.com/account'])
        assert.throws(() => staffApiPath(path), { message: 'INVALID_STAFF_PATH' });
});
