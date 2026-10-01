import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityWeek, capacityChannel, customerCapacity, unconfiguredCapacity, capacityBlockers } from '../src/capacity.mjs';
import { CommerceService } from '../src/service.mjs';
import { source, memoryRepository, now } from './fixtures.mjs';

test('Monday 00:01 Los Angeles reset handles exact boundary and both DST changes', () => {
    assert.deepEqual(capacityWeek(new Date('2026-10-05T07:00:59.999Z')), { weekStartsAt:'2026-09-28T07:01:00.000Z', resetsAt:'2026-10-05T07:01:00.000Z' });
    assert.deepEqual(capacityWeek(new Date('2026-10-05T07:01:00.000Z')), { weekStartsAt:'2026-10-05T07:01:00.000Z', resetsAt:'2026-10-12T07:01:00.000Z' });
    assert.deepEqual(capacityWeek(new Date('2026-03-06T20:00:00Z')), { weekStartsAt:'2026-03-02T08:01:00.000Z', resetsAt:'2026-03-09T07:01:00.000Z' });
    assert.deepEqual(capacityWeek(new Date('2026-10-30T20:00:00Z')), { weekStartsAt:'2026-10-26T07:01:00.000Z', resetsAt:'2026-11-02T08:01:00.000Z' });
    assert.throws(() => capacityWeek(new Date(NaN)), {code:'INVALID_CAPACITY_CLOCK'});
});
test('no configured quota means null, never 500/1000 or a fabricated countdown', () => {
    const value = unconfiguredCapacity(now);
    assert.equal(value.unit, 'CARDS');
    for (const p of value.pools) assert.deepEqual(p, {channel:p.channel,state:'NOT_CONFIGURED',quotaCards:null,heldCards:null,acceptedCards:null,remainingCards:null});
    assert.deepEqual(capacityBlockers(value, 'KIOSK', 20), ['WEEKLY_CAPACITY_NOT_CONFIGURED']);
    assert.equal(capacityChannel('KIOSK'), 'DEALER_DROP_OFF');
});
test('card-count admission keeps pools independent, strips private fields, rejects inconsistent counts', () => {
    const input = unconfiguredCapacity(now);
    input.privatePaymentId='secret';
    input.pools[0] = {channel:'MAIL_IN',state:'AVAILABLE',quotaCards:50,heldCards:15,acceptedCards:15,remainingCards:20,customer:'private'};
    const safe = customerCapacity(input);
    assert.equal(safe.privatePaymentId, undefined); assert.equal(safe.pools[0].customer, undefined);
    assert.deepEqual(capacityBlockers(safe,'MAIL_IN',20), []);
    assert.deepEqual(capacityBlockers(safe,'MAIL_IN',21), ['WEEKLY_CAPACITY_FULL']);
    assert.deepEqual(capacityBlockers(safe,'DEALER_DROP_OFF',1), ['WEEKLY_CAPACITY_NOT_CONFIGURED']);
    input.pools[0].remainingCards=21;
    assert.throws(() => customerCapacity(input), {code:'INVALID_CAPACITY_SNAPSHOT'});
});
test('checkout exposes capacity without making a hold or requiring identification as a customer step', async () => {
    const checkout = source('KIOSK',20), repository = memoryRepository(checkout);
    const s = new CommerceService({repository,clock:()=>now});
    const result = await s.checkout(checkout.draftId);
    assert.equal(repository.attempts.size, 0);
    assert.equal(result.cards.length,20);
    assert(result.blockers.includes('WEEKLY_CAPACITY_NOT_CONFIGURED'));
    assert.equal(result.capacity.pools[1].state, 'NOT_CONFIGURED');
});
