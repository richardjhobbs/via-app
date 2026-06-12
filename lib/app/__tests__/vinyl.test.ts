/**
 * Vinyl extraction tests — the parser that turns a dealer's free-form listing
 * into a structured vinyl block, across the real formats dealers use
 * (recycle-vinyl titles, Hitman "Vinyl NM | Cover NM" + German labels,
 * Goldmine "Condition: New/Sealed/Mint"), plus CSV + seller-input.
 *
 * Run via:   npm run test
 * Direct:    node --test --experimental-strip-types lib/app/__tests__/vinyl.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseGrade,
  parseShopifyVinyl,
  parseListingBody,
  vinylFromCsvRow,
  sanitiseVinylInput,
} from '../vinyl.ts';

function shopifyProduct(over: Record<string, unknown> = {}) {
  return {
    id: 1, title: 'Untitled', handle: 'untitled', body_html: null,
    vendor: null, product_type: null, tags: [], variants: [], images: [],
    ...over,
  };
}

test('normaliseGrade folds synonyms (sealed/new = Mint), rejects junk', () => {
  assert.equal(normaliseGrade('VG+'), 'VG+');
  assert.equal(normaliseGrade('vg plus'), 'VG+');
  assert.equal(normaliseGrade('Near Mint'), 'NM');
  assert.equal(normaliseGrade('M-'), 'NM');
  assert.equal(normaliseGrade('mint'), 'M');
  assert.equal(normaliseGrade('New/Sealed/Mint'), 'M');
  assert.equal(normaliseGrade('sealed'), 'M');
  assert.equal(normaliseGrade('banana'), null);
  assert.equal(normaliseGrade(''), null);
});

test('recycle-vinyl format: title carries grade + shelf code; vendor is genre:label', () => {
  const v = parseShopifyVinyl(shopifyProduct({
    title: "Dual - Give It To 'Em  (SF PROG) VG+",
    vendor: 'Progressive House, House : Spirit Recordings',
    tags: ['12"', 'House'],
    variants: [{ id: 1, title: 'Default', price: '8', compare_at_price: null, sku: '4200745818', available: true, position: 1 }],
  }));
  assert.equal(v.artist, 'Dual');
  assert.equal(v.title, "Give It To 'Em");
  assert.equal(v.format, '12"');
  assert.equal(v.media_grade, 'VG+');
  assert.equal(v.label, 'Spirit Recordings');
  assert.ok(v.genres?.includes('Progressive House'));
  assert.equal(v.catalogue_number, '4200745818'); // no body cat#, SKU fallback
});

test('Hitman format: "Vinyl NM | Cover NM" + German labels', () => {
  const v = parseShopifyVinyl(shopifyProduct({
    title: 'J Dilla – Donuts | Reissue US 2018',
    tags: ['Hip Hop'],
    body_html: 'Vinyl NM | Cover NM | Hypesticker VG+ Label: Stones Throw Records Format: 2 x Vinyl, 12", 33 ⅓ RPM, Album, Reissue Land: US Veröffentlicht: 2018 Genre: Hip Hop Stil: Instrumental',
    variants: [{ id: 1, title: 'Default', price: '40', compare_at_price: null, sku: 'STH2126', available: true, position: 1 }],
  }));
  assert.equal(v.artist, 'J Dilla');
  assert.equal(v.title, 'Donuts');                 // "| Reissue US 2018" stripped
  assert.equal(v.media_grade, 'NM');
  assert.equal(v.sleeve_grade, 'NM');
  assert.equal(v.label, 'Stones Throw Records');
  assert.equal(v.pressing_country, 'US');
  assert.equal(v.pressing_year, 2018);
  assert.equal(v.format, '2x12"');
  assert.ok(v.genres?.includes('Hip Hop'));
  assert.ok(v.genres?.includes('Instrumental'));
  assert.ok(v.pressing_notes?.includes('Reissue'));
  assert.ok((v.condition_notes ?? '').includes('NM'));
});

test('Goldmine format: quoted title + "Condition: New/Sealed/Mint" = Mint', () => {
  const v = parseShopifyVinyl(shopifyProduct({
    title: "NAILBOMB 'Point Blank' 180g Vinyl LP (1994 Thrash/Industrial)",
    body_html: 'Condition: New/Sealed/Mint',
  }));
  assert.equal(v.artist, 'NAILBOMB');
  assert.equal(v.title, 'Point Blank');
  assert.equal(v.format, 'LP');
  assert.equal(v.media_grade, 'M');
  assert.equal(v.pressing_year, 1994);
  assert.ok(v.pressing_notes?.includes('180g'));
  assert.ok((v.condition_notes ?? '').includes('New/Sealed/Mint'));
});

test('parseListingBody pulls Discogs-style provenance', () => {
  const body = 'Media Condition: Very Good Plus (VG+) Sleeve Condition: Near Mint (NM or M-) Label: Last Gang Records Catalogue Number: Q101358LP Country: UK Released: 24 Apr 2012 Genre: Electronic Style: Electro, Techno Matrix / Runout Q1 01358LP-A 97555M1/A Data provided by Discogs';
  const b = parseListingBody(body);
  assert.equal(b.media_grade, 'VG+');
  assert.equal(b.sleeve_grade, 'NM');
  assert.equal(b.label, 'Last Gang Records');
  assert.equal(b.catalogue_number, 'Q101358LP');
  assert.equal(b.pressing_country, 'UK');
  assert.equal(b.pressing_year, 2012);
  assert.ok(b.genres?.includes('Electro'));
  assert.ok((b.matrix_runout ?? '').includes('Q1 01358LP-A'));
  assert.equal(parseListingBody('just a plain description').media_grade, undefined);
});

test('vinylFromCsvRow maps columns and aliases; null when no vinyl cells', () => {
  const block = vinylFromCsvRow({
    artist: 'Burial', format: '2xLP', catno: 'HDB050', media: 'NM',
    sleeve_grade: 'vg+', year: '2007', genre: 'Dubstep, Garage', play_tested: 'yes',
  });
  assert.ok(block);
  assert.equal(block!.artist, 'Burial');
  assert.equal(block!.catalogue_number, 'HDB050');
  assert.equal(block!.media_grade, 'NM');
  assert.equal(block!.sleeve_grade, 'VG+');
  assert.equal(block!.pressing_year, 2007);
  assert.deepEqual(block!.genres, ['Dubstep', 'Garage']);
  assert.equal(block!.play_tested, true);
  assert.equal(vinylFromCsvRow({ title: 'just a normal product', price: '10' }), null);
});

test('sanitiseVinylInput rejects bad grades, coerces year and id', () => {
  assert.equal(sanitiseVinylInput({ media_grade: 'banana' }).ok, false);
  const good = sanitiseVinylInput({ media_grade: 'vg+', sleeve_grade: 'VG', pressing_year: '1979', discogs_release_id: '12345' });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.vinyl.media_grade, 'VG+');
    assert.equal(good.vinyl.pressing_year, 1979);
    assert.equal(good.vinyl.discogs_release_id, 12345);
  }
});
