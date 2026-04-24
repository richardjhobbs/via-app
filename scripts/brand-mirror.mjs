/**
 * scripts/brand-mirror.mjs
 *
 * Generalized Shopify-to-RRG mirror. Config-driven from a JSON block per brand.
 * Unlike clooudie-mirror.mjs, this imports ALL variants per product (size/color)
 * into rrg_product_variants and supports garment brands with sizing.
 *
 * Usage:
 *   node scripts/brand-mirror.mjs --brand unknown-union                  # DB + images only (safe default)
 *   node scripts/brand-mirror.mjs --brand unknown-union --commit-chain   # DB + images + registerDrop on Base
 *   node scripts/brand-mirror.mjs --brand unknown-union --only seven-society-rugby-shirt
 *   node scripts/brand-mirror.mjs --brand unknown-union --dry-run
 *   node scripts/brand-mirror.mjs --brand unknown-union --seed-only
 *
 * Chain registration is OPT-IN since April 2026. Running without --commit-chain
 * will upload images and seed rrg_submissions / rrg_product_variants but will
 * NOT call registerDrop on the RRG contract. The on-chain step is a deliberate
 * commitment (costs gas + makes the drop publicly addressable) and must be
 * requested explicitly. `--skip-chain` remains accepted as a no-op alias.
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   DEPLOYER_PRIVATE_KEY, NEXT_PUBLIC_RRG_CONTRACT_ADDRESS, NEXT_PUBLIC_BASE_RPC_URL
 */

import { ethers } from 'ethers';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';

