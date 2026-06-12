/**
 * Vinyl category unit tests — the pure logic behind the metadata.vinyl
 * convention: Shopify title parsing, CSV row mapping, seller-input
 * sanitisation, and the publish-time grade gate.
 *
 * Reference: lib/app/vinyl.ts + docs/reference_via_vinyl_schema.md
 *
 * Run via:   npm run test
 * Direct:    node --test --experimental-strip-types lib/app/__tests__/vinyl.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseGrade,
  parseShopifyVinyl,
  vinylFromCsvRow,
  sanitiseVinylInput,
  validateVinylForPublish,
} from '../vinyl.ts';

function shopifyProduct(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: 'Untitled',
    handle: 'untitled',
    body_html: null,
    vendor: null,
    product_type: null,
    tags: [],
    variants: [],
    images: [],
    ...over,
  };
}

test('normaliseGrade folds synonyms and rejects junk', () => {
  assert.equal(normaliseGrade('VG+'), 'VG+');
  assert.equal(normaliseGrade('vg plus'), 'VG+');
  assert.equal(normaliseGrade('Near Mint'), 'NM');
  assert.equal(normaliseGrade('M-'), 'NM'); // Discogs treats M- as NM
  assert.equal(normaliseGrade('mint'), 'M');
  assert.equal(normaliseGrade('sealed'), null);
  assert.equal(normaliseGrade(''), null);
});

test('parseShopifyVinyl reads artist/title, format, grade pair, cat number', () => {
  const p = shopifyProduct({
    title: 'Aphex Twin - Selected Ambient Works (12") VG+/VG',
    vendor: 'Apollo',
    tags: ['techno'],
    variants: [{ id: 9, title: 'Default', price: '20.00', compare_at_price: null, sku: 'AMB-3922', available: true, position: 1 }],
  });
  const v = parseShopifyVinyl(p);
  assert.equal(v.artist, 'Aphex Twin');
  assert.equal(v.title, 'Selected Ambient Works (12") VG+/VG');
  assert.equal(v.format, '12"');
  assert.equal(v.media_grade, 'VG+');
  assert.equal(v.sleeve_grade, 'VG');
  assert.equal(v.catalogue_number, 'AMB-3922');
  assert.equal(v.label, 'Apollo');
});

test('parseShopifyVinyl leaves grades unset when not present (gate will block)', () => {
  const v = parseShopifyVinyl(shopifyProduct({ title: 'Various - Compilation LP' }));
  assert.equal(v.format, 'LP');
  assert.equal(v.media_grade, undefined);
  assert.equal(v.sleeve_grade, undefined);
});

test('parseShopifyVinyl captures a single trailing grade as media, cleans title (recycle-vinyl shape)', () => {
  const v = parseShopifyVinyl(shopifyProduct({
    title: "Dual - Give It To 'Em  (SF PROG) VG+",
    tags: ['12"', 'House'],
    variants: [{ id: 1, title: 'Default', price: '8.00', compare_at_price: null, sku: '4200745818', available: true, position: 1 }],
  }));
  assert.equal(v.artist, 'Dual');
  assert.equal(v.title, "Give It To 'Em"); // grade + shelf code stripped
  assert.equal(v.format, '12"');
  assert.equal(v.media_grade, 'VG+');
  assert.equal(v.sleeve_grade, undefined); // single grade: sleeve left for the seller
  assert.equal(v.catalogue_number, '4200745818');
});

test('parseShopifyVinyl normalises a lowercase format token', () => {
  const v = parseShopifyVinyl(shopifyProduct({ title: 'Someone - A Record ep VG' }));
  assert.equal(v.format, 'EP');
  assert.equal(v.media_grade, 'VG');
});

test('parseShopifyVinyl splits a "genre : label" vendor and dedupes labels', () => {
  const a = parseShopifyVinyl(shopifyProduct({ title: 'X - Y 12" VG', vendor: 'Electro, Techno : Last Gang Records' }));
  assert.deepEqual(a.genres, ['Electro', 'Techno']);
  assert.equal(a.label, 'Last Gang Records');

  const b = parseShopifyVinyl(shopifyProduct({ title: 'X - Y 12" VG', vendor: 'House, Tribal House : Strictly Rhythm,Strictly Rhythm' }));
  assert.deepEqual(b.genres, ['House', 'Tribal House']);
  assert.equal(b.label, 'Strictly Rhythm'); // duplicate collapsed

  const c = parseShopifyVinyl(shopifyProduct({ title: 'X - Y 12" VG', vendor: 'Acme Records' }));
  assert.equal(c.label, 'Acme Records');
  assert.equal(c.genres, undefined);
});

test('vinylFromCsvRow maps columns and aliases; null when no vinyl cells', () => {
  const block = vinylFromCsvRow({
    artist: 'Burial',
    format: '2xLP',
    catno: 'HDB050',
    media: 'NM',
    sleeve_grade: 'vg+',
    year: '2007',
    play_tested: 'yes',
  });
  assert.ok(block);
  assert.equal(block.artist, 'Burial');
  assert.equal(block.catalogue_number, 'HDB050');
  assert.equal(block.media_grade, 'NM');
  assert.equal(block.sleeve_grade, 'VG+');
  assert.equal(block.pressing_year, 2007);
  assert.equal(block.play_tested, true);

  assert.equal(vinylFromCsvRow({ title: 'just a normal product', price: '10' }), null);
});

test('sanitiseVinylInput rejects bad grades, coerces year and id', () => {
  const bad = sanitiseVinylInput({ media_grade: 'banana' });
  assert.equal(bad.ok, false);

  const good = sanitiseVinylInput({ media_grade: 'vg+', sleeve_grade: 'VG', pressing_year: '1979', discogs_release_id: '12345' });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.vinyl.media_grade, 'VG+');
    assert.equal(good.vinyl.pressing_year, 1979);
    assert.equal(good.vinyl.discogs_release_id, 12345);
  }
});

test('validateVinylForPublish: non-vinyl passes, vinyl needs media grade, sleeve optional', () => {
  assert.equal(validateVinylForPublish(undefined).ok, true);
  assert.equal(validateVinylForPublish(null).ok, true);
  assert.equal(validateVinylForPublish({ artist: 'X' }).ok, false);          // vinyl block, no media grade
  assert.equal(validateVinylForPublish({ media_grade: 'VG+' }).ok, true);    // media only is enough
  assert.equal(validateVinylForPublish({ media_grade: 'VG+', sleeve_grade: 'VG' }).ok, true);
  assert.equal(validateVinylForPublish({ media_grade: 'bogus', sleeve_grade: 'VG' }).ok, false); // bad media
  assert.equal(validateVinylForPublish({ media_grade: 'VG+', sleeve_grade: 'bogus' }).ok, false); // bad sleeve rejected
});
