/**
 * One-off: enhance LIVVIUM "What Lies Beneath" description on RRG.
 * Writes richer copy (phygital detail, NFC + AR + DPP + Sky Lounge) into
 * rrg_submissions.description for token #218.
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

const UPDATES = [
  {
    token_id: 218,
    description: "A connected t-shirt in 100% recycled cotton, limited to 120 numbered editions. Anatomical x-ray ribcage print across the chest in electric blue, each piece individually signed and assigned at random. An NFC tag is stitched into the hem. Tap it with a phone to unlock the hidden layers: a Digital Product Passport tied to this specific shirt, AR filters that render the wearer in evolving digital forms, and Sky Lounge access, the holder portal where the next drops and votes are gated. Responsibly sourced fabric, phygital by design. The garment is the key; the rest lives behind it. S/M or L/XL.",
  },
];

for (const u of UPDATES) {
  const { error, data } = await db
    .from('rrg_submissions')
    .update({ description: u.description })
    .eq('token_id', u.token_id)
    .select('token_id, title, description');
  if (error) {
    console.error(`#${u.token_id} FAIL:`, error.message);
  } else if (!data?.length) {
    console.error(`#${u.token_id} no row matched`);
  } else {
    console.log(`#${u.token_id} OK: ${data[0].title}`);
    console.log(`  description length: ${data[0].description.length} chars`);
  }
}
