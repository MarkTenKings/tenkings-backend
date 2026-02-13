type Task = {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

class AsyncQueue {
  private active = 0;
  private readonly limit: number;
  private readonly queue: Task[] = [];

  constructor(limit: number) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) {
      return this.execute(fn);
    }
    return new Promise<T>((resolve, reject) => {
      const task: Task = {
        run: fn as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      this.queue.push(task);
    });
  }

  private async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.drain();
    }
  }

  private drain() {
    while (this.active < this.limit && this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) {
        return;
      }
      this.execute(next.run)
        .then(next.resolve)
        .catch(next.reject);
    }
  }
}

const ocrConcurrency = Number(process.env.OCR_SUGGEST_CONCURRENCY ?? "5");
const photoroomConcurrency = Number(process.env.PHOTOROOM_CONCURRENCY ?? "1");

export const ocrSuggestQueue = new AsyncQueue(
  Number.isFinite(ocrConcurrency) && ocrConcurrency > 0 ? ocrConcurrency : 5
);

export const photoroomQueue = new AsyncQueue(
  Number.isFinite(photoroomConcurrency) && photoroomConcurrency > 0 ? photoroomConcurrency : 1
);
