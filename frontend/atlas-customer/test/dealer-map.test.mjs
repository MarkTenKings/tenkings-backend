import test from 'node:test';
import assert from 'node:assert/strict';
import { dealerAddress, dealerDirectionsUrl, dealerMapUrl } from '../lib/dealer-map.mjs';

const contact = { id: 'centercourt-cards-roseville', address: { line1: '307 Lincoln St', city: 'Roseville', region: 'CA', postalCode: '95678', country: 'US' } };
test('verified dealer embeds its Google place without inventing station or distance data', () => {
  const source = structuredClone(contact), url = new URL(dealerMapUrl(source));
  assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/embed');
  assert.match(url.searchParams.get('pb'), /0x809b211745ba98ad:0x3e78e463210e68c3/);
  assert.deepEqual(source, contact);
  assert.equal(dealerMapUrl({ ...contact, address: { ...contact.address, line1: 'A changed address' } }), null);
  assert.equal(dealerMapUrl({ ...contact, id: 'unapproved-other-dealer' }), null);
});
test('only Google map embed and directions routes are accepted', () => {
  const valid = 'https://maps.google.com/maps?q=34,-118&z=14&output=embed';
  assert.equal(dealerMapUrl({ mapEmbedUrl: valid }), valid);
  for (const value of ['https://maps.google.com.evil.example/maps?q=x&output=embed', 'https://maps.google.com/other?q=x&output=embed', 'https://maps.google.com/maps?q=x', 'http://maps.google.com/maps?q=x&output=embed', 'https://name:secret@maps.google.com/maps?q=x&output=embed', 'javascript:alert(1)', 'https://www.google.com/maps/other?pb=1']) assert.equal(dealerMapUrl({ mapEmbedUrl: value }), null);
  assert.equal(dealerDirectionsUrl('https://www.google.com/maps/dir/?api=1&destination=Test'), 'https://www.google.com/maps/dir/?api=1&destination=Test');
  for (const value of ['https://www.google.com.evil.example/maps/dir/', 'https://www.google.com/maps-evil/', 'javascript:alert(1)', 'https://name:secret@google.com/maps/dir/']) assert.equal(dealerDirectionsUrl(value), null);
  assert.equal(dealerAddress(contact.address), '307 Lincoln St, Roseville, CA, 95678, US');
});