// ── Brand configs ────────────────────────────────────────────────────
const BRANDS = {
  'unknown-union': {
    slug:            'unknown-union',
    name:            'Unknown Union',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'One book. Many stories.',
    description:     'Unknown Union — narrative-driven streetwear and culture fashion, centered on the idea of an "unknown union" that binds humanity across borders. Mirror of shop.unknownunion.com — checkout in USDC on Base, ships from UU.',
    website:         'https://shop.unknownunion.com',
    shopifyDomain:   'shop.unknownunion.com',
    supportsSizing:  true,
    socialLinks:     { instagram: 'https://www.instagram.com/unknownunion/' },
    bannerLocal:     null, // upload via Supabase storage separately
    logoLocal:       null,
  },
  'frey-tailored': {
    slug:            'frey-tailored',
    name:            'Frey Tailored',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Savile Row techniques, made for her.',
    description:     'Frey Tailored — a Hong Kong womenswear label specialising in tailoring. Half canvas construction, surgeon\u2019s cuffs, satin peak lapels and jetted pockets applied to contemporary feminine silhouettes. Mirror of frey-tailored.com — checkout in USDC on Base, ships from Frey HK.',
    website:         'https://frey-tailored.com',
    shopifyDomain:   'frey-tailored.com',
    supportsSizing:  true,
    // HKD is USD-pegged (7.75-7.85 band since 1983). Lock a fixed rate for
    // the mirror run; drift is ~0.1%. Documented in Notion Phase 22 entry.
    sourceCurrency:  'HKD',
    priceToUsdcRate: 1 / 7.78, // locked 2026-04-16
    socialLinks:     { instagram: 'https://www.instagram.com/frey.tailored/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'passport-adv': {
    slug:            'passport-adv',
    name:            'PassportADV',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Footwear and apparel from Addis to LA.',
    description:     'PassportADV — Ethiopian-inflected streetwear and technical apparel designed out of Los Angeles. Mirror of passportadv.com — checkout in USDC on Base, ships from PassportADV.',
    website:         'https://www.passportadv.com',
    sourcePlatform:  'squarespace',
    squarespaceShopUrl: 'https://www.passportadv.com/shop-1',
    supportsSizing:  true,
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'bobby-joseph': {
    slug:            'bobby-joseph',
    name:            'BOBBYJOSEPH',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Uniquely designed, out of Los Angeles.',
    description:     'BOBBYJOSEPH: an assortment of uniquely designed goods out of Los Angeles. Limited-edition teddy bear charms, graphic-printed t-shirts and hoodies, headwear and single-speed bikes. Mirror of bobbyjoseph.com, checkout in USDC on Base, ships from BOBBYJOSEPH LA.',
    website:         'https://bobbyjoseph.com',
    shopifyDomain:   'bobbyjoseph.com',
    supportsSizing:  true,
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'university-of-diversity': {
    slug:            'university-of-diversity',
    name:            'University of Diversity',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Many backgrounds. One campus.',
    description:     'University of Diversity \u2014 collegiate-inflected apparel built around a single Arch Seal that stands for a shared campus across every background. Mirror of universityofdiversity.myshopify.com, checkout in USDC on Base, ships from UoD.',
    website:         'https://universityofdiversity.myshopify.com',
    shopifyDomain:   'universityofdiversity.myshopify.com',
    supportsSizing:  true,
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'mykle': {
    slug:            'mykle',
    name:            'MYKLÉ',
    // MYKLÉ brand agent, wallet minted 2026-04-18, ERC-8004 agent #45112
    wallet:          '0x9eb5405feF682E1d4d555f64a683A499076556a3',
    email:           'richard@entrepot.asia',
    headline:        'Precision. Emotion. Silk as language.',
    description:     'MYKL\u00c9 \u2014 silk scarves and ties by Norwegian designer Torunn Myklebust. Heritage florals, rope motifs and damier patterns rendered in silk, built for longevity over season. Mirror of mykle.co, checkout in USDC on Base, ships from MYKL\u00c9 France.',
    website:         'https://mykle.co',
    shopifyDomain:   'mykle.co',
    supportsSizing:  false,
    sourceCurrency:  'EUR',
    priceToUsdcRate: 1.18, // locked 2026-04-18, 1 EUR = $1.18 USDC
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'the-merchant-fox': {
    slug:            'the-merchant-fox',
    name:            'The Merchant Fox',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Fox Brothers cloth since 1772, finished into ties, knitwear and homewares.',
    description:     'The Merchant Fox is rooted in Fox Brothers of Wellington, Somerset, a British mill weaving worsted and woollen cloth at Tonedale since 1772. Fox pioneered flannel in 1803 and wove the khaki serge that uniformed the British Army; the archive runs deeper than most fashion houses have been alive. Curated by Douglas Cordeaux, The Merchant Fox turns that cloth into finished pieces: ties, knitwear, pocket squares, throws, cologne. Every item is tested by the curator and built to be repaired, not replaced. Mill-to-wearer, in one county. Mirror of themerchantfox.co.uk, checkout in USDC on Base, ships from The Counting House, Tonedale Mill.',
    website:         'https://www.themerchantfox.co.uk',
    shopifyDomain:   'www.themerchantfox.co.uk',
    supportsSizing:  true, // cricket slipover has XS-XL; other products are single-variant
    sourceCurrency:  'GBP',
    priceToUsdcRate: 1.35, // locked 2026-04-19, 1 GBP = $1.35 USDC
    socialLinks:     { instagram: 'https://www.instagram.com/themerchantfox/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'livvium': {
    slug:            'livvium',
    name:            'LIVVIUM',
    wallet:          '0x019d94b9c90abd38f84ebbb488e6c833cdeffc57',
    email:           'richard@entrepot.asia',
    headline:        'Phygital garments. Recycled cotton, NFC, AR, Digital Product Passport.',
    description:     'LIVVIUM builds connected garments that carry a second life beyond the thread. Each piece embeds an NFC tag at the hem, unlocking AR filters, a Digital Product Passport and access to the Sky Lounge member portal. Responsibly sourced recycled cotton, numbered editions, signed and assigned at random. Mirror of exposedlayers.com, checkout in USDC on Base, ships from LIVVIUM.',
    website:         'https://www.exposedlayers.com',
    shopifyDomain:   'www.exposedlayers.com',
    supportsSizing:  true, // S/M + L/XL variants on the tee
    sourceCurrency:  'AED',
    priceToUsdcRate: 1 / 3.6725, // AED is pegged to USD at 3.6725 since 1997
    editionOverride: 120, // limited run of 120 numbered editions per exposedlayers.com
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'les-basics': {
    slug:            'les-basics',
    name:            'LES BASICS',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Hi-vis refined. Reworked by hand in north London.',
    description:     'NYSM by LES BASICS is reworked urban visibility from a small north London studio. Hi-vis refined into everyday clothes for people who move through cities with purpose: deadstock, overlooked and vintage garments re-cut by hand, finished with reflective heat transfers, reflective-thread reworking and a signature zig-zag stitch square. Low-impact, circular, small-batch. Rumoured to mean New York Sado-Masochism, more likely Now You See Me. Mirror of lesbasics.net, checkout in USDC on Base, ships from LES BASICS UK.',
    website:         'https://lesbasics.net',
    shopifyDomain:   'lesbasics.net',
    supportsSizing:  false, // NYSM capsule items listed are single-size / one-size
    sourceCurrency:  'GBP',
    priceToUsdcRate: 1.35, // locked 2026-04-20, 1 GBP = $1.35 USDC (aligned with the-merchant-fox 2026-04-19)
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'washi-jeans': {
    slug:            'washi-jeans',
    name:            'WASHI',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Washi paper denim. Japanese heritage, woven for now.',
    description:     'WASHI (\u548c\u7d19) is a sustainable luxury denim label built around fabric woven from Japanese washi paper. Each pair pairs 45% WASHI N0.6 paper yarn for the weft with 55% indigo eco-rope dyed ecological cotton yarn for the warp — medium weight, non-stretch, strong 3D shaping, shape memory. Made in Japan, European sizing, reusable washi denim bag on every delivery. Mirror of washijeans.com, checkout in USDC on Base, ships from WASHI Japan.',
    website:         'https://washijeans.com',
    shopifyDomain:   'washijeans.com',
    supportsSizing:  true,
    sourceCurrency:  'HKD',
    priceToUsdcRate: 1 / 7.78, // HKD USD-peg, same rate as Frey Tailored (locked 2026-04-20)
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'gumball-3000': {
    slug:            'gumball-3000',
    name:            'Gumball 3000',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Rally. Racing. Rock and roll. Since 1999.',
    description:     'Gumball 3000 is a British lifestyle brand built around the annual 3,000-mile international motor rally founded in 1999 by Maximillion Cooper. Apparel, headwear, accessories, and occasional collab hardware like the Bang & Olufsen Beosound 2. Mirror of gumball3000.com, checkout in USDC on Base, ships from Gumball 3000.',
    website:         'https://gumball3000.com',
    shopifyDomain:   'gumball3000.com',
    supportsSizing:  true, // drivers jacket XS-XL, OG crewneck S-XXL
    sourceCurrency:  'GBP',
    priceToUsdcRate: 1.35, // locked 2026-04-20, 1 GBP = $1.35 USDC
    socialLinks:     { instagram: 'https://www.instagram.com/gumball3000/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'adapt': {
    slug:            'adapt',
    name:            'Adapt',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Alphanumeric x Adapt :: BACK TO SCHOOL.',
    description:     'Alphanumeric was a skateboarding and lifestyle brand founded in 1998, considered by many to be one of the first true "streetwear" brands of the 2000s and beyond. It also served as a significant inspiration in the formation of the Adapt brand. More than 25 years after its inception, Alphanumeric and Adapt are proud to announce their collaborative capsule collection, "Back To School". Alphanumeric + Adapt. Thank You, PEACE. Mirror of adaptclothing.com, checkout in USDC on Base, ships from Adapt.',
    website:         'https://adaptclothing.com',
    shopifyDomain:   'adaptclothing.com',
    supportsSizing:  true,
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'weinsanto': {
    slug:            'weinsanto',
    name:            'WEINSANTO',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Theatrical Parisian couture. Asymmetric drape, ruffles, performance.',
    description:     'WEINSANTO is the Paris label of French-Alsatian designer Victor Weinsanto, debuted on the Paris Fashion Week calendar in 2021. The house is known for theatrical runways drawing on dance and performance, with collections like "Murder in Paris", "Common Love" and "Perfect Day" built around asymmetric tailoring, draped pleats, ruffles and faux leather. Mirror of weinsanto.com, checkout in USDC on Base, ships from WEINSANTO Paris.',
    website:         'https://weinsanto.com',
    shopifyDomain:   'weinsanto.com',
    supportsSizing:  true, // berets, trousers, pants, tee all ship size variants
    sourceCurrency:  'EUR',
    priceToUsdcRate: 1.18, // locked 2026-04-20, 1 EUR = $1.18 USDC (aligned with MYKLÉ 2026-04-18)
    socialLinks:     { instagram: 'https://www.instagram.com/weinsanto/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'standard-and-strange': {
    slug:            'standard-and-strange',
    name:            'Standard & Strange',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Own fewer, better things.',
    description:     'Standard & Strange is a Berkeley-founded specialty apparel shop built around the idea of owning fewer, better things. Founded in 2012 by Neil Berrett and Jeremy Smith and named after a Jane Jacobs line celebrating "the standard with the strange, the large with the small", the shop curates heritage-grade clothing from Japanese, European and American makers: denim, leather, knitwear, footwear and accessories chosen to wear in, not out. Stores in Berkeley, Santa Fe and New York; ships from Berkeley. Mirror of standardandstrange.com, checkout in USDC on Base.',
    website:         'https://standardandstrange.com',
    shopifyDomain:   'standardandstrange.com',
    supportsSizing:  true,
    socialLinks:     { instagram: 'https://www.instagram.com/standardandstrange/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'de-la-soul': {
    slug:            'de-la-soul',
    name:            'De La Soul',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Native Tongues since 1988. Official store, on-chain.',
    description:     'De La Soul is the Long Island hip-hop trio that rewrote what rap could sound like. Formed in Amityville in 1988 by Posdnuos (Kelvin Mercer), Trugoy the Dove (David Jude Jolicoeur, 1968-2023) and Maseo (Vincent Mason), their debut 3 Feet High and Rising (1989) launched the Native Tongues movement: sample-rich, playful, daisy-age, daisy-age. Eight studio albums, a Grammy, a 30-year catalogue that finally returned to streaming in 2023, and a lifelong commitment to the craft. This is the official store: apparel, headwear, and accessories celebrating the records and the late Dave Jolicoeur. Mirror of store.wearedelasoul.com, checkout in USDC on Base, ships from De La Soul Official Store.',
    website:         'https://store.wearedelasoul.com',
    shopifyDomain:   'store.wearedelasoul.com',
    supportsSizing:  true, // tees + hoodies have size variants; slipmat and hat are single-size
    socialLinks:     { instagram: 'https://www.instagram.com/wearedelasoul/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'stuart-trevor': {
    slug:            'stuart-trevor',
    name:            'Stuart Trevor',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'AllSaints co-founder\u2019s solo label. Organic cotton, curated vintage, Underground England creepers.',
    description:     'Stuart Trevor is the eponymous London label of Stuart Trevor, co-founder of AllSaints (1994). Launched in 2018 around three pillars: brand-own apparel cut from GOTS-certified organic and recycled cotton (Saint and Dante\u2019s Inferno tees, ST-logo jeans, rugby shirts paying homage to Joy Division and other rock\u2019n\u2019roll touchstones); curated vintage and military surplus pulled from European stockists (RAF Ceremonial Mess Dress jackets, Bundeswehr Luftwaffe side caps, vintage ACNE wool coats); and a long-running collaboration with Underground England, the Wolverhampton creeper and commando boot maker that defined post-punk footwear from the late 1970s onward. Mirror of stuarttrevor.com, checkout in USDC on Base, ships from Stuart Trevor UK.',
    website:         'https://stuarttrevor.com',
    shopifyDomain:   'stuarttrevor.com',
    supportsSizing:  true, // tees S-XXL, boots run UK size matrix, vintage one-of-one
    sourceCurrency:  'GBP',
    priceToUsdcRate: 1.35, // locked 2026-04-20, 1 GBP = $1.35 USDC (aligned with Gumball 3000 same day)
    socialLinks:     { instagram: 'https://www.instagram.com/stuarttrevorofficial/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'shoyoroll': {
    slug:            'shoyoroll',
    name:            'Shoyoroll',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Jiu-jitsu kimonos, rash guards and apparel. Numbered batches, no restocks.',
    description:     'Shoyoroll is a Brazilian Jiu-Jitsu apparel label founded by Vini Aieta in 2006 and built around the numbered Batch kimono series — limited-run gis released in dated drops, rarely restocked, each with its own patchwork, cut and story. Alongside the Batches sit the Competition Standard gis, training rash guards, shorts, tees and accessories, all engineered for the mat first. Collected as much as they\u2019re worn. This is a selective mirror of five hand-picked pieces from shoyoroll.com — a competition kimono, a signature SSS kimono, a long-sleeve rash guard, the OG logo tee and a mat-side notepad. Checkout in USDC on Base, ships from Shoyoroll US.',
    website:         'https://shoyoroll.com',
    shopifyDomain:   'shoyoroll.com',
    supportsSizing:  true, // kimonos and apparel run full size runs (A0-A4, S-XXL)
    socialLinks:     { instagram: 'https://www.instagram.com/shoyoroll/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'eye-club': {
    slug:            'eye-club',
    name:            'Eye Club',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'British eyewear. Hand-crafted Italian acetate, titanium hinges, one price.',
    description:     'Eye Club is an independent British eyewear house running a single, focused line of sunglasses and optical frames. Every frame is cut from hand-crafted Italian acetate and hinged in titanium, sold at a single \u00a3220 price point regardless of silhouette or colourway. Wayfarers, cat-eyes, oversized rectangles, sculpted statement frames, translucent colour stories. This is a selective mirror of five frames from eye-club.co.uk covering the range\u2019s main silhouettes and a signal colourway from each: Walters (dark tortoise wayfarer), Falk (black/claret cat-eye), Brunner (emerald-green oversized rectangle), Hathorn (champagne-tortoise statement) and Norman (blush oversized wayfarer). Checkout in USDC on Base, ships from Eye Club UK.',
    website:         'https://www.eye-club.co.uk',
    shopifyDomain:   'www.eye-club.co.uk',
    supportsSizing:  false, // eyewear has no size matrix
    sourceCurrency:  'GBP',
    priceToUsdcRate: 1.35, // locked 2026-04-20, aligned with Gumball 3000 / Stuart Trevor same day
    socialLinks:     {},
    bannerLocal:     null,
    logoLocal:       null,
  },
  'goodhood': {
    slug:            'goodhood',
    name:            'Goodhood',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Shoreditch concept store since 2007. In-house Goodhood Worldwide line, plus curated streetwear and lifestyle.',
    description:     'Goodhood is a London concept store founded in 2007 by Kyle Stewart and Jo Sindle, rooted on Curtain Road in Shoreditch. The shop built its reputation on careful buying across streetwear, workwear, footwear, homewares and beauty, and has grown an in-house line, Goodhood Worldwide, alongside the stocked brands. Goodhood Worldwide covers tees, caps, jackets, sweatpants and occasional jewellery pieces, cut from sturdy cottons and finished with the shop\u2019s house graphics and signet motifs. This is a selective mirror of five Goodhood Worldwide pieces: WTAF cotton tee, Overdyed G sweatpant in washed orange, G Cap in camo, sterling silver round signet ring, and the black mechanics jacket. Mirror of goodhoodstore.com, checkout in USDC on Base, ships from Goodhood UK.',
    website:         'https://goodhoodstore.com',
    shopifyDomain:   'goodhoodstore.com',
    supportsSizing:  true,
    sourceCurrency:  'GBP',
    priceToUsdcRate: 1.35, // locked 2026-04-21, 1 GBP = $1.35 USDC (aligned with Eye Club 2026-04-20)
    socialLinks:     { instagram: 'https://www.instagram.com/goodhoodstore/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'vollebak': {
    slug:            'vollebak',
    name:            'Vollebak',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Clothing from the future. Copper, graphene, aerogel, eiderdown, indestructible.',
    description:     'Vollebak is a London science-and-fashion label founded in 2015 by twin brothers Steve and Nick Tidball. The brand builds clothing out of materials usually reserved for aerospace, medicine and the deep earth: copper yarn that kills bacteria on contact, graphene, aerogel from the Mars rover programme, and indestructible Dyneema composites. Worn by polar explorers, astronauts, climbers and deep-sea divers. Frequent TIME Best Inventions winners. This is a selective mirror of five signature pieces from vollebak.com: Full Metal Jacket in its silver copper edition, Martian Aerogel Jacket in rover orange, Eiderdown Puffer in obsidian black, Indestructible Chinos in sandstone, and the Graphene T-Shirt in black. Checkout in USDC on Base, ships from Vollebak UK.',
    website:         'https://vollebak.com',
    shopifyDomain:   'vollebak.com',
    supportsSizing:  true,
    sourceCurrency:  'GBP',
    priceToUsdcRate: 1.35, // locked 2026-04-21, 1 GBP = $1.35 USDC (aligned with Goodhood same day)
    socialLinks:     { instagram: 'https://www.instagram.com/vollebak/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  'cabourn': {
    slug:            'cabourn',
    name:            'Nigel Cabourn',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Vintage military, workwear and expedition. British design, Japanese make.',
    description:     'Nigel Cabourn is a British designer label founded in 1974, built on vintage military, workwear and expedition references. The label reissues and reworks garments from Cabourn\'s vast personal archive of military clothing, combining UK mill fabrics with Japanese construction. This is the Japanese storefront cabourn.jp, with an emphasis on made-in-Japan production. Selective mirror of five pieces: Gas Protect Camo Gunner Smock (Woman), Army Cargo Short (Man), Souvenir Jacket in cotton nylon weather cloth (Unisex), British Officers Shirt Type 2 in hemp (Woman), and Gunner Jacket in Taslan nylon (Unisex). Checkout in USDC on Base, ships from Cabourn Japan.',
    website:         'https://cabourn.jp',
    shopifyDomain:   'cabourn.jp',
    supportsSizing:  true,
    sourceCurrency:  'JPY',
    priceToUsdcRate: 1 / 150, // locked 2026-04-22, 1 USDC = 150 JPY
    socialLinks:     { instagram: 'https://www.instagram.com/nigelcabourn_official/' },
    bannerLocal:     null,
    logoLocal:       null,
    // Cabourn's JP site titles products as "【ナイジェル・ケーボン】<CAT> / <JP> / <EN>"
    // and bodies are mostly Japanese. Override with clean English copy per handle.
    productOverrides: {
      '80520830200': {
        title: 'Gas Protect Camo Gunner Smock (Woman)',
        description: 'A 1940s British Army gas-protection coat reworked in cotton typewriter cloth with an original Cabourn camouflage print. Cut on the gunner smock silhouette, built for the punishing environment inside artillery positions: a deep hood that wraps the head and covers up to the throat shields against hot gas and blast. Heritage utility in an unflinching, purpose-built form.',
      },
      '80520051012': {
        title: 'Army Cargo Short',
        description: 'British Army inspired cargo short cut in hardwearing cotton. Deep bellows pockets, reinforced stress points, relaxed field-ready silhouette with a clean above-the-knee cut. Built from Cabourn\'s archive research into mid-century tropical fatigues.',
      },
      '80520030006': {
        title: 'Souvenir Jacket, Cotton Nylon Weather',
        description: 'Reversible souvenir jacket in a cotton-nylon weather cloth. Motif embroidery front and back, weatherproofed face and soft lining, military surplus heritage filtered through Cabourn\'s travel-worn lens. A unisex silhouette cut for layering.',
      },
      '80520810003': {
        title: 'British Officers Shirt Type 2, Hemp (Woman)',
        description: 'British officers shirt rendered in breathable hemp and cut for women. Two patch chest pockets, soft epaulettes, band collar and mother-of-pearl buttons, with a longer length and feminine proportions. A Cabourn archive staple reworked for modern wear.',
      },
      '80510030001': {
        title: 'Gunner Jacket, Taslan Nylon',
        description: 'The gunner jacket rebuilt in technical Taslan nylon: lightweight, water-resistant and packable. Four utility pockets, storm flap, adjustable hem and cuffs. Cabourn\'s artillery-crew archetype in an every-day shell weight, unisex fit.',
      },
    },
  },
  'nolo': {
    slug:            'nolo',
    name:            'Nolo',
    // Nolo brand agent, wallet minted 2026-04-17, ERC-8004 agent #45040
    wallet:          '0x891C13aA323378637404EfD971553A3a6df5aAf1',
    email:           'richard@entrepot.asia',
    headline:        'Decaf cold brew oat lattes, without the compromise.',
    description:     'Nolo is a UK decaf cold brew oat latte brand. Classic, Caramel Swirl, and a Decaf Double Bundle, sold by the pack. Mirror of wearenolo.com, checkout in USDC on Base, ships from Nolo UK.',
    website:         'https://wearenolo.com',
    shopifyDomain:   'wearenolo.com',
    supportsSizing:  true, // pack-count ("12 Cans"/"24 Cans"/"36 Cans") imported as size variants
    sourceCurrency:  'GBP',
    priceToUsdcRate: 1.27, // locked 2026-04-17, 1 GBP = $1.27 USDC
    socialLinks:     { instagram: 'https://www.instagram.com/wearenolo/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
  '13-de-marzo': {
    slug:            '13-de-marzo',
    name:            '13DE MARZO',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Chinese streetwear, built around the teddy bear. Plush textures, character collabs, cross-season knits.',
    description:     '13DE MARZO is a Shanghai-based streetwear label founded by designer Dong Bing in 2016, built around an instantly recognisable cast of plush teddy bear characters (Fur Mario, Doozoo, Kuromi collabs) and a design language of melted logos, fuzzy textures and oversized jewellery. The brand runs a global storefront at 13demarzo.net priced in EUR and ships worldwide. Selective mirror of five pieces across five categories: Doozoo Flip Flops (summer slip-on footwear), Graffiti Logo Denim Bucket Hat (headwear), Kuromi Bear Cellphone T-Shirt (Sanrio collab graphic tee), Bear Hug Star Ring (silver statement jewellery) and Tibe Hunting Totem Bag (utility shoulder bag). Checkout in USDC on Base, ships from 13DE MARZO.',
    website:         'https://13demarzo.net',
    shopifyDomain:   '13demarzo.net',
    supportsSizing:  true,
    sourceCurrency:  'EUR',
    priceToUsdcRate: 1.08, // locked 2026-04-22, 1 EUR = $1.08 USDC
    socialLinks:     { instagram: 'https://www.instagram.com/13demarzo_official/' },
    bannerLocal:     null,
    logoLocal:       null,
    // Native titles all begin "13DE MARZO …" — strip the brand prefix and
    // provide clean marketing copy (native bodies are mostly empty).
    productOverrides: {
      '13de-marzo-doozoo-flip-flops': {
        title: 'Doozoo Flip Flops',
        description: 'Leather flip flops built on a thick stacked sole for added height and all-day comfort. A fixed bear charm rides on the toe strap, heart-stitched insoles cushion underfoot, and the outsole carries a custom 13DE MARZO repeat logo with embossed branding on the strap. The house\u2019s Doozoo character in a summer slip-on.',
      },
      '13de-marzo-kuromi-bear-cellphone-t-shirt': {
        title: 'Kuromi Bear Cellphone T-Shirt',
        description: 'Official 13DE MARZO x Kuromi collaboration tee. Heavyweight cotton jersey with a front graphic of the house teddy bear clutching a novelty cellphone rendered in Kuromi\u2019s punk-pink palette. Boxy relaxed fit, ribbed crew, dropped shoulder. From the Sanrio capsule that put 13DE MARZO on the global character-collab map.',
      },
      '13de-marzo-graffiti-logo-denim-bucket-hat': {
        title: 'Graffiti Logo Denim Bucket Hat',
        description: 'Washed denim bucket hat with an all-over graffiti-print 13DE MARZO wordmark and the house bear silhouette stitched to the crown. Structured short brim, eyelet vents, cotton sweatband. Sits between a workwear cap and a late-\u201990s Y2K bucket.',
      },
      '13de-marzo-bear-hug-star-ring': {
        title: 'Bear Hug Star Ring',
        description: 'Sterling-silver statement ring cast as the house teddy bear wrapped around a faceted star. Chunky proportions, high-polish finish and stackable band profile. One of the signature silhouettes from 13DE MARZO\u2019s jewellery line, genderless sizing.',
      },
      '13de-marzo-tibe-hunting-totem-bag': {
        title: 'Tibe Hunting Totem Bag',
        description: 'Cross-body utility bag from the Tibe Hunting capsule. Panelled nylon and leather body, totem-carved hardware, an adjustable webbing strap and a zipped main compartment with inner organiser pockets. Big enough for a 12-inch tablet, structured enough to keep its shape empty. Genderless.',
      },
    },
  },
  'stadium-goods': {
    slug:            'stadium-goods',
    name:            'Stadium Goods',
    wallet:          '0x734a25fB869ab6415b78bbe9a39f1f99dab349E7',
    email:           'richard@entrepot.asia',
    headline:        'Sneaker archive. Museum-grade resale, consigned in New York.',
    description:     'Stadium Goods is a New York sneaker and streetwear consignment marketplace founded in 2015 by John McPheters and Jed Stiller, acquired by Farfetch in 2018 for $250m and now part of Coupang. The SoHo flagship and 47,000 sq ft New Jersey warehouse stock deadstock, historical collabs and archive grails authenticated in-house by a sneaker-specialist team. Selective mirror of stadiumgoods.com, USD native, full size run with per-size pricing reflecting real secondary-market scarcity. Checkout in USDC on Base, ships from Stadium Goods NYC.',
    website:         'https://www.stadiumgoods.com',
    shopifyDomain:   'www.stadiumgoods.com',
    supportsSizing:  true,
    // USD native, 1:1 USDC (no sourceCurrency / priceToUsdcRate needed)
    // Merchant type: authenticated resale marketplace. Enhancement runs
    // the reseller-prompt profile so every product lands with auth anchors
    // (retail_sku, original_release, authenticator, provenance).
    merchantType:    'reseller_authenticated',
    defaultAuthenticationStatus: 'Authenticated by Stadium Goods in-house sneaker authentication team (SoHo NYC, since 2015; ~47,000 sq ft NJ authentication warehouse). Every pair is inspected and tagged before shipping.',
    // Category hint flows into rrg_brands.brand_data.category_hint and is
    // read by scripts/enhance-descriptions.mjs resolveCategory() so the
    // watches/footwear/bags-specific attribute schema is used for every
    // product without relying on title keyword matches.
    categoryHint:    'footwear',
    socialLinks:     { instagram: 'https://www.instagram.com/stadiumgoods/' },
    bannerLocal:     null,
    logoLocal:       null,
  },
};

// ── Load .env.local ──────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env.local');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const k = m[1].trim();
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  }
} catch {
  console.error('FATAL: could not read .env.local');
  process.exit(1);
}

const requireEnv = (k) => {
  if (!process.env[k]) { console.error(`FATAL: ${k} not set`); process.exit(1); }
  return process.env[k];
};

const SUPABASE_URL = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
const RPC_URL      = requireEnv('NEXT_PUBLIC_BASE_RPC_URL');
const RRG_ADDR     = requireEnv('NEXT_PUBLIC_RRG_CONTRACT_ADDRESS');
const DEPLOYER_PK  = requireEnv('DEPLOYER_PRIVATE_KEY');
const BUCKET       = 'rrg-submissions';

// ── CLI flags ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || true) : null;
};

const BRAND_KEY  = flag('--brand');
const ONLY       = flag('--only');
const HANDLES    = flag('--handles');
const CACHE_FILE = flag('--cache-file');
const DRY_RUN    = args.includes('--dry-run');
const SEED_ONLY  = args.includes('--seed-only');
const NO_ENHANCE = args.includes('--no-enhance');
// Chain registration is now OPT-IN (safer default for pilots, onboarding
// agents, and re-runs). Pass --commit-chain to actually call registerDrop on
// Base mainnet. `--skip-chain` is still accepted as a no-op alias.
const COMMIT_CHAIN = args.includes('--commit-chain');
const SKIP_CHAIN   = !COMMIT_CHAIN; // inverted — chain is skipped unless explicitly committed
if (args.includes('--skip-chain') && COMMIT_CHAIN) {
  console.error('FATAL: cannot pass both --skip-chain and --commit-chain');
  process.exit(1);
}

if (!BRAND_KEY || !BRANDS[BRAND_KEY]) {
  console.error(`Usage: node scripts/brand-mirror.mjs --brand <slug>`);
  console.error(`Available: ${Object.keys(BRANDS).join(', ')}`);
  process.exit(1);
}

const CFG = BRANDS[BRAND_KEY];
const handleFilter = ONLY
  ? new Set([ONLY])
  : (HANDLES ? new Set(String(HANDLES).split(',').map(h => h.trim()).filter(Boolean)) : null);

const PLATFORM = CFG.sourcePlatform || 'shopify';
if (PLATFORM === 'shopify' && !CFG.shopifyDomain) {
  console.error('FATAL: shopify brand missing shopifyDomain'); process.exit(1);
}
if (PLATFORM === 'squarespace' && !CFG.squarespaceShopUrl) {
  console.error('FATAL: squarespace brand missing squarespaceShopUrl'); process.exit(1);
}

console.log(`──── Brand Mirror: ${CFG.name} ────`);
console.log(`Platform:  ${PLATFORM}`);
console.log(`Source:    ${PLATFORM === 'shopify' ? CFG.shopifyDomain : CFG.squarespaceShopUrl}`);
console.log(`Sizing:    ${CFG.supportsSizing ? 'YES' : 'no'}`);
console.log(`Dry run:   ${DRY_RUN ? 'YES' : 'no'}`);
console.log(`Chain:     ${SKIP_CHAIN ? 'SKIP (pass --commit-chain to register on-chain)' : 'COMMIT (on-chain registerDrop enabled)'}`);
console.log(`Filter:    ${handleFilter ? Array.from(handleFilter).join(', ') : '<all>'}`);
console.log();

// ── Clients ──────────────────────────────────────────────────────────
const db       = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer   = new ethers.Wallet(DEPLOYER_PK, provider);
const RRG_ABI  = [
  'function registerDrop(uint256 tokenId, address creator, uint256 priceUsdc6dp, uint256 maxSupply) external',
  'function getDrop(uint256 tokenId) external view returns (tuple(address creator, uint256 priceUsdc, uint256 maxSupply, uint256 minted, bool active))',
];
const rrg = new ethers.Contract(RRG_ADDR, RRG_ABI, signer);

let _nextNonce = null;
async function nextNonce() {
  if (_nextNonce === null) {
    _nextNonce = await signer.getNonce('latest');
  }
  return _nextNonce++;
}

const toUsdc6dp = (n) => BigInt(Math.round(n * 1_000_000));
const stripHtml = (h) => (h ?? '')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

const detectImage = (buf) => {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF)
    return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)
    return { ext: 'png', mime: 'image/png' };
  if (buf.length >= 12 && buf.slice(0,4).toString() === 'RIFF' && buf.slice(8,12).toString() === 'WEBP')
    return { ext: 'webp', mime: 'image/webp' };
  return null;
};

// ────────────────────────────────────────────────────────────────────
// PHASE 1 — Seed brand
// ────────────────────────────────────────────────────────────────────
async function ensureBrand() {
  console.log(`[seed] looking up brand slug=${CFG.slug}…`);
  const { data: existing } = await db
    .from('rrg_brands')
    .select('*')
    .eq('slug', CFG.slug)
    .maybeSingle();

  let brand = existing;

  if (!brand) {
    if (DRY_RUN) {
      console.log('[seed] DRY: would insert brand row — continuing with in-memory stub');
      return {
        id: '00000000-0000-0000-0000-000000000000',
        slug: CFG.slug,
        name: CFG.name,
        self_listings_used: 0,
      };
    }
    const id = randomUUID();
    // merchant_type drives how enhance-descriptions prompts the LLM and
    // how the MCP projection decides whether to surface authentication
    // anchors. Stored in the free-form brand_data JSON (no schema change
    // needed — Record<string, unknown> per lib/rrg/db.ts).
    const merchantType = CFG.merchantType ?? 'direct_brand';
    const brandData = {
      merchant_type: merchantType,
      ...(CFG.defaultAuthenticationStatus ? { default_authentication_status: CFG.defaultAuthenticationStatus } : {}),
      ...(CFG.categoryHint ? { category_hint: CFG.categoryHint } : {}),
    };
    const insert = {
      id,
      slug:               CFG.slug,
      name:               CFG.name,
      headline:           CFG.headline,
      description:        CFG.description,
      website_url:        CFG.website,
      contact_email:      CFG.email,
      wallet_address:     CFG.wallet.toLowerCase(),
      status:             'active',
      max_self_listings:  30,
      self_listings_used: 0,
      tc_accepted_at:     new Date().toISOString(),
      tc_version:         '1.0',
      social_links:       CFG.socialLinks ?? {},
      shopify_domain:     CFG.shopifyDomain,
      supports_sizing:    CFG.supportsSizing ?? false,
      brand_data:         brandData,
    };
    const { data, error } = await db.from('rrg_brands').insert(insert).select().single();
    if (error) { console.error('[seed] insert failed:', error); process.exit(1); }
    brand = data;
    console.log(`[seed] created brand id=${brand.id} merchant_type=${merchantType}`);
  } else {
    console.log(`[seed] found existing brand id=${brand.id}`);
    // Always update merchant_type + default_authentication_status from
    // the canonical BRANDS config, so changes there flow through.
    const merchantType = CFG.merchantType ?? 'direct_brand';
    const existingData = (existing.brand_data ?? {});
    const nextData = {
      ...existingData,
      merchant_type: merchantType,
      ...(CFG.defaultAuthenticationStatus ? { default_authentication_status: CFG.defaultAuthenticationStatus } : {}),
      ...(CFG.categoryHint ? { category_hint: CFG.categoryHint } : {}),
    };
    const updates = { brand_data: nextData };
    if (!existing.shopify_domain && CFG.shopifyDomain) {
      updates.shopify_domain = CFG.shopifyDomain;
      updates.supports_sizing = CFG.supportsSizing ?? false;
    }
    await db.from('rrg_brands').update(updates).eq('id', brand.id);
    console.log(`[seed] synced brand_data (merchant_type=${merchantType})`);
    brand.brand_data = nextData;
  }

  return brand;
}

// Regex used to auto-flag a per-product resale_mode override. A direct-brand
// storefront can still carry the occasional archive / vintage piece that
// needs reseller-style anchors — these Shopify tags/product_type values
// trigger the override at import time without the operator having to
// hand-curate the brand.
const RESALE_HINT_RE = /\b(archive|vintage|consignment|pre-?loved|deadstock|resale)\b/i;

// ────────────────────────────────────────────────────────────────────
// PHASE 2 — Import products with full variant matrix
// ────────────────────────────────────────────────────────────────────

async function fetchShopify() {
  // Offline path: when --cache-file points to a local JSON with the
  // { products: [...] } shape, skip the HTTP fetch entirely. Used when the
  // source Shopify host rate-limits or blocks our egress (e.g. Stadium Goods
  // after a pagination burst triggers their anti-scraping). File must be
  // produced by a prior successful fetch or hand-assembled from single-product
  // /products/{handle}.json responses.
  if (CACHE_FILE && typeof CACHE_FILE === 'string') {
    const resolved = resolve(CACHE_FILE);
    console.log(`[shopify] reading cache file ${resolved}`);
    const raw = readFileSync(resolved, 'utf8');
    const json = JSON.parse(raw);
    const products = json.products ?? [];
    console.log(`[shopify] loaded ${products.length} product(s) from cache`);
    return products;
  }

  // Fast path: when --only is set to a single handle, fetch just that
  // product via /products/{handle}.json instead of paginating the whole
  // catalogue. Avoids rate limits on large stores (e.g. Stadium Goods'
  // ~4k-product catalogue hit 429 on page 18 before this was added).
  if (ONLY && !ONLY.includes(',')) {
    const url = `https://${CFG.shopifyDomain}/products/${ONLY}.json`;
    console.log(`[shopify] GET ${url} (single-product fast path)`);
    const res = await fetch(url, {
      headers: {
        'User-Agent':      'RRG-Mirror/2.0',
        'Accept':          'application/json',
        'Accept-Language': '',
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Shopify ${res.status} for handle ${ONLY}`);
    const json = await res.json();
    const product = json.product;
    if (!product) throw new Error(`No product in response for handle ${ONLY}`);
    console.log(`[shopify] fetched 1 product via fast path`);
    return [product];
  }

  // Shopify caps products.json at 250 per page; walk pages until the response
  // is short (end of catalogue) or a safety cap is hit.
  //
  // NB: Shopify's multi-currency routing will return localised prices if the
  // request carries an Accept-Language header (Node's fetch adds a default).
  // We force Accept-Language: "" so Shopify serves the shop's BASE currency
  // (the one defined in the Shopify admin) — that's what CFG.priceToUsdcRate
  // expects when converting to USDC.
  const MAX_PAGES = 25; // up to 6,250 products (Goodhood has ~4,000+; bumped 2026-04-21)
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://${CFG.shopifyDomain}/products.json?limit=250&page=${page}`;
    console.log(`[shopify] GET ${url}`);
    const res = await fetch(url, {
      headers: {
        'User-Agent':      'RRG-Mirror/2.0',
        'Accept':          'application/json',
        'Accept-Language': '', // critical — see note above
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Shopify ${res.status} on page ${page}`);
    const json = await res.json();
    const batch = json.products ?? [];
    all.push(...batch);
    if (batch.length < 250) break; // last page
  }
  console.log(`[shopify] received ${all.length} products (across pages)`);
  return all;
}

/**
 * Fetch from Squarespace `?format=json` and normalize to the Shopify-compatible
 * shape the rest of this script consumes (product.variants[].option1/2/3,
 * product.options[], product.images[].src, etc).
 *
 * Squarespace's JSON endpoint is undocumented but stable — see
 * lib/squarespace/products-json.ts for notes.
 */
async function fetchSquarespace() {
  const parseShopUrl = (u) => {
    const url = new URL(u);
    return { origin: url.origin, path: url.pathname.replace(/\/$/, '') };
  };
  const { origin, path } = parseShopUrl(CFG.squarespaceShopUrl);

  const all = [];
  let offset;
  for (let page = 0; page < 20; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const offsetPart = offset ? `&offset=${offset}` : '';
    const url = `${origin}${path}${sep}format=json${offsetPart}`;
    console.log(`[squarespace] GET ${url}`);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RRG-Mirror/2.0', 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Squarespace ${res.status} on ${url}`);
    const data = await res.json();
    const items = data.items ?? [];

    for (const item of items) {
      const sqsVariants = item.structuredContent?.variants ?? [];

      // Derive option schema from the union of variant attribute keys, in the
      // order Squarespace provides via variantOptionOrdering (if present).
      const ordering = item.structuredContent?.variantOptionOrdering
        ?? (sqsVariants[0]?.attributes ? Object.keys(sqsVariants[0].attributes) : []);
      const options = ordering.map((name) => ({ name }));

      const variants = sqsVariants.map((v, idx) => {
        const attrs = v.attributes ?? {};
        const opts = ordering.map((k) => attrs[k] ?? null);
        return {
          id: v.id, // Squarespace UUID string
          title: Object.values(attrs).join(' / ') || 'Default',
          price: (v.price / 100).toFixed(2),
          compare_at_price: null,
          sku: v.sku || null,
          available: v.unlimited || (v.qtyInStock > 0),
          // For `unlimited: true` Squarespace variants, treat stock as unknown
          // and let getTotalStock() fall back to counting available variants
          // (1 unit each). Using qtyInStock verbatim when a finite cap is set.
          inventory_quantity: v.unlimited ? 0 : (v.qtyInStock ?? 0),
          position: idx + 1,
          option1: opts[0] ?? null,
          option2: opts[1] ?? null,
          option3: opts[2] ?? null,
        };
      });

      // Single-variant fallback so `product.variants[0]` always exists.
      if (variants.length === 0) {
        variants.push({
          id: `${item.id}-default`,
          title: 'Default',
          price: ((item.structuredContent?.priceCents ?? item.priceCents ?? 0) / 100).toFixed(2),
          compare_at_price: null,
          sku: null,
          available: true,
          inventory_quantity: 1,
          position: 1,
          option1: null, option2: null, option3: null,
        });
      }

      const imageList = (item.items ?? []).filter(i => i.assetUrl);
      const images = imageList.length
        ? imageList
            .slice()
            .sort((a, b) => (a.displayIndex ?? 0) - (b.displayIndex ?? 0))
            .map((img, idx) => ({ id: img.id, src: img.assetUrl, position: idx + 1 }))
        : item.assetUrl
          ? [{ id: item.id, src: item.assetUrl, position: 1 }]
          : [];

      all.push({
        id: item.id,
        title: item.title,
        handle: item.urlId,
        // Squarespace product URLs aren't `/products/<handle>` — keep the real path.
        sourceUrl: `${origin}${item.fullUrl}`,
        body_html: item.body ?? item.excerpt ?? null,
        vendor: null,
        product_type: null,
        tags: item.tags ?? [],
        options,
        variants,
        images,
      });
    }

    if (!data.pagination?.nextPage || !data.pagination?.nextPageOffset) break;
    offset = data.pagination.nextPageOffset;
  }
  console.log(`[squarespace] received ${all.length} products`);
  return all;
}

async function fetchProducts() {
  return PLATFORM === 'squarespace' ? fetchSquarespace() : fetchShopify();
}

async function claimNextTokenId() {
  const { data: cfg, error: e1 } = await db
    .from('rrg_config').select('value').eq('key', 'next_token_id').single();
  if (e1) throw new Error(`rrg_config read: ${e1.message}`);
  const current = parseInt(cfg.value, 10);
  const next = current + 1;
  const { error: e2 } = await db
    .from('rrg_config').update({ value: String(next) }).eq('key', 'next_token_id');
  if (e2) throw new Error(`rrg_config update: ${e2.message}`);
  return current;
}

// Supabase upload cap we've observed in practice (~5MB). Shopify hi-res source
// PNGs regularly breach that, so cap width and fall back progressively if the
// payload still comes back too big. Only applies to Shopify CDN URLs (they
// accept ?width= as a resize param); other hosts pass through unchanged.
const MAX_IMAGE_BYTES = 5_000_000;
const SHOPIFY_WIDTHS  = [2000, 1600, 1200];

function withShopifyWidth(url, width) {
  if (!/cdn\.shopify\.com/.test(url)) return url;
  const u = new URL(url);
  u.searchParams.set('width', String(width));
  return u.toString();
}

async function downloadImage(url) {
  const candidates = /cdn\.shopify\.com/.test(url)
    ? [url, ...SHOPIFY_WIDTHS.map(w => withShopifyWidth(url, w))]
    : [url];

  let lastBuf = null;
  for (const u of candidates) {
    const res = await fetch(u, { headers: { 'User-Agent': 'RRG-Mirror/2.0' } });
    if (!res.ok) throw new Error(`image ${u} → ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    lastBuf = buf;
    if (buf.length <= MAX_IMAGE_BYTES) return buf;
    console.log(`  [img] ${buf.length} bytes > cap, retrying smaller variant`);
  }
  // All candidates too big — return the smallest (last) and let upload fail loud
  return lastBuf;
}

/**
 * Count available variants. Shopify's public products.json exposes
 * `available` (boolean) reliably but often hides `inventory_quantity`.
 * Use `available` as the source of truth.
 */
function getAvailableCount(product) {
  return (product.variants ?? []).filter(v => v.available === true).length;
}

function getTotalStock(product) {
  // If inventory_quantity is available and > 0, use it; otherwise count available variants
  const qtySum = (product.variants ?? []).reduce((sum, v) => {
    const q = parseInt(v.inventory_quantity, 10);
    return sum + (isNaN(q) ? 0 : Math.max(0, q));
  }, 0);
  if (qtySum > 0) return qtySum;
  // Fallback: count each available variant as 1 unit of stock
  return getAvailableCount(product);
}

async function importProduct(product, brand) {
  const handle  = product.handle;
  // Per-product overrides let us ship clean English copy for brands whose
  // native catalogue is localised (e.g. cabourn.jp ships JP + EN smashed
  // together). Shape: productOverrides[handle] = { title?, description? }.
  const override = CFG.productOverrides?.[handle] ?? {};
  const title   = override.title ?? product.title;
  const variant = product.variants?.[0];
  const image   = product.images?.[0];

  if (!variant) { console.warn(`[skip ${handle}] no variant`); return null; }
  if (!image)   { console.warn(`[skip ${handle}] no image`); return null; }

  // Convert shop-currency price → USDC (1:1 for USD brands, scaled for HKD etc.)
  const rawPrice = parseFloat(variant.price);
  const rate     = Number.isFinite(CFG.priceToUsdcRate) && CFG.priceToUsdcRate > 0 ? CFG.priceToUsdcRate : 1;
  const price    = Math.round(rawPrice * rate * 100) / 100;
  if (!Number.isFinite(price) || price < 0.01 || price > 10000) {
    console.warn(`[skip ${handle}] price out of range: ${variant.price} ${CFG.sourceCurrency ?? 'USD'} → ${price} USDC`);
    return null;
  }

  // Check stock — skip items with 0 stock unless --force-import is set
  const totalStock = getTotalStock(product);
  const FORCE_IMPORT = args.includes('--force-import');
  if (totalStock <= 0 && !FORCE_IMPORT) {
    console.warn(`[skip ${handle}] no stock (${totalStock}) — use --force-import to override`);
    return null;
  }

  // Dedupe by title within brand
  const { data: existing } = await db
    .from('rrg_submissions')
    .select('id, token_id')
    .eq('brand_id', brand.id)
    .eq('title', title)
    .maybeSingle();

  if (existing) {
    console.log(`[exists ${handle}] already imported as token #${existing.token_id} — syncing variants`);
    await syncVariants(existing.id, product);
    return existing;
  }

  // Edition size = total stock across all variants at time of listing,
  // unless the brand declares a fixed numbered edition (e.g. LIVVIUM's 120).
  const editionSize = Number.isFinite(CFG.editionOverride) && CFG.editionOverride > 0
    ? CFG.editionOverride
    : Math.max(1, totalStock);

  console.log(`[import ${handle}] $${price.toFixed(2)} USDC, edition ${editionSize} (from stock), ${product.variants.length} variants`);

  if (DRY_RUN) {
    console.log(`[import ${handle}] DRY — would upload image, claim tokenId, registerDrop, insert row + variants`);
    return null;
  }

  // Download + upload hero image
  const imgBuf = await downloadImage(image.src);
  const fmt = detectImage(imgBuf);
  if (!fmt) throw new Error(`${handle} image not jpeg/png/webp`);

  const submissionId = randomUUID();
  // Supabase storage keys reject non-ASCII — sanitize the Shopify handle
  // (some brands include unicode like ® or accented chars).
  const safeHandle   = handle.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'item';
  const filename     = `${CFG.slug}-${safeHandle}-${Date.now()}.${fmt.ext}`;
  const path         = `submissions/${submissionId}/jpeg/${filename}`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, imgBuf, {
    contentType: fmt.mime, upsert: false,
  });
  if (upErr) throw new Error(`image upload: ${upErr.message}`);

  // Upload up to 5 additional product images for the PPD modal gallery.
  // Shopify `product.images` includes the hero as images[0] — skip it.
  const EXTRA_IMAGE_CAP = 5;
  const physicalImagesPaths = [];
  const extraImages = (product.images ?? []).slice(1, 1 + EXTRA_IMAGE_CAP);
  for (let i = 0; i < extraImages.length; i++) {
    const extra = extraImages[i];
    try {
      const buf = await downloadImage(extra.src);
      const f   = detectImage(buf);
      if (!f) { console.warn(`  [extra-img ${i+1}] not jpeg/png/webp, skipping`); continue; }
      const fn  = `${CFG.slug}-${safeHandle}-aux-${i+1}-${Date.now()}.${f.ext}`;
      const p   = `submissions/${submissionId}/jpeg/${fn}`;
      const { error: e } = await db.storage.from(BUCKET).upload(p, buf, {
        contentType: f.mime, upsert: false,
      });
      if (e) { console.warn(`  [extra-img ${i+1}] upload failed: ${e.message}`); continue; }
      physicalImagesPaths.push(p);
    } catch (err) {
      console.warn(`  [extra-img ${i+1}] error: ${err.message}`);
    }
  }
  if (physicalImagesPaths.length > 0) {
    console.log(`  [extra-imgs] uploaded ${physicalImagesPaths.length} additional image(s)`);
  }

  // Claim tokenId
  const tokenId = await claimNextTokenId();

  // On-chain registerDrop
  if (!SKIP_CHAIN) {
    const nonce = await nextNonce();
    console.log(`  → registerDrop(${tokenId}, ${CFG.wallet}, ${toUsdc6dp(price)}, ${CFG.fixedEdition})  [nonce=${nonce}]`);
    const tx = await rrg.registerDrop(
      tokenId,
      CFG.wallet,
      toUsdc6dp(price),
      editionSize,
      { nonce },
    );
    const receipt = await tx.wait(1);
    console.log(`  → mined ${receipt.hash}`);
  } else {
    console.log(`  → SKIP_CHAIN: skipping registerDrop for token #${tokenId}`);
  }

  // Insert rrg_submissions row
  const description = (override.description ?? stripHtml(product.body_html)).slice(0, 1500) || null;

  // Seed product_attributes with what we can derive from Shopify WITHOUT an
  // LLM call. These are the non-visual anchors an agent needs to match
  // against its own knowledge (SKU, vendor, release year hint from tags).
  // The enhance step runs afterwards and merges image-derived fields on top,
  // but won't overwrite these structured facts.
  const vendor      = typeof product.vendor === 'string' ? product.vendor : null;
  const productType = typeof product.product_type === 'string' ? product.product_type : null;
  const rawTags     = typeof product.tags === 'string'
    ? product.tags.split(',').map(t => t.trim()).filter(Boolean)
    : Array.isArray(product.tags) ? product.tags : [];
  const firstVariantSku = product.variants?.[0]?.sku ?? null;
  // Stadium Goods encodes SKUs like "176023|AA3834 100|10.5" — split on pipe
  // and prefer the middle segment (the actual Nike/brand style code) if it
  // looks like one; otherwise use the raw SKU.
  let retailSku = firstVariantSku;
  if (typeof firstVariantSku === 'string' && firstVariantSku.includes('|')) {
    const parts = firstVariantSku.split('|').map(p => p.trim());
    const styleLike = parts.find(p => /^[A-Z]{2,}\s?\d{3,}/.test(p));
    retailSku = styleLike ?? parts[0] ?? firstVariantSku;
  }

  const merchantType = (brand.brand_data ?? {}).merchant_type ?? CFG.merchantType ?? 'direct_brand';
  const brandDefaultAuth = (brand.brand_data ?? {}).default_authentication_status ?? CFG.defaultAuthenticationStatus ?? null;

  // Per-product resale override: direct-brand storefronts sometimes carry a
  // one-off archive piece. If the product's tags or type hit the resale
  // regex, flip resale_mode=true so enhance-descriptions uses the reseller
  // prompt for this row even though the brand itself is direct.
  const perProductResale = RESALE_HINT_RE.test(rawTags.join(' ')) || RESALE_HINT_RE.test(productType ?? '');

  const seededAttributes = {
    vendor,
    product_type: productType,
    shopify_tags: rawTags,
    ...(retailSku ? { retail_sku: retailSku } : {}),
    ...(vendor ? { brand_vendor: vendor } : {}),
    ...(perProductResale ? { resale_mode: true } : {}),
    ...(merchantType === 'reseller_authenticated' && brandDefaultAuth
        ? { authentication_status: brandDefaultAuth }
        : {}),
    _merchant_type_at_import: merchantType,
  };

  const insertRow = {
    id:                  submissionId,
    creator_wallet:      CFG.wallet.toLowerCase(),
    creator_email:       CFG.email,
    title:               title.slice(0, 60),
    description,
    submission_channel:  'brand',
    status:              'approved',
    jpeg_storage_path:   path,
    jpeg_filename:       filename,
    jpeg_size_bytes:     imgBuf.length,
    brand_id:            brand.id,
    creator_type:        'human',
    is_brand_product:    true,
    token_id:            tokenId,
    edition_size:        editionSize,
    price_usdc:          price.toFixed(2),
    approved_at:         new Date().toISOString(),
    network:             'base',
    is_physical_product: true,
    physical_images_paths: physicalImagesPaths.length > 0 ? physicalImagesPaths : null,
    ecommerce_url:       product.sourceUrl
                          ?? `https://${CFG.shopifyDomain}/products/${handle}`,
    shipping_type:       'quote_after_payment',
    refund_commitment:   true,
    trust_behavior_accepted: true,
    has_voucher:         false,
    // Pre-publish guard: stay hidden until the enhance step completes
    // successfully. getApprovedDrops already filters hidden=false, so this
    // keeps unenhanced products out of MCP and the storefront. The enhance
    // step flips hidden=false on success. Opt out with --no-enhance.
    hidden:              NO_ENHANCE ? false : true,
    product_attributes:  seededAttributes,
  };
  const { error: insErr } = await db.from('rrg_submissions').insert(insertRow);
  if (insErr) throw new Error(`insert submission: ${insErr.message}`);

  // Insert variants
  await syncVariants(submissionId, product);

  // Bump self_listings_used
  await db.from('rrg_brands')
    .update({ self_listings_used: (brand.self_listings_used ?? 0) + 1 })
    .eq('id', brand.id);
  brand.self_listings_used = (brand.self_listings_used ?? 0) + 1;

  console.log(`  ✓ token #${tokenId} → /rrg/drop/${tokenId} (${product.variants.length} variants)`);
  return { id: submissionId, token_id: tokenId };
}

/**
 * Determine which option position holds size vs color based on Shopify's
 * product.options array. Some brands use option1=Size, others option1=Color.
 * Returns { sizeIdx, colorIdx } where 0/1/2 map to option1/option2/option3.
 */
function detectOptionPositions(product) {
  const options = product.options ?? [];
  let sizeIdx = -1;
  let colorIdx = -1;
  for (let i = 0; i < options.length; i++) {
    const name = String(options[i]?.name ?? '').toLowerCase().trim();
    if (sizeIdx === -1 && (name === 'size' || name.includes('size'))) sizeIdx = i;
    else if (colorIdx === -1 && (name === 'color' || name === 'colour' || name.includes('color') || name.includes('colour'))) colorIdx = i;
  }
  // Fallbacks: if only one option, treat as size. If neither matched, default size=0, color=1.
  if (sizeIdx === -1 && colorIdx === -1) { sizeIdx = 0; colorIdx = 1; }
  else if (sizeIdx === -1) sizeIdx = (colorIdx === 0 ? 1 : 0);
  else if (colorIdx === -1) colorIdx = (sizeIdx === 0 ? 1 : 0);
  return { sizeIdx, colorIdx };
}

/**
 * Sync Shopify variants → rrg_product_variants for a given submission.
 * Upserts by shopify_variant_id.
 */
async function syncVariants(submissionId, product) {
  const variants = product.variants ?? [];
  const now = new Date().toISOString();

  const { sizeIdx, colorIdx } = detectOptionPositions(product);

  for (let i = 0; i < variants.length; i++) {
    const v = variants[i];
    const shopifyId = String(v.id);
    // Use inventory_quantity if available and > 0; otherwise use `available` boolean (1 or 0)
    const rawQty = parseInt(v.inventory_quantity, 10);
    const stock = (!isNaN(rawQty) && rawQty > 0) ? rawQty : (v.available === true ? 1 : 0);

    // Resolve size/color from option positions (Shopify: option1/2/3 based on product.options order)
    const sizeVal  = [v.option1, v.option2, v.option3][sizeIdx]  ?? null;
    const colorVal = [v.option1, v.option2, v.option3][colorIdx] ?? null;
    const size  = sizeVal || null;
    const color = colorVal || null;

    const row = {
      submission_id:      submissionId,
      size,
      color,
      shopify_variant_id: shopifyId,
      cached_stock:       stock,
      cached_stock_at:    now,
      sku:                v.sku || null,
      price_override:     (() => {
        if (parseFloat(v.price) === parseFloat(variants[0].price)) return null;
        const r = Number.isFinite(CFG.priceToUsdcRate) && CFG.priceToUsdcRate > 0 ? CFG.priceToUsdcRate : 1;
        return Math.round(parseFloat(v.price) * r * 100) / 100;
      })(),
      sort_order:         i,
      updated_at:         now,
    };

    // Upsert by shopify_variant_id
    const { data: existing } = await db
      .from('rrg_product_variants')
      .select('id')
      .eq('shopify_variant_id', shopifyId)
      .maybeSingle();

    if (existing) {
      await db.from('rrg_product_variants')
        .update({ cached_stock: stock, cached_stock_at: now, size, color, sku: row.sku, updated_at: now })
        .eq('id', existing.id);
    } else {
      row.id = randomUUID();
      row.created_at = now;
      const { error } = await db.from('rrg_product_variants').insert(row);
      if (error) console.error(`  [variant ${shopifyId}] insert error:`, error.message);
    }
  }

  console.log(`  → synced ${variants.length} variants for ${submissionId.slice(0, 8)}`);
}

// ────────────────────────────────────────────────────────────────────
// Auto-memory — writes a `<slug>_storefront.md` under Richard's memory
// dir on the local machine at end of a successful run. Skips silently
// off-machine or if the file already exists (manual edits are preserved).
// ────────────────────────────────────────────────────────────────────
function findMemoryDir() {
  // Find the RRG project memory dir without hardcoding the encoded project
  // path. `~/.claude/projects/*/memory/MEMORY.md` exists — pick the one whose
  // encoded path resolves to this working directory (i.e. ends with `-rrg`).
  const base = join(homedir(), '.claude', 'projects');
  if (!existsSync(base)) return null;
  let entries;
  try { entries = readdirSync(base); } catch { return null; }
  for (const e of entries) {
    const memDir = join(base, e, 'memory');
    if (existsSync(join(memDir, 'MEMORY.md')) && /-rrg$/i.test(e)) return memDir;
  }
  return null;
}

function writeBrandMemory(brand, results) {
  const memDir = findMemoryDir();
  if (!memDir) { console.log('[memory] no local memory dir — skipping'); return; }

  const filename = `${CFG.slug.replace(/-/g, '_')}_storefront.md`;
  const path = join(memDir, filename);
  if (existsSync(path)) {
    console.log(`[memory] ${filename} exists — leaving manual edits alone`);
    return;
  }

  const tokenIds = results.map(r => r.token_id).filter(n => n != null).sort((a, b) => a - b);
  const tokenRange = tokenIds.length === 0 ? 'none' :
    tokenIds.length === 1 ? `${tokenIds[0]}` :
    `${tokenIds[0]}-${tokenIds[tokenIds.length - 1]}`;
  const currency = CFG.sourceCurrency ?? 'USD';
  const rate = Number.isFinite(CFG.priceToUsdcRate) ? CFG.priceToUsdcRate : 1;
  const today = new Date().toISOString().slice(0, 10);

  const body = `---
name: ${CFG.name} storefront
description: Brand mirror on RRG — ${CFG.headline ?? CFG.name}. ${currency}→USDC at ${rate}, tokens ${tokenRange}
type: project
---
## ${CFG.name} — storefront (${today})

Auto-generated by \`scripts/brand-mirror.mjs\` on ${today}. Add non-obvious manual notes below.

### Facts

- Brand slug: \`${CFG.slug}\`
- Supabase row id: \`${brand.id}\`
- Storefront: \`https://realrealgenuine.com/brand/${CFG.slug}\`
- Catalogue API: \`https://realrealgenuine.com/api/rrg/catalogue?brand=${CFG.slug}\`
- Public source: \`${CFG.shopifyDomain ? 'https://' + CFG.shopifyDomain + '/products.json' : (CFG.squarespaceShopUrl ?? CFG.website)}\`
- Wallet: \`${CFG.wallet}\`
- Currency: ${currency}${currency === 'USD' ? '' : ` → USDC at fixed rate \`${rate}\``}
- \`supports_sizing: ${!!CFG.supportsSizing}\`
- Token IDs on Base mainnet (contract \`${RRG_ADDR}\`): **${tokenRange}** (${tokenIds.length} products)
- Chain registration: ${SKIP_CHAIN ? 'SKIPPED (DB + images only — re-run with --commit-chain to register)' : 'COMMITTED on-chain'}

### Non-obvious things to remember

_(none yet — fill in after the build)_
`;

  writeFileSync(path, body, 'utf8');
  console.log(`[memory] wrote ${filename}`);

  // Append index line to MEMORY.md if the slug isn't already referenced
  const indexPath = join(memDir, 'MEMORY.md');
  try {
    const idx = readFileSync(indexPath, 'utf8');
    if (!idx.includes(filename)) {
      const line = `→ See [${filename}](${filename}) — ${CFG.name} storefront mirror, ${currency}→USDC at ${rate}, tokens ${tokenRange}.\n`;
      appendFileSync(indexPath, (idx.endsWith('\n') ? '' : '\n') + line, 'utf8');
      console.log(`[memory] indexed in MEMORY.md`);
    }
  } catch (e) {
    console.warn(`[memory] could not update MEMORY.md: ${e.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────
(async () => {
  const brand = await ensureBrand();
  if (!brand) { console.log('[done] dry seed — exiting'); return; }
  if (SEED_ONLY) { console.log('[done] seed only — exiting'); return; }

  const products = await fetchProducts();
  const filtered = handleFilter
    ? products.filter(p => handleFilter.has(p.handle))
    : products;

  if (handleFilter && filtered.length === 0) {
    console.error(`No products matched handles: ${Array.from(handleFilter).join(', ')}`);
    console.error(`Available: ${products.map(p => p.handle).join(', ')}`);
    process.exit(1);
  }

  console.log(`[import] processing ${filtered.length} of ${products.length} products`);
  console.log();

  const results = [];
  for (const p of filtered) {
    try {
      const r = await importProduct(p, brand);
      if (r) results.push(r);
    } catch (e) {
      console.error(`[FAIL ${p.handle}]`, e.message ?? e);
    }
    console.log();
  }

  console.log(`──── Done ────`);
  console.log(`Imported / found ${results.length} listings`);
  console.log(`Brand storefront: https://realrealgenuine.com/brand/${CFG.slug}`);
  for (const r of results) {
    if (r.token_id != null) console.log(`  • token #${r.token_id} → /rrg/drop/${r.token_id}`);
  }

  if (results.length > 0 && !DRY_RUN) {
    try { writeBrandMemory(brand, results); }
    catch (e) { console.warn(`[memory] skipped: ${e.message}`); }
  }

  // ── Stage 5: auto-chain enhance-descriptions ──────────────────────────
  // New rows landed with hidden=true (pre-publish guard). enhance-descriptions
  // writes enhanced_description + merged product_attributes and flips
  // hidden=false on success. Skipped when --no-enhance is passed or when
  // dry-run / seed-only short-circuited the import path. Runs in a child
  // process so the mirror exits cleanly even if enhance needs a different
  // module resolution or tool availability.
  if (results.length > 0 && !DRY_RUN && !NO_ENHANCE) {
    console.log();
    console.log(`──── Auto-chaining enhance-descriptions for ${CFG.slug} ────`);
    await new Promise((resolveP) => {
      const proc = spawn(process.execPath, [
        resolve(process.cwd(), 'scripts/enhance-descriptions.mjs'),
        '--brand', CFG.slug,
      ], { stdio: 'inherit', env: process.env });
      proc.on('close', (code) => {
        if (code === 0) console.log(`[auto-enhance] done (code ${code})`);
        else console.warn(`[auto-enhance] exited with code ${code} — rows may remain hidden until a manual run`);
        resolveP();
      });
      proc.on('error', (err) => {
        console.warn(`[auto-enhance] spawn failed: ${err.message}`);
        resolveP();
      });
    });
  } else if (NO_ENHANCE) {
    console.log('[enhance] skipped (--no-enhance). Rows inserted with hidden=false directly.');
  }
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
