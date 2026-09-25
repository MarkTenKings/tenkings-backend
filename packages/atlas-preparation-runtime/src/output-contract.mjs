import { PreparationError } from './process.mjs';

export const PREPARATION_FULL_V1 = 'atlas-preparation-full-v1';
export const PREPARATION_CORE_V1 = 'atlas-preparation-core-v1';
export const PREPARATION_REVEALS_V1 = 'atlas-preparation-reveals-v1';
const names = Object.freeze({
  [PREPARATION_FULL_V1]: Object.freeze(['rectified', 'inspection', 'normalized', 'microDefect', 'directional']),
  [PREPARATION_CORE_V1]: Object.freeze(['rectified', 'inspection']),
  [PREPARATION_REVEALS_V1]: Object.freeze(['normalized', 'microDefect', 'directional']),
});

/** Missing contracts identify historical full manifests only. Callers that
 * produce new work must compare the explicit returned/requested contract. */
export function preparationOutputNames(contract = PREPARATION_FULL_V1) {
  if (typeof contract !== 'string' || !Object.hasOwn(names, contract)) throw new PreparationError('PREPARATION_OUTPUT_INVALID');
  return names[contract];
}
