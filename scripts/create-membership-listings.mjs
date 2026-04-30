/**
 * scripts/create-membership-listings.mjs
 *
 * Creates one-off "Membership" test listings for NOLO, Clooudie, Frey Tailored.
 *
 * Each listing:
 *   - Downloads the brand's logo from Supabase storage
 *   - Composites a gold frame + MEMBERSHIP badge using Sharp
 *   - Uploads the new image to submissions/{id}/jpeg/membership.jpeg
 *   - Inserts an rrg_submissions row (physical=true so seller email fires)
 *   - Calls registerDrop on-chain
 *   - Approves the listing (status='approved', hidden=false)
 *
 * Usage:
 *   node scripts/create-membership-listings.mjs
 *   node scripts/create-membership-listings.mjs --dry-run
 */

import { ethers }      from 'ethers';
import { createClient } from '@supabase/supabase-js';
import sharp            from 'sharp';
import { readFileSync } from 'fs';
import { resolve }      from 'path';
import { randomUUID }   from 'crypto';

// ── Load .env.local ──────────────────────────────────────────────────────
for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const SUPABASE_URL   = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const RPC_URL        = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const DEPLOYER_PK    = process.env.DEPLOYER_PRIVATE_KEY;
const CONTRACT_ADDR  = process.env.NEXT_PUBLIC_RRG_CONTRACT_ADDRESS;
const PLATFORM_URL   = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://realrealgenuine.com';

const DRY_RUN = process.argv.includes('--dry-run');

const db       = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const provider = new ethers.JsonRpcProvider(RPC_URL);
const deployer = new ethers.Wallet(DEPLOYER_PK, provider);
const rrg      = new ethers.Contract(CONTRACT_ADDR, [
  'function registerDrop(uint256 tokenId, address creator, uint256 priceUsdc6dp, uint256 maxSupply) external',
], deployer);

const BUCKET      = 'rrg-submissions';
const PRICE_USDC  = 0.50;
const EDITION     = 50;

// Default brands when no --brand flag is passed. Any slug present in
// rrg_brands works via --brand <slug>, even if not in this list (the
// loop falls back to the requested slug at run time).
const BRANDS = ['nolo', 'clooudie', 'frey-tailored', 'unknown-union'];

// ── Image composition ────────────────────────────────────────────────────

const GOLD = { r: 212, g: 175, b: 55, alpha: 1 };  // #D4AF37

function membershipBadgeSvg(width) {
  const badgeW = Math.round(width * 0.55);
  const badgeH = Math.round(width * 0.10);
  const x      = Math.round((width - badgeW) / 2);
  const y      = Math.round(width * 0.82);
  const rx     = Math.round(badgeH / 2);
  const fontSize = Math.round(width * 0.058);
  const textY    = y + Math.round(badgeH * 0.68);

  return Buffer.from(`
<svg width="${width}" height="${width}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${x}" y="${y}" width="${badgeW}" height="${badgeH}" rx="${rx}" ry="${rx}"
        fill="#D4AF37" opacity="0.95"/>
  <text x="${width / 2}" y="${textY}" text-anchor="middle"
        font-family="Georgia, serif" font-size="${fontSize}"
        font-weight="bold" letter-spacing="3" fill="#0a0a0a">MEMBERSHIP</text>
</svg>`);
}

