import { customerIntakeRequest, customerIntakeQueue, customerIntakeReceipt } from '../../customer-intake-contract.mjs';
import { deny } from '../policy.mjs';

const SHA = /^[a-f0-9]{64}$/;
const bindingFields = ['mode', 'origin', 'deploymentId', 'releaseSha', 'configHash'];

/** A single narrow SQL gateway inside the existing human operations authority.
 * There is no customer credential, direct customer table access, provider call,
 * grade mutation or caller-supplied actor. The gateway independently rechecks
 * the session/browser, active control, operations grant and physical linkage.
 */
export class StaffCustomerIntake {
    constructor({ admin }) {
        if (typeof admin?.transaction !== 'function') deny(503, 'CUSTOMER_INTAKE_NOT_CONFIGURED');
        this.admin = admin;
    }
    async call(staff, action, input) {
        let data;
        try { data = customerIntakeRequest(action, input); }
        catch { deny(400, 'CUSTOMER_INTAKE_REQUEST_INVALID'); }
        return this.admin.transaction(staff, async context => {
            const { session, control } = context;
            if (context.actorKind !== 'HUMAN' || context.capability !== 'OPERATIONS'
                || !SHA.test(session?.tokenHash ?? '') || !SHA.test(session?.browserHash ?? '')
                || !control?.enabled || !bindingFields.every(key => typeof control[key] === 'string'))
                deny(403, 'FRESH_HUMAN_OPERATIONS_REQUIRED');
            const binding = Object.fromEntries(bindingFields.map(key => [key, control[key]]));
            const rows = await context.tx.$queryRaw`SELECT atlas_staff.customer_operations(${action}::text,
                ${session.tokenHash}::text, ${session.browserHash}::text, ${JSON.stringify(binding)}::jsonb,
                ${JSON.stringify(data)}::jsonb) AS result`;
            if (!Array.isArray(rows) || rows.length !== 1) deny(503, 'CUSTOMER_INTAKE_UNAVAILABLE');
            const value = rows[0].result;
            if (value?.error) {
                const { status, code } = value.error;
                if (!Number.isInteger(status) || ![400, 401, 403, 404, 409, 503].includes(status)
                    || typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(code)) deny(503, 'CUSTOMER_INTAKE_UNAVAILABLE');
                deny(status, code);
            }
            try {
                if (action === 'list') return customerIntakeQueue(value);
                return { receipt: customerIntakeReceipt(value, action, data) };
            } catch { deny(503, 'CUSTOMER_INTAKE_UNAVAILABLE'); }
        });
    }
    list(staff, input = { cursor: null }) { return this.call(staff, 'list', input); }
    bind(staff, input) { return this.call(staff, 'bind', input); }
    action(staff, input) { return this.call(staff, 'action', input); }
    ship(staff, input) { return this.call(staff, 'ship', input); }
}
