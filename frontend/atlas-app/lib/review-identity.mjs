import { canonicalizeNewSpeedsterSessionIdentity } from '@atlas/grading-core/identity';

/** Language is part of the existing parallel text, not a separate saved key. */
export function reviewIdentityFields(identity) {
  const sports = Object.hasOwn(identity, 'playerName');
  return [
    { key: sports ? 'playerName' : 'cardName', label: sports ? 'Player name' : 'Card name' },
    { key: 'year', label: 'Year', maxLength: 24 },
    { key: 'manufacturer', label: 'Manufacturer' },
    { key: 'productSet', label: 'Product / set' },
    { key: 'cardNumber', label: 'Card number' },
    { key: 'parallel', label: 'Language / variant', placeholder: 'For example: English Cosmos Holofoil' },
    ...(sports ? [{ key: 'insert', label: 'Insert' }] : [{ key: 'layoutType', label: 'Card kind', options: ['POKEMON', 'TRAINER', 'ENERGY'] }]),
  ];
}

const text = value => String(value ?? '').trim();
export function reviewIdentityChanged(current, edited) {
  return reviewIdentityFields(current).some(({ key }) => text(current[key]) !== text(edited[key]));
}

/** The command takes a complete canonical identity. Never manufacture a no-op revision. */
export function reviewIdentityEdit(current, edited) {
  if (!reviewIdentityChanged(current, edited)) return null;
  const identity = { ...current };
  for (const { key } of reviewIdentityFields(current)) identity[key] = text(edited[key]);
  const profile = Object.hasOwn(current, 'playerName') ? 'SPORTS' : 'POKEMON';
  // Historical Pokémon hashes distinguish an omitted manufacturer from null.
  if (profile === 'POKEMON' && !identity.manufacturer) delete identity.manufacturer;
  if (profile === 'POKEMON' && !identity.layoutType) identity.layoutType = null;
  return { type: 'IDENTITY_EDIT', identity: canonicalizeNewSpeedsterSessionIdentity(profile, identity) };
}
