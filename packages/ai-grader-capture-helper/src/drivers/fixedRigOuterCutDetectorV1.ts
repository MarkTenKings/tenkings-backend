import type { FixedRigPointV1 } from "./fixedRigCenteringV1";

/**
 * Shared raw/normalized image-plane shape used by the canonical dense-contour
 * pipeline. This module intentionally contains no detector implementation:
 * the former expected-profile-seeded rectangle search was removed.
 */
export interface FixedRigOuterCutRgbPlaneV1 {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/**
 * Product geometry is comparison-only after the physical pixel contour has
 * been observed and sealed. It cannot seed, move, replace, or veto that
 * observed contour.
 */
export interface FixedRigIntendedOuterBoundaryAuthorityV1 {
  profileId: string;
  profileVersion: string;
  artifactSha256: string;
  coordinateFrame: "normalized_card_portrait_pixels";
  contour: FixedRigPointV1[];
}