async function createMembershipImage(logoBuffer) {
  const SIZE   = 900;
  const BORDER = 36;  // gold frame width in px

  // Resize logo to inner area (square), then extend with gold border
  const inner = SIZE - BORDER * 2;
  const framed = await sharp(logoBuffer)
    .resize(inner, inner, { fit: 'contain', background: { r: 250, g: 250, b: 248, alpha: 1 } })
    .extend({ top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, background: GOLD })
    .toBuffer();

  // Composite the MEMBERSHIP badge SVG over the framed image
  const badge = membershipBadgeSvg(SIZE);

  return sharp(framed)
    .composite([{ input: badge, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

// ── Token ID counter ─────────────────────────────────────────────────────

async function claimNextTokenId() {
  const { data } = await db.from('rrg_config').select('value').eq('key', 'next_token_id').single();
  const id = parseInt(data.value);
  if (!DRY_RUN) {
    await db.from('rrg_config').update({ value: String(id + 1) }).eq('key', 'next_token_id');
  }
  return id;
}

// ── CLI: optional single-brand filter + hide-on-mint ─────────────────────
// --brand <slug>   restrict run to one slug (must exist in rrg_brands; need
//                  not be in the BRANDS default list above)
// --hidden         insert with hidden=true so the badge does not appear on
//                  the storefront until the operator unhides it. Used by
//                  confirm-brand.mjs for trial-only badges.

const BRAND_FILTER = (() => {
  const i = process.argv.indexOf('--brand');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const HIDDEN_ON_MINT = process.argv.includes('--hidden');

// Effective brand list: --brand wins (always one slug, even if not in
// BRANDS default). Without --brand, run the default 4.
const EFFECTIVE_BRANDS = BRAND_FILTER ? [BRAND_FILTER] : BRANDS;

// ── Nonce tracker (avoids stale-nonce errors on sequential on-chain calls) ─

let _nonce = null;
async function nextNonce() {
  if (_nonce === null) _nonce = await deployer.getNonce('pending');
  return _nonce++;
}

// ── Main ─────────────────────────────────────────────────────────────────

console.log(`\n──── Membership Listing Creator ────`);
console.log(`Dry run: ${DRY_RUN ? 'YES' : 'no'}`);
console.log(`Contract: ${CONTRACT_ADDR}`);
console.log(`Deployer: ${deployer.address}`);
if (BRAND_FILTER) console.log(`Brand filter: ${BRAND_FILTER}`);
if (HIDDEN_ON_MINT) console.log(`Hidden on mint: YES (badge will be inserted with hidden=true)`);
console.log();

const results = [];

for (const slug of EFFECTIVE_BRANDS) {
  console.log(`\n── ${slug} ──`);

  // Load brand row
  const { data: brand, error: brandErr } = await db
    .from('rrg_brands')
    .select('id, name, slug, wallet_address, contact_email, logo_path, brand_pct_override')
    .eq('slug', slug)
    .single();

  if (brandErr || !brand) {
    console.error(`  FATAL: brand '${slug}' not found`);
    continue;
  }

  console.log(`  Brand:   ${brand.name} (${brand.id})`);
  console.log(`  Email:   ${brand.contact_email}`);
  console.log(`  Wallet:  ${brand.wallet_address}`);
  console.log(`  Split:   ${brand.brand_pct_override ?? 97.5}% to brand`);

  if (!brand.logo_path) {
    console.error(`  ERROR: no logo_path set — skipping`);
    continue;
  }

  // Download logo from Supabase storage
  const { data: logoData, error: logoErr } = await db.storage
    .from(BUCKET)
    .download(brand.logo_path);

  if (logoErr || !logoData) {
    console.error(`  ERROR: logo download failed — ${logoErr?.message}`);
    continue;
  }

  const logoBuffer = Buffer.from(await logoData.arrayBuffer());
  console.log(`  Logo:    downloaded ${logoBuffer.length} bytes`);

  // Create membership image
  const imageBuffer = await createMembershipImage(logoBuffer);
  console.log(`  Image:   created ${imageBuffer.length} bytes (gold frame + MEMBERSHIP badge)`);

  // Claim token ID
  const tokenId = await claimNextTokenId();
  console.log(`  Token:   #${tokenId}${DRY_RUN ? ' (dry-run — not saved)' : ''}`);

  // Upload image to Supabase storage
  const submissionId  = randomUUID();
  const storagePath   = `submissions/${submissionId}/jpeg/membership.jpeg`;

  if (!DRY_RUN) {
    const { error: uploadErr } = await db.storage
      .from(BUCKET)
      .upload(storagePath, imageBuffer, { contentType: 'image/jpeg', upsert: false });
    if (uploadErr) {
      console.error(`  ERROR: image upload failed — ${uploadErr.message}`);
      continue;
    }
    console.log(`  Storage: ${storagePath}`);
  } else {
    console.log(`  Storage: DRY — would upload to ${storagePath}`);
  }

  // On-chain registerDrop
  if (!DRY_RUN) {
    const priceUsdc6dp = BigInt(Math.round(PRICE_USDC * 1_000_000));
    try {
      const nonce = await nextNonce();
      const tx = await rrg.registerDrop(tokenId, brand.wallet_address, priceUsdc6dp, EDITION, { nonce });
      const receipt = await tx.wait(1);
      console.log(`  Chain:   registerDrop tx ${receipt.hash}`);
    } catch (chainErr) {
      console.error(`  ERROR: registerDrop failed — ${chainErr.message}`);
      continue;
    }
  } else {
    console.log(`  Chain:   DRY — would registerDrop(${tokenId}, ${brand.wallet_address}, ${PRICE_USDC * 1e6}, ${EDITION})`);
  }

  // Insert rrg_submissions row
  const title       = `${brand.name} Membership`;
  const description = `This a test membership badge.  It's here to be purchased by agents but we don't confirm any use or benefit to holders - YET!\n\nIf agents buy these badges then who knows?`;

  if (!DRY_RUN) {
    const { error: insertErr } = await db.from('rrg_submissions').insert({
      id:                  submissionId,
      token_id:            tokenId,
      title,
      description,
      price_usdc:          PRICE_USDC,
      edition_size:        EDITION,
      brand_id:            brand.id,
      is_brand_product:    true,
      is_physical_product: true,   // enables seller email on purchase
      shipping_type:       null,
      creator_wallet:      brand.wallet_address,
      creator_type:        'agent',
      status:              'approved',
      hidden:              HIDDEN_ON_MINT,
      jpeg_filename:       'membership.jpeg',
      jpeg_storage_path:   storagePath,
      jpeg_size_bytes:     imageBuffer.length,
      network:             'base',
    });

    if (insertErr) {
      console.error(`  ERROR: DB insert failed — ${insertErr.message}`);
      continue;
    }
    console.log(`  DB:      inserted submission ${submissionId}`);
  } else {
    console.log(`  DB:      DRY — would insert submission (${title})`);
  }

  results.push({ slug, name: brand.name, tokenId, submissionId, storagePath, title });
  console.log(`  URL:     ${PLATFORM_URL}/rrg/drop/${tokenId}`);
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n──── Done ────');
for (const r of results) {
  console.log(`${r.name.padEnd(16)} token #${r.tokenId}  ${PLATFORM_URL}/rrg/drop/${r.tokenId}`);
}

if (results.length === 0) console.log('No listings created (check errors above).');
if (DRY_RUN && results.length > 0) console.log('\nRe-run without --dry-run to commit.');
