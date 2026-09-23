import { LABEL_LOGO_SHA256 } from './label-logo.mjs';

// All approved v2 front styling lives here. The exact settings are copied into
// the finishing plan and therefore participate in its immutable content hash.
// Preview drafts can change these settings without changing grading or NFC.
export const DEFAULT_LABEL_DESIGN = Object.freeze({
  version: 'atlas-label-design-v1', logoSha256: LABEL_LOGO_SHA256,
  nameFont: 'Helvetica-Bold', nameSize: 13, nameMinSize: 8, nameTracking: -0.2,
  variantSize: 6.4, variantMinSize: 5, variantTracking: 0.4,
  accentColor: '#d2b26b', nameColor: '#f5eedc',
});
export function validateLabelDesign(design) {
  const fail = () => { throw new Error('MANUAL_LABEL_DESIGN_INVALID'); };
  if (!design || Object.getPrototypeOf(design) !== Object.prototype
    || Object.keys(design).sort().join(',') !== Object.keys(DEFAULT_LABEL_DESIGN).sort().join(',')
    || design.version !== DEFAULT_LABEL_DESIGN.version || design.logoSha256 !== LABEL_LOGO_SHA256
    || !['Helvetica-Bold', 'Times-Bold'].includes(design.nameFont)) fail();
  const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  if (!inRange(design.nameSize, 9, 16) || !inRange(design.nameMinSize, 7, design.nameSize)
    || !inRange(design.nameTracking, -0.4, 0.8) || !inRange(design.variantSize, 5, 9)
    || !inRange(design.variantMinSize, 4.5, design.variantSize) || !inRange(design.variantTracking, 0, 1)
    || !/^#[a-f0-9]{6}$/.test(design.accentColor) || !/^#[a-f0-9]{6}$/.test(design.nameColor)) fail();
  return design;
}
