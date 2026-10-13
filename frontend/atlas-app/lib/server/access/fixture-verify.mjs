import { randomUUID } from 'node:crypto';

export function fixtureVerifyProvider(config) {
    const records = new Map();
    return {
        async start(phone) {
            const verificationSid = `VE${randomUUID().replaceAll('-', '')}`;
            const result = { accountSid: config.accountSid, serviceSid: config.serviceSid, verificationSid, phone, channel: 'sms', status: 'pending' };
            records.set(verificationSid, result); return { ...result };
        },
        async check(sid, code) {
            const row = records.get(sid);
            if (!row) throw new Error('FIXTURE_CODE_UNAVAILABLE');
            return { ...row, status: code === '424242' ? 'approved' : 'pending' };
        },
    };
}

