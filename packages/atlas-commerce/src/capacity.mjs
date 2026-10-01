import { requireValue } from './contract.mjs';

export const CAPACITY_VERSION = 'atlas-weekly-capacity-v1';
export const CAPACITY_TIME_ZONE = 'America/Los_Angeles';
export const CAPACITY_CHANNELS = Object.freeze(['MAIL_IN', 'DEALER_DROP_OFF']);
const localParts = new Intl.DateTimeFormat('en-US', { timeZone: CAPACITY_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const parts = value => Object.fromEntries(localParts.formatToParts(value).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
const calendarTime = p => Date.UTC(p.year, p.month - 1, p.day, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
function localMondayUtc(calendar) {
    const p = { year: calendar.getUTCFullYear(), month: calendar.getUTCMonth() + 1, day: calendar.getUTCDate(), hour: 0, minute: 1, second: 0 };
    const desired = calendarTime(p); let value = desired;
    // Monday 00:01 is unambiguous in this zone. Resolve its actual DST offset,
    // independently for each boundary; adding 168 UTC hours would be wrong.
    for (let i = 0; i < 3; i++) value += desired - calendarTime(parts(new Date(value)));
    return new Date(value).toISOString();
}
export function capacityWeek(now = new Date()) {
    requireValue(now instanceof Date && Number.isFinite(now.getTime()), 'INVALID_CAPACITY_CLOCK', 400);
    const p = parts(now), date = new Date(Date.UTC(p.year, p.month - 1, p.day));
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - daysSinceMonday - (daysSinceMonday === 0 && p.hour === 0 && p.minute === 0 ? 7 : 0));
    const next = new Date(date); next.setUTCDate(next.getUTCDate() + 7);
    return { weekStartsAt: localMondayUtc(date), resetsAt: localMondayUtc(next) };
}
export function capacityChannel(channel) {
    requireValue(['MAIL_IN', 'KIOSK', 'DEALER_DROP_OFF'].includes(channel), 'INVALID_CAPACITY_CHANNEL', 400);
    return channel === 'KIOSK' ? 'DEALER_DROP_OFF' : channel;
}
export function unconfiguredCapacity(now = new Date()) {
    return { version: CAPACITY_VERSION, unit: 'CARDS', timeZone: CAPACITY_TIME_ZONE, resetLocalTime: '00:01',
        ...capacityWeek(now), asOf: now.toISOString(), pools: CAPACITY_CHANNELS.map(channel => ({ channel, state: 'NOT_CONFIGURED',
            quotaCards: null, heldCards: null, acceptedCards: null, remainingCards: null })) };
}
/** Explicit public allowlist: no payment IDs, customer records, or guessed quota. */
export function customerCapacity(value, now = new Date()) {
    if (!value) return unconfiguredCapacity(now);
    requireValue(value.version === CAPACITY_VERSION && value.unit === 'CARDS' && value.timeZone === CAPACITY_TIME_ZONE
        && value.resetLocalTime === '00:01' && Array.isArray(value.pools) && value.pools.length === 2, 'INVALID_CAPACITY_SNAPSHOT', 503);
    requireValue(typeof value.asOf === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.asOf)
        && Number.isFinite(Date.parse(value.asOf)), 'INVALID_CAPACITY_SNAPSHOT', 503);
    const instant = new Date(value.asOf), week = capacityWeek(instant);
    requireValue(week.weekStartsAt === value.weekStartsAt && week.resetsAt === value.resetsAt, 'INVALID_CAPACITY_SNAPSHOT', 503);
    const pools = CAPACITY_CHANNELS.map(channel => {
        const matches = value.pools.filter(p => p.channel === channel);
        requireValue(matches.length === 1, 'INVALID_CAPACITY_SNAPSHOT', 503);
        const p = matches[0], counts = ['quotaCards', 'heldCards', 'acceptedCards', 'remainingCards'];
        if (p.state === 'NOT_CONFIGURED') {
            requireValue(counts.every(k => p[k] === null), 'INVALID_CAPACITY_SNAPSHOT', 503);
        } else {
            requireValue(counts.every(k => Number.isSafeInteger(p[k]) && p[k] >= 0)
                && p.heldCards + p.acceptedCards <= p.quotaCards
                && p.remainingCards === p.quotaCards - p.heldCards - p.acceptedCards
                && p.state === (p.remainingCards > 0 ? 'AVAILABLE' : 'FULL'), 'INVALID_CAPACITY_SNAPSHOT', 503);
        }
        return { channel, state: p.state, ...Object.fromEntries(counts.map(k => [k, p[k]])) };
    });
    return { version: CAPACITY_VERSION, unit: 'CARDS', timeZone: CAPACITY_TIME_ZONE, resetLocalTime: '00:01', ...week,
        asOf: instant.toISOString(), pools };
}
export function capacityBlockers(snapshot, channel, count) {
    requireValue(Number.isSafeInteger(count) && count > 0, 'CARDS_REQUIRED', 400);
    const pool = customerCapacity(snapshot).pools.find(p => p.channel === capacityChannel(channel));
    return pool.state === 'NOT_CONFIGURED' ? ['WEEKLY_CAPACITY_NOT_CONFIGURED']
        : pool.remainingCards < count ? ['WEEKLY_CAPACITY_FULL'] : [];
}
