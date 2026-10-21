const queryText = value => String(value ?? '').normalize('NFC').replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim();

/** Format the saved card identity without adding a printing or grade target. */
export function cardIdentitySearchQuery({ category, manufacturer, year, setName, name, cardNumber, sportsAttributes }) {
  const productSet = queryText(String(setName ?? '').replace(/[—–]/g, ' ').replace(/\s+-\s+/g, ' '));
  const number = queryText(cardNumber).replace(/^(?:#\s*)+/, '');
  return [category === 'POKEMON' ? 'Pokémon' : manufacturer, year, productSet, name,
    number ? `#${number}` : null, ...(category === 'SPORTS' ? sportsAttributeSearch(sportsAttributes).terms : [])].map(queryText).filter(Boolean).join(' ');
}
import { sportsAttributeSearch } from './sports-attribute-comps.mjs';
