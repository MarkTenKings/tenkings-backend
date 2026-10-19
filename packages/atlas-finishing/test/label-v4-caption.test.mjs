import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLabelV4 } from '../src/label-v4.mjs';

const packet = (cardProfile, identity) => ({ identity, cardProfile, finalGrade: 9,
  reportNumber: 'ATLAS-0123456789AB', approvalVersion: 1 });

test('Sports and Pokémon render the original concise caption with the full approved identity retained separately', () => {
  for (const [cardProfile, identity, expected] of [
    ['SPORTS', { playerName: 'Kobe Bryant', cardNumber: '#138', parallel: 'Rookie', year: '1996–97',
      manufacturer: 'The Topps Company', productSet: 'Topps Basketball' }, '#138 ROOKIE · 1996–97 TOPPS'],
    ['POKEMON', { cardName: 'Alakazam', cardNumber: '1/102', parallel: 'Holo', year: '1999',
      manufacturer: 'The Pokémon Company International', productSet: 'Base Set' }, '#1/102 HOLO · 1999 POKÉMON'],
  ]) {
    const source = Object.freeze(packet(cardProfile, Object.freeze(identity))), result = renderLabelV4(source);
    assert.equal(result.state, 'READY'); assert.equal(result.diagnostics.metadata.text, expected);
    assert.equal(result.diagnostics.textLayout, undefined);
    assert.ok(result.diagnostics.metadata.inkHeightMm >= 1);
    assert.deepEqual(result.source, source); assert.notEqual(result.source.identity, identity);
    result.source.identity.productSet = 'A separate mutable copy';
    assert.notEqual(result.source.identity.productSet, identity.productSet);
  }
});

test('Base and empty variants omit the qualifier without inferring one from the set or profile', () => {
  for (const cardProfile of ['SPORTS', 'POKEMON']) for (const variant of [null, '', 'Base', 'BASE CARD', 'none', 'N/A',
    ' Base ', '\tbase   card\n', ' None  ', ' n/a ', ' \t\n']) {
    const identity = { ...(cardProfile === 'SPORTS' ? { playerName: 'Kobe Bryant' } : { cardName: 'Alakazam' }),
      cardNumber: '138', year: '1996–97', manufacturer: 'Topps', productSet: 'Rookie Holo Collection', parallel: variant, insert: variant };
    const source = packet(cardProfile, identity), result = renderLabelV4(source);
    assert.equal(result.state, 'READY'); assert.equal(result.diagnostics.metadata.text, '#138 · 1996–97 TOPPS');
    assert.deepEqual(result.source, source);
  }
});

test('approved variant identity is retained verbatim apart from display case and existing exact deduplication', () => {
  const identity = { cardName: 'Sylveon ex', cardNumber: '086/191', parallel: 'English Holofoil', insert: 'Promo · Red',
    year: '2024', manufacturer: 'Pokémon', productSet: 'Scarlet & Violet—Surging Sparks' };
  const source = packet('POKEMON', identity), result = renderLabelV4(source);
  assert.equal(result.state, 'READY'); assert.deepEqual(result.source, source);
  assert.equal(result.diagnostics.metadata.text, '#086/191 ENGLISH HOLOFOIL · PROMO · RED · 2024 POKÉMON');
  const duplicate = renderLabelV4(packet('POKEMON', { ...identity, insert: 'English Holofoil' }));
  assert.equal(duplicate.diagnostics.metadata.text, '#086/191 ENGLISH HOLOFOIL · 2024 POKÉMON');
  const spaced = { ...identity, parallel: ' English  Holofoil ', insert: null };
  const retained = renderLabelV4(packet('POKEMON', spaced));
  assert.equal(retained.diagnostics.metadata.text, '#086/191  ENGLISH  HOLOFOIL  · 2024 POKÉMON');
  assert.deepEqual(retained.source.identity, spaced, 'placeholder comparison never rewrites a real approved variant');
});

test('short manufacturers use exact approved aliases and never infer a brand from partial matches, profile, or set', () => {
  const identity = { cardName: 'Mew', year: '2024', cardNumber: '1', productSet: 'Pokémon Topps Panini' };
  for (const [manufacturer, expected] of [
    ['The Pokémon Company International', 'POKÉMON'], ['Pokemon', 'POKÉMON'],
    ['  the Pokémon Company  ', 'POKÉMON'], ['Panini America', 'PANINI'], ['Panini America, Inc.', 'PANINI'],
    ['The Topps Company', 'TOPPS'], ['The Topps Company, Inc.', 'TOPPS'],
    ['Topps Chrome', 'TOPPS CHROME'], ['Panini America Archives', 'PANINI AMERICA ARCHIVES'],
    ['Wizards of the Coast', 'WIZARDS OF THE COAST'], ['Unknown Card Maker', 'UNKNOWN CARD MAKER'],
  ]) {
    const source = packet('POKEMON', { ...identity, manufacturer }), result = renderLabelV4(source);
    assert.equal(result.state, 'READY'); assert.equal(result.diagnostics.metadata.text, `#1 · 2024 ${expected}`);
    assert.deepEqual(result.source, source);
  }
  for (const manufacturer of [null, undefined, '']) {
    const source = packet('POKEMON', { ...identity, manufacturer }), result = renderLabelV4(source);
    assert.equal(result.state, 'READY'); assert.equal(result.diagnostics.metadata.text, '#1 · 2024');
    assert.deepEqual(result.source, source);
  }
});
