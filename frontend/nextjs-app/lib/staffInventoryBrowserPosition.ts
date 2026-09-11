import type { StaffLocationFix } from './staffInventoryGeolocation';

type PositionReader = Pick<Geolocation, 'watchPosition' | 'clearWatch' | 'getCurrentPosition'>;
type Options = {
  signal: AbortSignal;
  geolocation?: PositionReader;
  onProgress?: (message: string) => void;
  timeoutMs?: number;
  now?: () => number;
};

/** A permission grant starts acquisition; the first reading can still be coarse. */
export function readStaffInventoryPosition({ signal, geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation, onProgress, timeoutMs = 12000, now = Date.now }: Options): Promise<StaffLocationFix> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Location cancelled', 'AbortError')); return; }
    if (!geolocation) { reject(new Error('Location is unavailable')); return; }
    let watch: number | undefined, best: StaffLocationFix | undefined, settled = false;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); if (watch !== undefined) geolocation.clearWatch(watch); };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true; cleanup();
      if (error) reject(error); else if (best) resolve(best); else reject(Object.assign(new Error('Location timed out'), { code: 3 }));
    };
    const cancel = () => finish(new DOMException('Location cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(), timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    const received: PositionCallback = position => {
      if (settled || signal.aborted) return;
      const fix = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp };
      if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90 || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180 || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || !Number.isFinite(fix.timestamp) || now() - fix.timestamp > 300000 || fix.timestamp - now() > 30000) return;
      if (!best || fix.accuracy < best.accuracy) best = fix;
      onProgress?.(`Location received (about ${Math.ceil(best.accuracy)} m accuracy). ${best.accuracy <= 50 ? 'Checking nearby locations…' : 'Improving the signal…'}`);
      if (best.accuracy <= 50) finish();
    };
    const failed: PositionErrorCallback = error => { if (error.code === 1 || !best) finish(error); else finish(); };
    try {
      const options = { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 };
      if (typeof geolocation.watchPosition === 'function') {
        watch = geolocation.watchPosition(received, failed, options);
        // Test doubles and some adapters can invoke their callback synchronously.
        if (settled) geolocation.clearWatch(watch);
      } else geolocation.getCurrentPosition(received, failed, options);
    } catch (error) { finish(error); }
  });
}
