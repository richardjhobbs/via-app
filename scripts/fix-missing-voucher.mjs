#!/usr/bin/env node
/**
 * One-off script to retroactively create a voucher for purchase 9cd0e29a
 * (token 32 "ECC Members Badge") which was purchased before the build completed.
 */
import { createHmac, randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const HMAC_SECRET  = process.env.VOUCHER_HMAC_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY || !HMAC_SECRET) {
  console.error('Missing env vars');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateCode() {
  const seg = (len) => {
    const bytes = randomBytes(len);
    let r = '';
    for (let i = 0; i < len; i++) r += CODE_CHARS[bytes[i] % CODE_CHARS.length];
    return r;
  };
  return `RRG-${seg(4)}-${seg(4)}`;
}

const PURCHASE_ID    = '9cd0e29a-024a-4276-9157-ef2398616347';
const TEMPLATE_ID    = '449248d0-7dda-442e-a83b-b9d0c5bcb057';
const SUBMISSION_ID  = await db.from('app_purchases').select('submission_id').eq('id', PURCHASE_ID).single().then(r => r.data?.submission_id);
const BRAND_ID       = 'f1531f2a-a909-4d86-b01b-3896cc7984cd';
const BUYER_WALLET   = '0xc12ecf02448e0e56dad9c0d5473553b80d030d75';

const voucherId       = crypto.randomUUID();
const code            = generateCode();
const redemptionToken = createHmac('sha256', HMAC_SECRET).update(voucherId).digest('hex');
const expiresAt       = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

console.log(`Creating voucher: ${code}`);
console.log(`  ID: ${voucherId}`);
console.log(`  Template: ${TEMPLATE_ID}`);
console.log(`  Purchase: ${PURCHASE_ID}`);
console.log(`  Submission: ${SUBMISSION_ID}`);
console.log(`  Expires: ${expiresAt}`);

const { data, error } = await db
  .from('rrg_vouchers')
  .insert({
    id:               voucherId,
    template_id:      TEMPLATE_ID,
    purchase_id:      PURCHASE_ID,
    submission_id:    SUBMISSION_ID,
    brand_id:         BRAND_ID,
    code,
    redemption_token: redemptionToken,
    buyer_wallet:     BUYER_WALLET,
    status:           'active',
    expires_at:       expiresAt,
    network:          'base',
  })
  .select()
  .single();

if (error) {
  console.error('Insert failed:', error);
  process.exit(1);
}

console.log('Voucher created successfully!');
console.log(`  Code: ${data.code}`);
console.log(`  Redemption token: ${data.redemption_token}`);
console.log(`  Expires: ${data.expires_at}`);
