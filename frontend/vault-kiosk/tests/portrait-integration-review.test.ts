import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultMachineProfile } from '@tenkings/vault-contracts/browser';
import type { Props } from '../src/cinematic/CinematicVault';
import type { KioskPublicSnapshot } from '../src/types';
import PortraitVault from '../src/portrait/PortraitVault';
import { PaidFlow } from '../src/components/PaidFlow';
import { SupportPanel } from '../src/components/SupportPanel';
import { portraitRevealIds } from '../src/portrait/profile';
import { snapshot, sale } from './fixtures';
import { click, renderReact } from './render';

// Independent component boundary review: WebGL is covered by the browser suite.
vi.mock('../src/portrait/PortraitWorld', () => ({ PortraitWorld: () => null }));
const require = createRequire(import.meta.url);
const { makeSyntheticProfile } = require('../../../packages/vault-contracts/tests/profile-fixtures.js') as { makeSyntheticProfile(count: number): { profile: VaultMachineProfile } };

function fixture() {
  const profile = makeSyntheticProfile(68).profile;
  // Test-only qualification metadata; no machine config is published by this test.
  profile.provenance = 'QUALIFIED';
  profile.evidence = { geometryDigest: 'a'.repeat(64), wiringDigest: 'b'.repeat(64), capabilityDigest: 'c'.repeat(64), hardwareDigest: 'd'.repeat(64) };
  profile.display = { width: 26, height: 50, cutouts: [] };
  profile.doors.forEach((door, index) => {
    door.displayRect = { x: index % 4 * 6.4, y: Math.floor(index / 4) * 2.9, width: 6, height: 2.5 };
    door.label = `Printed-${index + 101}`;
  });
  return snapshot({ configSchemaVersion: 2, machineProfile: profile,
    doors: profile.doors.map(door => ({ doorId: door.doorId, state: 'AVAILABLE' as const, productId: 'sports-25', selected: false })), cart: [] });
}

function paidFlow(state: KioskPublicSnapshot, onOpenDoors = () => undefined) {
  return createElement(PaidFlow, { snapshot: state, presentation: 'cinematic', retryBusy: false, paymentBusy: false, doneBusy: false,
    onContinuePayment: () => undefined, onOpenDoors, onDone: () => undefined });
}

function props(state: KioskPublicSnapshot, overrides: Partial<Props> = {}): Props {
  return { snapshot: state, doors: state.doors, cart: state.cart, selectedProductId: 'sports-25', disabled: false,
    busy: null, connected: true, subtotal: 2500, tax: 206, total: 2706, violation: null, notice: null,
    paidFlow: paidFlow(state), idleDialog: null, onProduct: () => undefined, onDoor: () => undefined,
    onCheckout: () => undefined, onService: () => undefined, ...overrides };
}

const shims = [
  [HTMLElement.prototype, 'scrollTo'],
  [HTMLDialogElement.prototype, 'close'],
  [HTMLDialogElement.prototype, 'showModal'],
] as const;
const originals = shims.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
beforeEach(() => { vi.mocked(window.matchMedia).mockImplementation(query => ({ matches: false, media: query } as MediaQueryList)); });
beforeAll(() => shims.forEach(([target, key]) => Object.defineProperty(target, key, { configurable: true, value: () => undefined })));
afterAll(() => shims.forEach(([target, key], index) => {
  const original = originals[index];
  if (original) Object.defineProperty(target, key, original);
  else Reflect.deleteProperty(target, key);
}));

