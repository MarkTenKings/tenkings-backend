// Change a section's token, approval version and public hash together to feature
// another approved Sports or Pokémon card. Public reads still verify that this
// exact publication is available; this file contains no report or image copies.
export const SHOWCASE_SELECTIONS = Object.freeze({
  hero: Object.freeze({ publicToken: 'ar_B0juIVv1Y9Yi3nK6rO4lKQEo', approvalVersion: 1,
    publicHash: 'e11913487ec245aaca37f990c88f0866e3047fe0823e677f90cc424871f22b06' }),
  report: Object.freeze({ publicToken: 'ar_JZ45cPryTjqUIxH-XfXMb3AF', approvalVersion: 1,
    publicHash: 'df4be460ae4ee4cfb5680db0e5cd0909a6c7882db47786cc942b006162aed65f' }),
  fingerprint: Object.freeze({ publicToken: 'ar_KdiNNJSture4FH99-M8HQfS_', approvalVersion: 1,
    publicHash: 'eb8f44bdc6bc248f013d944e7f4774c8194622a1869d06f676e755e374fb30f8' }),
  connected: Object.freeze({ publicToken: 'ar_mlyscew3QZabpHDT9gILP0cg', approvalVersion: 2,
    publicHash: 'fae8a0687ae88ebcbe63604535552e81375420a6210511ce33a1c1cc8b7560e0' }),
});

export function validShowcaseBinding(value) {
  return Boolean(value && /^ar_[A-Za-z0-9_-]{24}$/.test(value.publicToken)
    && Number.isSafeInteger(value.approvalVersion) && value.approvalVersion > 0
    && value.approvalVersion <= 2147483647 && /^[a-f0-9]{64}$/.test(value.publicHash));
}
