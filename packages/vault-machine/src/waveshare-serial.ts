import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { WaveshareError, waveshareRequest, waveshareResponse, type WaveshareAction } from "./waveshare-protocol";

export interface WaveshareTransport {
  readonly kind: "REAL_LINUX_SERIAL" | "FAKE_SERIAL_PEER";
  readonly configuredDevicePath?: string;
  readonly configuredAddresses?: readonly number[];
  readonly healthy?: boolean;
  open(): Promise<void>;
  exchange(action: WaveshareAction, address: number, channel?: number): Promise<Buffer>;
  close(): Promise<void>;
}
export interface WaveshareSerialOptions {
  devicePath: string;
  serialFormat: "9600/8N1";
  addresses: number[];
  pythonExecutable?: string;
}

/** Reuses the preserved, separately tested September 11 bench serial implementation.
 * Its host-wide flock is held for this child's whole lifetime, excluding bench CLI
 * operations across all ports. Nothing reads/writes/resets one-shot bench evidence. */
const HELPER = String.raw`
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location("vault_waveshare_bench",sys.argv[1])
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
device=sys.argv[2];addresses=set(json.loads(sys.argv[3]))
def emit(value):
 print(json.dumps(value,separators=(",",":")),flush=True)
try:
 with b.GlobalBenchGuard(), b.LinuxSerialTransport(device) as transport:
  emit({"id":0,"ready":True})
  while True:
   line=sys.stdin.buffer.readline(1025)
   if not line: break
   if len(line)>1024 or not line.endswith(b"\n"): raise b.BenchError("HELPER_REQUEST_INVALID","request bound")
   request=json.loads(line)
   if type(request) is not dict or set(request) not in ({"id","action","address"},{"id","action","address","channel"}): raise b.BenchError("HELPER_REQUEST_INVALID","request shape")
   b.integer(request["id"],1,2147483647,"id")
   address=b.integer(request["address"],1,247,"address")
   if address not in addresses: raise b.BenchError("HELPER_ADDRESS_BLOCKED","address")
   action=request["action"]
   if action not in ("address","firmware","coils","pulse100ms"): raise b.BenchError("HELPER_ACTION_BLOCKED","action")
   frame=b.request_for("pulse-unloaded" if action=="pulse100ms" else action,address,request.get("channel"))
   response=transport.exchange(frame)
   b.response_for(frame,response)
   transport.trace.clear()
   emit({"id":request["id"],"responseHex":response.hex()})
except BaseException as error:
 emit({"errorCode":error.code if isinstance(error,b.BenchError) else "HELPER_IO_FAILED"})
 sys.exit(2)
`;

