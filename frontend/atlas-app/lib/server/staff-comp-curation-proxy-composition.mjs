// Compatibility exports for owned integration fixtures. Serving web code must
// import the frontend-only module so its bundle never traces the native writer.
export { createStaffCompCurationProxyComposition } from './staff-comp-curation-frontend-proxy.mjs';
export { createStaffCompCurationPrivateAdapter } from './staff-comp-curation-private-adapter.mjs';
