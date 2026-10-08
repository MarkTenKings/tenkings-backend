const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { LinuxWaveshareSerialTransport } = require('../dist/waveshare-serial');
const { waveshareRequest } = require('../dist/waveshare-protocol');

/** Execute the actual production helper and IPC against an injected fake serial
 * module in a real Python process. This module never opens a tty or device. */
function fakeHelper(t, fault = 'none') {
  const dir = mkdtempSync(join(tmpdir(), 'vault-waveshare-ipc-'));
  const source = readFileSync(resolve(__dirname, '../scripts/waveshare_bench.py'), 'utf8');
  const modulePath = join(dir, 'fake_serial_peer.py');
  writeFileSync(modulePath, source + `
class GlobalBenchGuard:
 def __enter__(self): return self
 def __exit__(self,*args): pass
class LinuxSerialTransport:
 def __init__(self,device): self.trace=[]
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def exchange(self,request):
  if ${JSON.stringify(fault)} == "timeout": time.sleep(30)
  if ${JSON.stringify(fault)} == "exit": os._exit(2)
  if ${JSON.stringify(fault)} == "oversized": print("x"*5000,flush=True); time.sleep(30)
  if ${JSON.stringify(fault)} == "bad-crc": return bytes([1,1,4,0,0,0,0,0,0])
  if request[1]==5: return request
  if request[1]==1: payload=bytes([request[0],1,4,0,0,0,0])
  else: payload=bytes([request[0],3,2,0,request[0] if request[2]==0x40 else 100])
  return payload+crc16(payload).to_bytes(2,"little")
`);
  const original = cp.spawn; const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux' });
  let child;
  cp.spawn = (file, args, options) => {
    assert.equal(args[0], '-I'); assert.equal(args[1], '-u'); assert.equal(args[2], '-c');
    const replaced = [...args]; replaced[4] = modulePath;
    child = original(file, replaced, options); return child;
  };
  t.after(() => { cp.spawn = original; Object.defineProperty(process, 'platform', platform); rmSync(dir, { recursive: true, force: true }); });
  const serial = new LinuxWaveshareSerialTransport({ devicePath: '/dev/serial/by-id/FAKE_IPC_PEER', serialFormat: '9600/8N1', addresses: [1, 2], pythonExecutable: '/usr/bin/python3' });
  t.after(() => serial.close());
  return { serial, child: () => child };
}
test('actual Python helper process accepts only configured address and bounded commands', async t => {
  const { serial } = fakeHelper(t);
  await serial.open();
  assert.equal((await serial.exchange('address', 2)).toString('hex').slice(0, 10), '0203020002');
  assert.equal((await serial.exchange('pulse100ms', 2, 32)).toString('hex'), waveshareRequest('pulse100ms', 2, 32).toString('hex'));
  await assert.rejects(serial.exchange('coils', 3), /UNCONFIGURED/);
  await assert.rejects(serial.exchange('on', 1, 1), /COMMAND_BLOCKED/);
  const response = await serial.exchange('coils', 1); assert.equal(response.length, 9);
});
for (const fault of ['timeout', 'exit', 'oversized', 'bad-crc']) test(`helper ${fault} is terminal, bounded and reaped before return`, async t => {
  const { serial, child } = fakeHelper(t, fault); await serial.open();
  const started = performance.now();
  await assert.rejects(serial.exchange('coils', 1));
  assert.ok(performance.now() - started < 4000);
  assert.ok(child().exitCode !== null || child().signalCode !== null, 'Child termination must be observed');
  await assert.rejects(serial.exchange('coils', 1), /UNAVAILABLE/);
});
