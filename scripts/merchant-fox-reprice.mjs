/**
 * One-off: repricing The Merchant Fox products after GBP→USDC rate change.
 * 1.27 → 1.35.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    const k = m[1].trim();
    const v = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// GBP prices × 1.35 (2dp)
const UPDATES = [
  { token_id: 213, gbp: 175, title: 'Flannel Tie' },
  { token_id: 214, gbp: 185, title: 'Cricket Slipover' },
  { token_id: 215, gbp: 650, title: 'Herringbone Throw' },
  { token_id: 216, gbp: 47,  title: 'D.R. Harris Cologne' },
  { token_id: 217, gbp: 95,  title: 'Sullivan Artist Square' },
];

const RATE = 1.35;

for (const u of UPDATES) {
  const usdc = (Math.round(u.gbp * RATE * 100) / 100).toFixed(2);
  const { error, data } = await db
    .from('rrg_submissions')
    .update({ price_usdc: usdc })
    .eq('token_id', u.token_id)
    .select('token_id, title, price_usdc');
  if (error) console.error(`#${u.token_id} FAIL:`, error.message);
  else if (!data?.length) console.error(`#${u.token_id} no row matched`);
  else console.log(`#${u.token_id} ✓ £${u.gbp} → $${data[0].price_usdc}  (${data[0].title})`);
}

// Also check for any variant price_overrides that need rescaling.
// For this brand all 5 slipover sizes share the same price, so price_override
// should be NULL on every variant. Verify and log.
const { data: variants } = await db
  .from('rrg_product_variants')
  .select('submission_id, size, price_override, rrg_submissions!inner(token_id, brand_id)')
  .not('price_override', 'is', null);
const foxVariants = (variants ?? []).filter(v => [213, 214, 215, 216, 217].includes(v.rrg_submissions?.token_id));
if (foxVariants.length === 0) {
  console.log('\nNo variant price_overrides to update.');
} else {
  console.log(`\n${foxVariants.length} variant overrides to review:`, foxVariants);
}
