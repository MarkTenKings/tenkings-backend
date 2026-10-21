import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createIntakeRepository } from '../src/repository.mjs';

test('intake list binds its response to the same authenticated principal used by the owner query', async () => {
  const claimed = { id: randomUUID() }, principal = { id: randomUUID(), role: 'REVIEWER' };
  let reads = 0;
  const boundary = { transaction: async (staff, read) => {
    assert.equal(staff, claimed);
    return read({ principal, tx: { $queryRawUnsafe: async (sql, owner, cursor, limit) => {
      reads++; assert.match(sql, /WHERE owner_id=\$1::uuid/); assert.equal(owner, principal.id);
      assert.equal(cursor, null); assert.equal(limit, 31); return [];
    } } });
  } };
  const repository = createIntakeRepository({ boundary, keyPrefix: 'fixture', maxOriginalBytes: 1024 });
  assert.deepEqual(await repository.list(claimed), { staffId: principal.id, cards: [], nextCursor: null });
  assert.equal(reads, 1);
});
