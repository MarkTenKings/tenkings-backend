import { configureStationBrowserClient } from '@atlas/finishing-station/browser';
import { manualRequest } from './manual-client.mjs';
export function stationClient(csrf) {
  return configureStationBrowserClient({ storage: window.sessionStorage,
    request: (path, options = {}) => manualRequest(path, { ...options, csrf }) });
}
