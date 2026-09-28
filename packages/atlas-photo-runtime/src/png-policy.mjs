// These settings are fingerprinted by the emitted v2 raster/working policies.
// Deflate effort changes byte size and CPU cost, never pixel values or metadata.
// Do not change them without a new treatment policy and real decoder equality tests.
export const LOSSLESS_PNG = Object.freeze({ compressionLevel: 1, adaptiveFiltering: false, palette: false });
export const IDENTITY_WORKING_POLICY = 'atlas-sdr-working-srgb8-identity-v3';
export const OPAQUE_ALPHA_WORKING_POLICY = 'atlas-sdr-working-srgb8-opaque-alpha-v4';
export const IDENTITY_SOURCE_POLICIES = Object.freeze(['atlas-native-raster-srgb-v1', 'atlas-native-raster-srgb-v2',
  'atlas-jpeg-apple-exif-srgb-base-v1', 'atlas-jpeg-apple-exif-srgb-base-v2',
  'atlas-jpeg-apple-sdr-base-srgb-v1', 'atlas-jpeg-apple-sdr-base-srgb-v2']);
