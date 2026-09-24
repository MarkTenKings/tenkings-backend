import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMac, inspectionCli, parseSigningIdentities, parseUsbReaders } from '../scripts/inspect-mac.mjs';

const sha1 = 'A'.repeat(40), teamId = 'ABCDE12345';
const fixedTime = () => new Date('2026-09-24T06:00:00.000Z');
function fixture(overrides = {}) {
  const calls = [];
  const responses = {
    '/usr/bin/sw_vers': '15.5\n',
    '/usr/bin/security': ` 1) ${sha1} "Developer ID Application: Private Person (${teamId})"\n 1 valid identities found\n`,
    '/usr/bin/xcrun': '/Library/Developer/CommandLineTools/usr/bin/tool\n',
    '/usr/bin/lpstat': 'printer EPSON_ET_2980_Series is idle. enabled since yesterday\n',
    '/usr/sbin/system_profiler': JSON.stringify({ SPUSBDataType: [{ _name: 'USB host', _items: [{
      _name: 'ACR1552U-M1', manufacturer: 'ACS', vendor_id: '0x072f (ACS)', product_id: '0x1234',
      bcd_device: '1.04', serial_num: 'DO_NOT_LOG', location_id: 'DO_NOT_LOG',
    }] }] }), ...overrides,
  };
  return { calls, options: { platform: 'darwin', architecture: 'arm64', nodeVersion: '20.20.1', now: fixedTime,
    execute(command, args) { calls.push([command, args]); const result = responses[command];
      return typeof result === 'string' ? { status: 0, stdout: result } : result; } } };
}
test('observation uses only fixed read-only commands, strips private data, and cannot declare production ready', () => {
  const f = fixture(), result = inspectionCli([], f.options);
  assert.deepEqual(f.calls, [
    ['/usr/bin/sw_vers', ['-productVersion']],
    ['/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']],
    ['/usr/bin/xcrun', ['--find', 'notarytool']], ['/usr/bin/xcrun', ['--find', 'stapler']],
    ['/usr/bin/lpstat', ['-p']],
    ['/usr/sbin/system_profiler', ['SPUSBDataType', '-json', '-detailLevel', 'mini', '-timeout', '10']],
  ]);
  assert.equal(result.productionReady, false); assert.equal(result.rfCommandsSent, 0);
  assert.equal(result.usb.readers[0].subtypeConfirmed, false);
  assert.equal(result.usb.readers[0].firmwareQueried, false);
  assert.equal(result.printers.selectedProductionQueue, null);
  assert.deepEqual(result.signing.developerIdApplications, [{ certificateSha1: sha1, teamId }]);
  assert.doesNotMatch(JSON.stringify(result), /Private Person|DO_NOT_LOG/);
});
test('empty successful evidence stays distinct from failed or malformed inspection', () => {
  const f = fixture({ '/usr/bin/security': ' 0 valid identities found\n',
    '/usr/sbin/system_profiler': '{"SPUSBDataType":[]}', '/usr/bin/lpstat': '' });
  const result = inspectMac(f.options);
  assert.equal(result.signing.validIdentityCount, 0); assert.equal(result.usb.matchingDeviceCount, 0);
  assert.deepEqual(result.printers.queues, []);
  for (const bad of [{ status: 1, stdout: 'SECRET' }, { status: null, stdout: '', error: 'ETIMEDOUT' },
    { status: 0, stdout: 'invalid SECRET' }]) {
    const failed = inspectMac(fixture({ '/usr/bin/security': bad }).options);
    assert.equal(failed.signing.status, 'UNKNOWN'); assert.equal(failed.signing.validIdentityCount, undefined);
    assert.doesNotMatch(JSON.stringify(failed), /SECRET/);
  }
});
test('only exact Developer ID Application selectors qualify and inconsistent identity output is unknown', () => {
  assert.deepEqual(parseSigningIdentities(`1) ${sha1} "Apple Development: Person (${teamId})"\n1 valid identities found`).developerIdApplications, []);
  assert.throws(() => parseSigningIdentities(`1) ${sha1} "Developer ID Application: Person (${teamId})"\n0 valid identities found`));
  assert.throws(() => parseSigningIdentities('')); assert.throws(() => parseSigningIdentities('0 valid identities found\nextra'));
});
test('USB descriptor claims and other vendors never qualify reader firmware or expose serials', () => {
  const result = parseUsbReaders(JSON.stringify({ SPUSBDataType: [{ _name: 'Other device', serial_num: 'secret' }] }));
  assert.deepEqual(result, { matchingDeviceCount: 0, readers: [] });
  assert.throws(() => parseUsbReaders('{}')); assert.throws(() => parseUsbReaders('{"SPUSBDataType":[{"_items":null}]}'));
});
test('unexpected CLI arguments and other platforms cause zero commands', () => {
  const f = fixture();
  for (const args of [['--print'], ['--identity', sha1], ['--firmware'], ['--output', '/tmp/result']])
    assert.throws(() => inspectionCli(args, f.options), /NO_ARGUMENTS/);
  assert.throws(() => inspectMac({ ...f.options, platform: 'linux' }), /DARWIN/);
  assert.equal(f.calls.length, 0);
});
