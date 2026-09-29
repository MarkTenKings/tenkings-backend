import { reportFindingEntries, reportFindingMask, reportTraceSpans } from './report-review-ui.mjs';

/** Presentation only. Frozen independently of grading and the historical marketing fingerprint.
 * Native occupied pixel CENTERS, separable exact squared Euclidean transform (earlier center
 * wins an exact tie), Float64 intermediates / Float32 stored field, bilinear display samples.
 * Fixed orientation; no record ID, grade, identity, randomness or neighboring side in the art.
 * The native squared integer distances fit exactly in Float32. Contours use 24px spacing.
 */
export const FINGERPRINT_VERSION = 'atlas-mask-tide-pixel-centers-v1';
export const FINGERPRINT_GOLD = Object.freeze([205, 169, 85]);
export const FINGERPRINT_SIZE = Object.freeze({ width: 1270, height: 1778 });
export const FINGERPRINT_MAX_WIDTH = 480;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Union spans, not findings: order, IDs, duplication and splitting cannot change the field. */
export function fingerprintSource(findings, side) {
  const included = reportFindingEntries(findings).filter(entry => entry.finding.side === side);
  const spans = []; let unavailable = 0;
  for (const { finding } of included) {
    const mask = reportFindingMask(finding);
    if (!mask) { unavailable++; continue; }
    try { spans.push(...reportTraceSpans(mask)); } catch { unavailable++; }
  }
  const union = fingerprintUnionSpans(spans);
  return { side, count: included.length, unavailable, spans: union,
    key: `${FINGERPRINT_VERSION}:${side}:${JSON.stringify(union)}` };
}

export function fingerprintUnionSpans(spans, width = 1270, height = 1778) {
  const ordered = spans.map(({ x, y, width: length }) => {
    if (![x, y, length].every(Number.isInteger) || x < 0 || y < 0 || length < 1 || x + length > width || y >= height) throw new Error('Invalid fingerprint source span');
    return { x, y, width: length };
  }).sort((a, b) => a.y - b.y || a.x - b.x || a.width - b.width);
  const union = [];
  for (const span of ordered) {
    const previous = union.at(-1);
    if (previous && previous.y === span.y && span.x <= previous.x + previous.width) previous.width = Math.max(previous.x + previous.width, span.x + span.width) - previous.x;
    else union.push(span);
  }
  return union;
}

function lineDistance(f, n, out, v, z) {
  let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) ** 2 + f[v[k]]; }
}

/** One native lane per yield. A single 9MB field per side, never allocated in animation. */
export function* fingerprintFieldSteps(spans, width = 1270, height = 1778) {
  if (!spans.length) return null;
  const dist = new Float32Array(width * height); dist.fill(1e12);
  for (const span of spans) { dist.fill(0, span.y * width + span.x, span.y * width + span.x + span.width); yield; }
  const n = Math.max(width, height), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = dist[y * width + x];
    lineDistance(f, height, d, v, z);
    for (let y = 0; y < height; y++) dist[y * width + x] = d[y];
    yield;
  }
  let max = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = dist[y * width + x];
    lineDistance(f, width, d, v, z);
    for (let x = 0; x < width; x++) { const value = Math.sqrt(d[x]); dist[y * width + x] = value; max = Math.max(max, value); }
    yield;
  }
  return { dist, max, width, height };
}

export function* fingerprintSampleSteps(field, width, height) {
  const samples = new Float32Array(width * height), W = field.width, H = field.height;
  for (let y = 0; y < height; y++) {
    const gy = clamp((y + .5) / height * H - .5, 0, H - 1), y0 = Math.floor(gy), y1 = Math.min(H - 1, y0 + 1), fy = gy - y0;
    for (let x = 0; x < width; x++) {
      const gx = clamp((x + .5) / width * W - .5, 0, W - 1), x0 = Math.floor(gx), x1 = Math.min(W - 1, x0 + 1), fx = gx - x0;
      samples[y * width + x] = (field.dist[y0 * W + x0] * (1 - fx) + field.dist[y0 * W + x1] * fx) * (1 - fy)
        + (field.dist[y1 * W + x0] * (1 - fx) + field.dist[y1 * W + x1] * fx) * fy;
    }
    yield;
  }
  return { samples, width, height, max: field.max };
}

/** Bounded cooperative work; cancellation removes the next task and drops its iterator. */
export function scheduleFingerprint(iterator, { signal, schedule = setTimeout, unschedule = clearTimeout, now = () => performance.now() } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const finish = (error, value) => { unschedule(timer); signal?.removeEventListener('abort', abort); iterator.return?.(); error ? reject(error) : resolve(value); };
    const abort = () => { const error = new Error('Fingerprint cancelled'); error.name = 'AbortError'; finish(error); };
    const step = () => {
      if (signal?.aborted) { abort(); return; }
      try {
        const started = now(); let result, lanes = 0;
        do { result = iterator.next(); lanes++; } while (!result.done && lanes < 16 && now() - started < 4);
        if (result.done) finish(null, result.value); else timer = schedule(step, 0);
      } catch (error) { finish(error); }
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true }); timer = schedule(step, 0);
  });
}

/** Writes into one reused ImageData. Gold RGB is fixed; only opacity changes. */
export function paintFingerprintPixels(pixels, sampled, amount) {
  const value = clamp(amount, 0, 1), period = 24 * Math.max(value, .035), extent = sampled.max * value;
  const edge = 1270 / sampled.width, half = edge * .65;
  for (let i = 0; i < sampled.samples.length; i++) {
    const distance = sampled.samples[i], j = i * 4;
    pixels[j] = 205; pixels[j + 1] = 169; pixels[j + 2] = 85;
    if (value <= .003 || distance < .8 || distance > extent) { pixels[j + 3] = 0; continue; }
    const nearest = Math.abs(distance - Math.round(distance / period) * period);
    pixels[j + 3] = Math.round(clamp((half + edge - nearest) / edge, 0, 1) * clamp((extent - distance) / (edge * 3), 0, 1) * Math.min(1, value * 3) * .82 * 255);
  }
}

/** Interruptible finite tide; zero timers/frames survive cancel or reduced-motion state. */
export function animateFingerprint({ from = 0, target = 1, duration = 1700, reducedMotion = false, paint, complete,
  request = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame }) {
  let frame, stopped = false, started, lastPaint = -Infinity;
  const stop = () => { stopped = true; if (frame != null) cancel?.(frame); };
  if (reducedMotion || typeof request !== 'function') { paint(target); complete?.(); return stop; }
  const tick = time => {
    if (stopped) return;
    started ??= time;
    const progress = Math.min(1, (time - started) / duration);
    if (time - lastPaint >= 32 || progress === 1) { paint(from + (target - from) * progress * progress * (3 - 2 * progress)); lastPaint = time; }
    if (progress < 1) frame = request(tick); else { frame = null; complete?.(); }
  };
  frame = request(tick); return stop;
}
