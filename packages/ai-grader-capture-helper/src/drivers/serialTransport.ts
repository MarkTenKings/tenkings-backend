export interface SerialLineOpenOptions {
  port: string;
  baudRate: number;
  openTimeoutMs: number;
}

export interface SerialLineConnection {
  writeLine(line: string): Promise<void>;
  writeRaw?(data: string): Promise<void>;
  readLine(): Promise<string>;
  close(): Promise<void>;
}

export interface SerialLineTransport {
  open(options: SerialLineOpenOptions): Promise<SerialLineConnection>;
}

export class SerialLineTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SerialLineTransportError";
  }
}

export async function createNodeSerialLineTransport(deviceLabel: string): Promise<SerialLineTransport> {
  let serialportModule: { SerialPort: new (options: Record<string, unknown>) => unknown };
  try {
    serialportModule = await import("serialport") as unknown as {
      SerialPort: new (options: Record<string, unknown>) => unknown;
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown serialport import error.";
    throw new SerialLineTransportError(`Unable to load serialport for ${deviceLabel} readiness: ${message}`);
  }

  return {
    async open(options) {
      const serialPort = new serialportModule.SerialPort({
        path: options.port,
        baudRate: options.baudRate,
        autoOpen: false,
      }) as NodeSerialPortLike;

      await new Promise<void>((resolve, reject) => {
        serialPort.open((error?: Error | null) => {
          if (error) {
            reject(
              new SerialLineTransportError(
                `Unable to open ${deviceLabel} serial port ${options.port}: ${error.message}`
              )
            );
            return;
          }
          resolve();
        });
      });

      return new NodeSerialLineConnection(serialPort);
    },
  };
}

interface NodeSerialPortLike {
  open(callback: (error?: Error | null) => void): void;
  write(data: string, callback: (error?: Error | null) => void): void;
  drain(callback: (error?: Error | null) => void): void;
  close(callback: (error?: Error | null) => void): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

class NodeSerialLineConnection implements SerialLineConnection {
  private buffer = "";
  private readonly pendingReads: Array<{
    resolve: (line: string) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(private readonly serialPort: NodeSerialPortLike) {
    this.serialPort.on("data", (chunk) => this.handleData(chunk));
    this.serialPort.on("error", (error) => this.rejectPending(error));
  }

  async writeRaw(data: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.serialPort.write(data, (writeError?: Error | null) => {
        if (writeError) {
          reject(writeError);
          return;
        }
        this.serialPort.drain((drainError?: Error | null) => {
          if (drainError) reject(drainError);
          else resolve();
        });
      });
    });
  }

  async writeLine(line: string): Promise<void> {
    const payload = line.endsWith("\n") ? line : `${line}\n`;
    await this.writeRaw(payload);
  }

  async readLine(): Promise<string> {
    const existing = this.shiftLine();
    if (existing) return existing;

    return await new Promise<string>((resolve, reject) => {
      this.pendingReads.push({ resolve, reject });
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.serialPort.close((error?: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  private handleData(chunk: Buffer | string): void {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : chunk;
    this.drainPendingReads();
  }

  private drainPendingReads(): void {
    while (this.pendingReads.length > 0) {
      const line = this.shiftLine();
      if (!line) return;
      const pending = this.pendingReads.shift();
      pending?.resolve(line);
    }
  }

  private shiftLine(): string | undefined {
    while (true) {
      const newlineIndex = this.buffer.search(/[\r\n]/);
      if (newlineIndex < 0) return undefined;
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) return line;
    }
  }

  private rejectPending(error: Error): void {
    while (this.pendingReads.length > 0) {
      const pending = this.pendingReads.shift();
      pending?.reject(error);
    }
  }
}
