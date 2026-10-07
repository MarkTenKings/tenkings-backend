import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { VaultMachineProfile } from '@tenkings/vault-contracts/browser';
import { portraitProfileIds, portraitExperienceAllowed, portraitDoors, portraitRevealIds } from '../src/portrait/profile';
import { snapshot, sale } from './fixtures';
const require = createRequire(import.meta.url);
const { makeSyntheticProfile } = require('../../../packages/vault-contracts/tests/profile-fixtures.js') as { makeSyntheticProfile(count: number): { profile: VaultMachineProfile } };
function fixture() {
  const profile = makeSyntheticProfile(68).profile;
  // Fixture-only QUALIFIED metadata tests UI routing; never published to a machine.
  profile.provenance = 'QUALIFIED';
  profile.evidence = { geometryDigest: 'a'.repeat(64), wiringDigest: 'b'.repeat(64), capabilityDigest: 'c'.repeat(64), hardwareDigest: 'd'.repeat(64) };
  profile.display = { width: 26, height: 50, cutouts: [] };
  profile.doors.forEach((door, index) => { door.displayRect = { x: index % 4 * 6.4, y: Math.floor(index / 4) * 2.9, width: 6, height: 2.5 }; });
  const doors = profile.doors.map(door => ({ doorId: door.doorId, state: 'AVAILABLE' as const, productId: 'sports-25', selected: false }));
  return snapshot({ configSchemaVersion: 2, machineProfile: profile, doors });
}
describe('accepted portrait design with explicit real profile', () => {
  it('uses exact signed display slots even when profile and inventory arrays are shuffled', () => {
    const state = fixture(), expected = state.doors.map(door => door.doorId);
    state.machineProfile!.doors.reverse(); state.doors.reverse();
    expect(portraitExperienceAllowed(state, '')).toBe(true);
    expect(portraitProfileIds(state)).toEqual(expected);
    expect(portraitDoors(state, state.doors).map(door => door.doorId)).toEqual(expected);
    expect(portraitExperienceAllowed(state, '?experience=cinematic')).toBe(false);
  });
  it('never truncates a qualified profile or guesses absent, duplicate or irregular slots', () => {
    const state = fixture(); state.doors.pop(); expect(portraitProfileIds(state)).toBeNull();
    const duplicate = fixture(); duplicate.machineProfile!.doors[1]!.displayRect = { ...duplicate.machineProfile!.doors[0]!.displayRect }; expect(portraitProfileIds(duplicate)).toBeNull();
    const wide = fixture(); wide.machineProfile!.doors[0]!.displayRect.width = 7; expect(portraitProfileIds(wide)).toBeNull();
    const extra = fixture(); extra.doors.push(extra.doors[0]!); expect(portraitProfileIds(extra)).toBeNull();
    const unverified = fixture(); unverified.machineProfile!.evidence = null; expect(portraitProfileIds(unverified)).toBeNull();
  });
  it('preserves synthetic comparison gating and exact first 68 fixture IDs', () => {
    const state = fixture(); state.machineProfile!.provenance = 'SYNTHETIC'; state.mode = 'CERTIFICATION';
    expect(portraitExperienceAllowed(state, '')).toBe(false);
    expect(portraitExperienceAllowed(state, '?experience=portrait')).toBe(true);
    expect(portraitDoors(state, state.doors).map(door => door.doorId)).toEqual(state.doors.map(door => door.doorId));
    state.mode = 'PRODUCTION'; expect(portraitExperienceAllowed(state, '?experience=portrait')).toBe(false);
  });
  it('requires durable service authorization before showing physical collection artwork', () => {
    const state = fixture(), id = state.doors[7]!.doorId;
    state.publicState = 'PAID_RESET_COUNTDOWN';
    state.activeSale = { ...sale, paidDoorIds: [id], authorizationDurable: false };
    expect(portraitRevealIds(state)).toEqual([]);
    state.activeSale.authorizationDurable = true; expect(portraitRevealIds(state)).toEqual([id]);
    state.publicState = 'PAYMENT_UNKNOWN'; expect(portraitRevealIds(state)).toEqual([]);
  });
});
