/**
 * One-off: enhance per-product descriptions for The Merchant Fox.
 * Writes richer copy (provenance, craft detail) into rrg_submissions.description
 * for tokens #213-#217.
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
    token_id: 213,
    description: "Three-fold flannel tie, handmade in Naples from Fox Brothers' own cloth. Navy and black microcheck woven in Somerset, then rolled and bar-tacked by hand with a self-fabric loop. Unlined for a soft knot that drapes under winter tailoring: flannel suits, tweed, corduroy, heavy knits. 8.5cm blade, 148cm length, 100% worsted wool. Fox pioneered flannel in 1803; this is the same cloth, a tie's width of it.",
  },
  {
    token_id: 214,
    description: "Cable-knit slipover in ecru British wool, V-neck banded in green and gold. The shape that carried English cricket through the 20th century, updated in the same cable and ribbed hem pattern. Each piece is shaped, linked and hand-finished in England. 100% British wool. Sizes XS to XL.",
  },
  {
    token_id: 215,
    description: "200 x 148cm throw in 100% fine merino, woven in England to an exclusive Fox Brothers design. Herringbone with a tonal stripe, blanket-stitched edges, heavy enough for a sofa, soft enough for a bed. Dry clean only. The same mill that has been weaving worsted suiting at Tonedale since 1772, making the blanket you will keep.",
  },
  {
    token_id: 216,
    description: "A fragrance cut for flannel. Fox Brothers invented the cloth in 1803; D.R. Harris, the St James's perfumer founded in 1790, built the scent around their own Eau de Portugal formula: sweet orange oil, bitter orange, mandarin, lemon, neroli, verbena, bergamot. Pure essential oils, not animal-tested, made in England. 50ml refillable glass bottle. Two of Britain's oldest houses, one bottle.",
  },
  {
    token_id: 217,
    description: "Artist square from Chris Sullivan, Wag Club founder and Blue Rondo à la Turk frontman, built around a lyric that goes back to Ellington. 70% wool, 30% silk challis, 33 x 33cm, rolled edges, soft finish. Screen-printed in the UK in a small run. Sullivan and Mr. Cordeaux met at The Wag in Soho; this piece carries latin jazz, vintage funk and early-80s northern soul into a breast pocket.",
  },
];

for (const u of UPDATES) {
  const { error, data } = await db
    .from('rrg_submissions')
    .update({ description: u.description })
    .eq('token_id', u.token_id)
    .select('token_id, title');
  if (error) {
    console.error(`#${u.token_id} FAIL:`, error.message);
  } else if (!data?.length) {
    console.error(`#${u.token_id} no row matched`);
  } else {
    console.log(`#${u.token_id} ✓ ${data[0].title}`);
  }
}
