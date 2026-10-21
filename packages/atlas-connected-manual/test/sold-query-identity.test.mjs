import test from 'node:test';
import assert from 'node:assert/strict';
import { cardIdentitySearchQuery } from '../src/sold-query-identity.mjs';

test('shared searches use the saved full sports and Pokémon identity without printing or grade terms', () => {
  for (const [identity, expected] of [
    [{ category: 'SPORTS', manufacturer: 'Panini', year: '2025', setName: 'Mosaic Football Center Stage',
      name: 'Jaxson Dart', cardNumber: '7' }, 'Panini 2025 Mosaic Football Center Stage Jaxson Dart #7'],
    [{ category: 'POKEMON', manufacturer: 'Pokemon', year: '2024', setName: 'Scarlet & Violet — Paldean Fates',
      name: 'Alakazam ex', cardNumber: '215/091' }, 'Pokémon 2024 Scarlet & Violet Paldean Fates Alakazam ex #215/091'],
    [{ category: 'POKEMON', year: '2024', setName: 'Scarlet & Violet–Surging Sparks',
      name: 'Sylveon ex', cardNumber: '#086/191' }, 'Pokémon 2024 Scarlet & Violet Surging Sparks Sylveon ex #086/191'],
  ]) {
    const before = structuredClone(identity);
    assert.equal(cardIdentitySearchQuery(identity), expected);
    assert.deepEqual(identity, before);
  }
});

test('spacing and set separators normalize while seasons, casing and collector-number typography survive', () => {
  assert.equal(cardIdentitySearchQuery({ category: 'SPORTS', manufacturer: '  Topps ', year: '2025–26',
    setName: 'Chrome - Ball of Duty', name: 'LaMelo  Ball', cardNumber: '## BD-013' }),
  'Topps 2025-26 Chrome Ball of Duty LaMelo Ball #BD-013');
  assert.equal(cardIdentitySearchQuery({ category: 'POKEMON', setName: 'Scarlet & Violet - 151',
    name: 'Ho-Oh', cardNumber: '# # 025/165' }), 'Pokémon Scarlet & Violet 151 Ho-Oh #025/165');
  assert.equal(cardIdentitySearchQuery({ category: 'SPORTS', manufacturer: 'Upper Deck',
    setName: 'O-Pee-Chee', name: 'Andre\u0301', cardNumber: '001' }), 'Upper Deck O-Pee-Chee André #001');
});

test('unknown fields are omitted without invented manufacturer or set terms', () => {
  assert.equal(cardIdentitySearchQuery({ category: 'SPORTS', manufacturer: null, year: null,
    setName: null, name: 'Jaxson Dart', cardNumber: null }), 'Jaxson Dart');
  assert.equal(cardIdentitySearchQuery({ category: 'POKEMON', name: 'Ho-Oh', cardNumber: ' # ' }), 'Pokémon Ho-Oh');
});
