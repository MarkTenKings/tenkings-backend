const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LinuxWaveshareSerialTransport } = require("../dist/waveshare-serial");
const { WaveshareControllerAdapter, waveshareBindingDigest } = require("../dist/waveshare-controller");
const { WaveshareCommandJournal } = require("../dist/waveshare-journal");

test("independent review: observed idle helper death invalidates OFF/readiness and persists halt", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-idle-helper-review-"));
  const fake = path.join(dir, "fake-peer.py");
  // Run the real child helper and actual IPC. Only the imported serial class and
  // guard are replaced; this test never opens a real serial or hardware device.
  fs.writeFileSync(fake, fs.readFileSync(path.resolve(__dirname, "../scripts/waveshare_bench.py"), "utf8") + `
class GlobalBenchGuard:
 def __enter__(self): return self
 def __exit__(self,*args): pass
class LinuxSerialTransport:
 def __init__(self,device): self.trace=[]
 def __enter__(self): return self
 def __exit__(self,*args): pass
 def exchange(self,r):
  if r[1]==1: p=bytes([r[0],1,4,0,0,0,0])
  elif r[1]==3: p=bytes([r[0],3,2,0,r[0] if r[2]==0x40 else 100])
  else: raise BenchError("REVIEW_OUTPUT_FORBIDDEN","no pulses in idle test")
  return p+crc16(p).to_bytes(2,'little')
`);
  const spawn = cp.spawn; const platform = Object.getOwnPropertyDescriptor(process, "platform"); let child;
  Object.defineProperty(process, "platform", { value: "linux" });
  cp.spawn = (file, args, options) => { const replacement = [...args]; replacement[4] = fake; return child = spawn(file, replacement, options); };
  const config = { adapterId: "waveshare-modbus-rtu-relay-32ch-v2", mode: "OFFICIAL_TEST", devicePath: "/dev/serial/by-id/REVIEW_FAKE",
    serialFormat: "9600/8N1", endpoints: [{ endpointId: "board", address: 1, expectedFirmwareRegister: 100 }],
    mapping: [{ doorId: "door", controllerEndpointId: "board", controllerChannel: 1 }], mappingVersion: "v1", profileDigest: "a".repeat(64),
    pulseMs: 100, offSettleMs: 300, minimumOffMs: 100, qualificationEvidenceDigest: "b".repeat(64) };
  const database = path.join(dir, "controller.sqlite"); const binding = waveshareBindingDigest(config);
  const journal = new WaveshareCommandJournal(database, binding);
  const transport = new LinuxWaveshareSerialTransport({ devicePath: config.devicePath, serialFormat: "9600/8N1", addresses: [1], pythonExecutable: "/usr/bin/python3" });
  const controller = new WaveshareControllerAdapter(config, transport, journal);
  try {
    await controller.initializeReadOnly(); assert.equal((await controller.identity()).ready, true);
    const exited = new Promise(resolve => child.once("close", resolve)); child.kill("SIGKILL"); await exited;
    assert.equal(child.signalCode, "SIGKILL");
    const identity = await controller.identity();
    assert.equal(identity.ready, false); assert.equal(identity.outputState, "UNCERTAIN");
    assert.equal(journal.state().halted, true); assert.equal(journal.state().reason, "WAVESHARE_TRANSPORT_LOST_WHILE_IDLE");
    await controller.close();
    const reopened = new WaveshareCommandJournal(database, binding);
    try { assert.equal(reopened.state().halted, true); } finally { reopened.close(); }
  } finally {
    await controller.close(); cp.spawn = spawn; Object.defineProperty(process, "platform", platform); fs.rmSync(dir, { recursive: true, force: true });
  }
});