export class LinuxWaveshareSerialTransport implements WaveshareTransport {
  readonly kind = "REAL_LINUX_SERIAL" as const;
  private child: ChildProcessWithoutNullStreams | null = null;
  private closed: Promise<void> = Promise.resolve();
  private pending: { id: number; resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | null = null;
  private buffer = "";
  private sequence = 0;
  private failed = false;
  private opened = false;
  private readonly options: WaveshareSerialOptions;
  get configuredDevicePath(): string { return this.options.devicePath; }
  get configuredAddresses(): readonly number[] { return [...this.options.addresses]; }
  get healthy(): boolean { return this.opened && !this.failed && this.child !== null; }
  constructor(options: WaveshareSerialOptions) {
    if (!/^\/dev\/serial\/by-id\/[^/\u0000-\u0020]{1,240}$/.test(options.devicePath) || options.serialFormat !== "9600/8N1"
      || !Array.isArray(options.addresses) || options.addresses.length < 1 || options.addresses.length > 8
      || new Set(options.addresses).size !== options.addresses.length || options.addresses.some(address => !Number.isInteger(address) || address < 1 || address > 247)
      || (options.pythonExecutable !== undefined && !options.pythonExecutable.startsWith("/"))) throw new WaveshareError("WAVESHARE_SERIAL_CONFIG_INVALID");
    this.options = { ...options, addresses: [...options.addresses] };
  }
  async open(): Promise<void> {
    if (this.opened && !this.failed) return;
    if (this.child) throw new WaveshareError("WAVESHARE_HELPER_BUSY");
    if (process.platform !== "linux") throw new WaveshareError("WAVESHARE_LINUX_REQUIRED");
    this.failed = false; this.buffer = ""; this.sequence = 0;
    const ready = this.awaitResponse(0, 3000);
    const child = spawn(this.options.pythonExecutable ?? "/usr/bin/python3", ["-I", "-u", "-c", HELPER,
      resolve(__dirname, "../scripts/waveshare_bench.py"), this.options.devicePath, JSON.stringify(this.options.addresses)], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.closed = new Promise(resolveClose => child.once("close", () => { this.opened = false; this.child = null; this.fail("WAVESHARE_HELPER_EXITED"); resolveClose(); }));
    child.stdout.on("data", (bytes: Buffer) => this.receive(bytes));
    // Error text may contain OS paths/identifiers. Only fixed safe codes cross this boundary.
    child.stderr.on("data", () => {});
    child.on("error", () => this.fail("WAVESHARE_HELPER_START_FAILED"));
    child.stdin.on("error", () => this.fail("WAVESHARE_HELPER_PIPE_FAILED"));
    try {
      const result = await ready;
      if (result.ready !== true) throw new WaveshareError("WAVESHARE_HELPER_NOT_READY");
      this.opened = true;
    } catch (error) { await this.close(); throw error; }
  }
  async exchange(action: WaveshareAction, address: number, channel?: number): Promise<Buffer> {
    const request = waveshareRequest(action, address, channel);
    if (!this.options.addresses.includes(address)) throw new WaveshareError("WAVESHARE_ADDRESS_UNCONFIGURED");
    if (!this.child || !this.opened || this.failed || this.pending) throw new WaveshareError("WAVESHARE_TRANSPORT_UNAVAILABLE");
    const id = ++this.sequence;
    const response = this.awaitResponse(id, 2000);
    this.child.stdin.write(JSON.stringify({ id, action, address, ...(channel === undefined ? {} : { channel }) }) + "\n");
    try {
      const result = await response;
      if (typeof result.responseHex !== "string" || !/^(?:[0-9a-f]{2}){5,9}$/.test(result.responseHex)) throw new WaveshareError("WAVESHARE_HELPER_RESPONSE_INVALID");
      const frame = Buffer.from(result.responseHex, "hex"); waveshareResponse(request, frame); return frame;
    } catch (error) { this.failed = true; await this.close(); throw error; }
  }
  async close(): Promise<void> {
    this.fail("WAVESHARE_TRANSPORT_CLOSED");
    const child = this.child;
    if (!child) return;
    child.kill("SIGKILL");
    // Closing is part of the operation barrier: never report termination merely
    // because kill() returned true. Failure leaves the adapter latched.
    let timer: NodeJS.Timeout | undefined;
    try { await Promise.race([this.closed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new WaveshareError("WAVESHARE_HELPER_STOP_UNCERTAIN")), 2000); })]); }
    finally { if (timer) clearTimeout(timer); }
  }
  private awaitResponse(id: number, timeout: number): Promise<Record<string, unknown>> {
    if (this.pending) return Promise.reject(new WaveshareError("WAVESHARE_HELPER_BUSY"));
    return new Promise((resolveResponse, reject) => {
      this.pending = { id, resolve: resolveResponse, reject, timer: setTimeout(() => this.fail("WAVESHARE_HELPER_TIMEOUT"), timeout) };
    });
  }
  private receive(bytes: Buffer): void {
    if (this.failed) return;
    this.buffer += bytes.toString("utf8");
    if (this.buffer.length > 4096) { this.fail("WAVESHARE_HELPER_OUTPUT_LIMIT"); return; }
    const newline = this.buffer.indexOf("\n");
    if (newline < 0) return;
    const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (!this.pending || this.buffer.length || value.id !== this.pending.id || value.errorCode || !value || Array.isArray(value)) throw new Error();
      const pending = this.pending; this.pending = null; clearTimeout(pending.timer); pending.resolve(value);
    } catch { this.fail("WAVESHARE_HELPER_PROTOCOL_FAILED"); }
  }
  private fail(code: string): void {
    this.failed = true; this.opened = false;
    if (this.pending) { const pending = this.pending; this.pending = null; clearTimeout(pending.timer); pending.reject(new WaveshareError(code)); }
    this.child?.kill("SIGKILL");
  }
}