describe('independent Portrait B integration review', () => {
  it('renders signed labels in geometric order and passes the selected stable ID after independent array shuffles', async () => {
    const state = fixture(), expected = state.doors.map(door => door.doorId), onDoor = vi.fn();
    state.machineProfile!.doors.reverse();
    state.doors = [...state.doors.slice(23), ...state.doors.slice(0, 23)];
    const view = renderReact(createElement(PortraitVault, props(state, { onDoor })));
    try {
      const buttons = [...view.container.querySelectorAll<HTMLButtonElement>('.portrait-door')];
      expect(buttons.map(button => button.dataset.doorId)).toEqual(expected);
      expect(buttons[37]!.textContent).toContain('Printed-138');
      await click(buttons[37]!);
      expect(onDoor).toHaveBeenCalledOnce();
      expect(onDoor).toHaveBeenCalledWith(state.doors.find(door => door.doorId === expected[37]));
    } finally { view.unmount(); }
  });

  it('keeps immutable sale labels and only exact paid IDs in recovered collection artwork', () => {
    const state = fixture(), paidId = state.doors[37]!.doorId;
    state.publicState = 'PAID_RESET_COUNTDOWN';
    state.activeSale = { ...sale, authorizationDurable: true, paymentState: 'RECONCILIATION_REQUIRED',
      items: [{ ...sale.items[0]!, doorId: paidId, doorLabel: 'Original-sale-label' }], paidDoorIds: [paidId], resetSecondsRemaining: 24 };
    const html = renderToStaticMarkup(createElement(PortraitVault, props(state)));
    const container = document.createElement('div'); container.innerHTML = html;
    const paid = [...container.querySelectorAll<HTMLElement>('.portrait-door.is-paid')];
    expect(paid.map(button => button.dataset.doorId)).toEqual([paidId]);
    expect(paid[0]!.textContent).toContain('Original-sale-label');
    expect(paid[0]!.textContent).not.toContain('Printed-138');
    state.activeSale.authorizationDurable = false;
    expect(portraitRevealIds(state)).toEqual([]);
  });

  it('does not promise an uncharged checkout for a qualified production profile', () => {
    const state = fixture();
    const html = renderToStaticMarkup(createElement(PortraitVault, props(state)));
    expect(html.includes('No real charge')).toBe(false);
    expect(html.includes('Test checkout')).toBe(false);
    expect(html.includes('Complete payment on the card terminal.')).toBe(true);
  });

  it('identifies certification checkout while reserving the no-charge promise for the simulator', () => {
    const state = fixture(); state.mode = 'CERTIFICATION';
    const qualified = renderToStaticMarkup(createElement(PortraitVault, props(state)));
    expect(qualified.includes('Test checkout')).toBe(true);
    expect(qualified.includes('No real charge')).toBe(false);
    state.machineProfile!.provenance = 'SYNTHETIC';
    const simulated = renderToStaticMarkup(createElement(PortraitVault, props(state)));
    expect(simulated.includes('Test checkout · No real charge')).toBe(true);
  });

  it.each(['UNKNOWN', 'RECONCILIATION_REQUIRED'] as const)('preserves authorized collection and one retry while %s is reconciled', async (paymentState) => {
    const state = fixture(), paidId = state.doors[37]!.doorId, onRetry = vi.fn();
    state.publicState = 'PAID_RESET_COUNTDOWN';
    state.activeSale = { ...sale, authorizationDurable: true, paymentState, paidDoorIds: [paidId],
      items: [{ ...sale.items[0]!, doorId: paidId, doorLabel: 'Original-sale-label' }], resetSecondsRemaining: 24 };
    expect(portraitRevealIds(state)).toEqual([paidId]);
    const view = renderReact(paidFlow(state, onRetry));
    try {
      expect(view.container.textContent).toContain('Paid total');
      expect(view.container.textContent).not.toContain('not proof of payment');
      expect(view.container.textContent).toContain('Original-sale-label');
      expect(view.container.textContent).toContain('I GOT MY PACKS');
      await click(view.container.querySelector('.retry-action'));
      expect(onRetry).toHaveBeenCalledOnce();
    } finally { view.unmount(); }
  });

  it('distinguishes durably paid support context from an unresolved authorization', () => {
    const state = fixture(), paidId = state.doors[37]!.doorId;
    const recoveredSale = { ...sale, authorizationDurable: true, paymentState: 'RECONCILIATION_REQUIRED' as const,
      items: [{ ...sale.items[0]!, doorId: paidId, doorLabel: 'Original-sale-label' }], paidDoorIds: [paidId] };
    const paid = renderToStaticMarkup(createElement(SupportPanel, { support: state.support!, sale: recoveredSale }));
    expect(paid.includes('Paid doors:')).toBe(true);
    expect(paid.includes('Reserved doors:')).toBe(false);
    const unresolved = renderToStaticMarkup(createElement(SupportPanel, { support: state.support!, sale: { ...recoveredSale, authorizationDurable: false } }));
    expect(unresolved.includes('Reserved doors:')).toBe(true);
    expect(unresolved.includes('Paid doors:')).toBe(false);
  });
});
