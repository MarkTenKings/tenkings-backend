// Browser-safe names only. Trust, keys and signatures belong to the native and
// hosted verifiers, never to a browser assertion of station capabilities.
export const STATION_WIRE = Object.freeze({
  envelope: 'atlas-mac-station-signed-v1', algorithm: 'ES256-DER',
  challenge: 'atlas-mac-station-enrollment-challenge-v1', proof: 'atlas-mac-station-enrollment-proof-v1',
  enrollment: 'atlas-mac-station-enrollment-v1',
  arm: 'atlas-mac-nfc-arm-v1', result: 'atlas-mac-nfc-result-v1', removal: 'atlas-mac-nfc-removal-v1',
  acknowledgement: 'atlas-mac-nfc-ack-v1', profile: 'atlas-mac-f8215-production-v1',
  maxArmMs: 15 * 60000, maxChallengeMs: 2 * 60000,
});
