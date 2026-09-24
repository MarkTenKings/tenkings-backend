import { requireThat } from './contract.mjs';

/** Customer reads always traverse the existing sole session gateway. Private
 * worker writes use a separately granted function, never a staff principal. */
export function createCustomerIntakeRepository({ customerCall, workerCall }) {
  requireThat(typeof customerCall === 'function' && typeof workerCall === 'function', 500, 'INTAKE_CONFIGURATION_REQUIRED');
  return Object.freeze({
    upload: (authority, input) => customerCall('intake_upload', authority, input),
    verify: (authority, input) => workerCall('verify', { authority, ...input }),
    claim: () => workerCall('claim', {}),
    prepared: input => workerCall('prepared', input),
    dispatch: input => workerCall('dispatch', input),
    response: input => workerCall('response', input),
    finish: input => workerCall('finish', input),
    fail: input => workerCall('fail', input),
  });
}
