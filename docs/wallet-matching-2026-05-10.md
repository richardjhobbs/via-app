# Wallet Matching Report: Pre-classified Ledger for Colin

Generated 2026-05-09. Source: `docs/data/purchases-2026-05-10.json` (snapshot 2026-05-10, 50 purchase rows). Every `tx_hash` and payout-leg hash was verified against BOTH Base mainnet (https://base.blockscout.com) and Base Sepolia (https://base-sepolia.blockscout.com) to determine its actual chain.

**Critical data-quality finding.** The `rrg_purchases.network` column is unreliable: a significant number of rows are labelled `network='base'` but the tx actually exists on Sepolia. Some rows reference tx hashes that do not exist on either chain. Booking decisions must use the **verified actual chain**, not the DB column.

## 1. Summary by verified chain

| Category | Rows | Gross USDC | Action |
|----------|-----:|-----------:|--------|
| Real Base mainnet (book) | 17 | 8.80 | Post to Zoho as revenue |
| Mislabelled (DB=base, actual=Sepolia) | 22 | 21.00 | DO NOT BOOK. Flag for DB correction |
| Correctly labelled Sepolia | 0 | 0.00 | DO NOT BOOK. Test data |
| Orphan (tx not found on either chain) | 11 | 8.00 | DO NOT BOOK. Investigate with Richard |
| **Total** | **50** | **37.80** | |

Real revenue (gross): **8.80 USDC** across 17 sales.

## 2. Real mainnet ledger (post these to Zoho)

Each row is a verified Base mainnet sale. Splits sum to amount_usdc. Where split_* columns are null, the legacy contract was used (pre-2026-03-13) and the platform retained 100% (no auto-payout fired).

| Date | Brand | Token | Gross | Brand | Platform | Creator | DB label | Buyer | Sale tx | Payout legs |
|------|-------|------:|------:|------:|---------:|--------:|----------|-------|---------|-------------|
| 2026-05-06 | Clooudie | 530 | 0.50 | 0.49 | 0.01 | 0.00 | `base-sepolia` ⚠ | `0xe6538040…` | [`0x928a4b7d…`](https://basescan.org/tx/0x928a4b7d0152eea1e7515e34bf978faf3426af7168697d99e062f85c1aa64b67) | brand:[`0x2601226d…`](https://basescan.org/tx/0x2601226dd5b263ae2d2cd68b9d0eee8b3d7c06437dabcee3cc2e918b035bc4a1)[✓] |
| 2026-04-28 | Unknown Union | 491 | 0.50 | 0.49 | 0.01 | 0.00 | `base-sepolia` ⚠ | `0xe6538040…` | [`0x0796f5e5…`](https://basescan.org/tx/0x0796f5e5911d0b8012436326cbd464b1902e9388c9d02fdf86f80e611e9c92d7) | brand:[`0x6183c095…`](https://basescan.org/tx/0x6183c095e1c5144e0b63d60d48606256c6ab7d9ec2426bf59873682a4aca37c4)[✓] |
| 2026-04-28 | Clooudie | 489 | 0.50 | 0.49 | 0.01 | 0.00 | `base-sepolia` ⚠ | `0xe6538040…` | [`0xe6b3fcbb…`](https://basescan.org/tx/0xe6b3fcbb0000a6c8241e674642c6610bdc12c322be4b1ba6d25b162feb7af05b) | brand:[`0xa8c0d133…`](https://basescan.org/tx/0xa8c0d13311b1f66cf3bd3c62334c1db258f94202b978c72cf5f9d73219b91df1)[✓] |
| 2026-04-27 | Frey Tailored | 490 | 0.50 | 0.49 | 0.01 | 0.00 | `base-sepolia` ⚠ | `0xe6538040…` | [`0x365dbc9d…`](https://basescan.org/tx/0x365dbc9dba9feb2ff6093cb035c924653bf25782c203c05e89b8d3e410912ef6) | brand:[`0xaeb39820…`](https://basescan.org/tx/0xaeb39820adb6e7433739c095327f5fda69df16f8606cea3656f4c3ade51f1226)[✓] |
| 2026-04-27 | Nolo | 488 | 0.50 | 0.49 | 0.01 | 0.00 | `base-sepolia` ⚠ | `0xe6538040…` | [`0xba1d2ab2…`](https://basescan.org/tx/0xba1d2ab27c8fbf8d911ed1685deab827c54b598495ce81c1ed7cd977ea4d206a) | brand:[`0x62bf0ed5…`](https://basescan.org/tx/0x62bf0ed58ed4e33cfcf6d990961ef7b6448d1ab541f69fb47aab4155b88652d0)[✓] |
| 2026-04-27 | Nolo | 488 | 0.50 | 0.49 | 0.01 | 0.00 | `base-sepolia` ⚠ | `0xe6538040…` | [`0x4340636f…`](https://basescan.org/tx/0x4340636f67918b785b71bcec4867e84bcf11d07d986c3d245694fd7acf91d014) | brand:[`0x1371e430…`](https://basescan.org/tx/0x1371e43057cbb8f294fd6b6e97148348370d1e288370d51b8abe2a111a5b9801)[✓] |
| 2026-03-20 | RRG | 38 | 0.10 | 0.07 | 0.03 | 0.00 | `base-sepolia` ⚠ | `0xe6538040…` | [`0x98303a99…`](https://basescan.org/tx/0x98303a991a189df87ebe1f2be02f0c38cce398f37a048fd57692feebdd3755c6) | brand:[`0x9cd2258d…`](https://basescan.org/tx/0x9cd2258d562cc19fda71c856bbe8c868c0d43110b429c86adf1d6713c9449287)[✓] |
| 2026-03-20 | RRG | 38 | 0.10 | 0.07 | 0.03 | 0.00 | `base` ✓ | `0x2c9a1dad…` | [`0xdbb96084…`](https://basescan.org/tx/0xdbb960840bb5758abf4e6646f86399357031dd5667ee9e97bbd282608b8f2b5d) | brand:[`0x7a126bf1…`](https://basescan.org/tx/0x7a126bf1403eca4833ee88c692238015486045fefb1137605365277b5744421f)[✓] |
| 2026-03-20 | RRG | 38 | 0.10 | 0.07 | 0.03 | 0.00 | `base` ✓ | `0x2c9a1dad…` | [`0x47f42180…`](https://basescan.org/tx/0x47f421804d0797cc7c3259b393c6cbb45edcd3a052a46c759d9c0ebe9218ef95) | brand:[`0xc8ba66b8…`](https://basescan.org/tx/0xc8ba66b8bcdaef2d4c0b2eb574f6a62366d504598abc42e825caecef6d20778f)[✓] |
| 2026-03-19 | RRG | 5 | 0.50 | 0.00 | 0.15 | 0.35 | `base-sepolia` ⚠ | `0xe6538040…` | [`0x4f39efcc…`](https://basescan.org/tx/0x4f39efcc967ab6b14d073823b177a8a0eca2eecdef309ba5e9213362cc548178) | _legacy_ |
| 2026-03-19 | East Coast Cassettes | 34 | 1.00 | 0.35 | 0.30 | 0.35 | `base-sepolia` ⚠ | `0xe6538040…` | [`0x9f8e12cc…`](https://basescan.org/tx/0x9f8e12ccd0b0da5ec07e9b0c1999e0961f7ae7d370d5613f3576bbdcc76c775e) | creator:[`0xa99ff082…`](https://basescan.org/tx/0xa99ff0827ad70926a5238c7e4e9c5b01f813f580b26cc1abd25fb45e7eec38d7)[✓]<br>brand:[`0x43466af9…`](https://basescan.org/tx/0x43466af97ccc759516df3867f47663b35e987e16cf753269345d936a8aacd0c3)[✓] |
| 2026-03-18 | East Coast Cassettes | 28 | 0.50 | 0.35 | 0.15 | 0.00 | `base-sepolia` ⚠ | `0xe6538040…` | [`0xe620d9f4…`](https://basescan.org/tx/0xe620d9f4d8c6f159ae47275860e456afae6fc7d35f00880ee6b8b7f637ee6487) | brand:[`0x5bb1c783…`](https://basescan.org/tx/0x5bb1c78367599fbc5adf4585251a0e2c5e15a681dfc16073b375391bcd7202e2)[✓] |
| 2026-03-18 | East Coast Cassettes | 28 | 0.50 | 0.35 | 0.15 | 0.00 | `base-sepolia` ⚠ | `0xe6538040…` | [`0x54d21d08…`](https://basescan.org/tx/0x54d21d08ae2ec8047afb564a423da8157160ca7d315930912cdecc7f0df2956f) | brand:[`0xb06c134b…`](https://basescan.org/tx/0xb06c134b1d14c426fc6ba69c94faf61b0128647d30ca327b6dbc681d77acb8d0)[✓] |
| 2026-03-16 | East Coast Cassettes | 32 | 0.50 | 0.35 | 0.15 | 0.00 | `base` ✓ | `0x2c9a1dad…` | [`0xd6db1cf8…`](https://basescan.org/tx/0xd6db1cf8f096f5cfe7cc9ca09a70a800ba55db427ef13fa32b27f1dd3286a08d) | _legacy_ |
| 2026-03-16 | RRG | 13 | 0.50 | 0.00 | 0.32 | 0.18 | `base-sepolia` ⚠ | `0x25b22971…` | [`0x437af8fd…`](https://basescan.org/tx/0x437af8fd3abd8fc87e5f25c5768afc5d594a8ab1f5b985419878d10a95f27c26) | creator:[`0x57ddd9b1…`](https://basescan.org/tx/0x57ddd9b19ac085fd9bc7677b45256e14f86e765076efa7199f7c1e7b2c69a8c7)[✓] |
| 2026-03-09 | RRG | 22 | 1.00 | _legacy_ | _legacy_ | _legacy_ | `base-sepolia` ⚠ | `0x369d04f0…` | [`0x3c9d6ef8…`](https://basescan.org/tx/0x3c9d6ef84775032d7f966fc09eeeed3ad9c3bfc3b28e4cfaa42ed144d3236370) | _legacy_ |
| 2026-03-09 | RRG | 22 | 1.00 | _legacy_ | _legacy_ | _legacy_ | `base` ✓ | `0xc12ecf02…` | [`0xfaf35806…`](https://basescan.org/tx/0xfaf35806fb04e5b3f04c041b86bd294b42b6db9cbc1e138fde5a29a7f8c99d12) | _legacy_ |

Legend: `base` ✓ = DB label and verified chain agree. `base-sepolia` ⚠ = DB labelled this as test data but the tx is real Base mainnet (under-reports revenue). `✓` payout leg verified on mainnet, `sep` payout leg actually on Sepolia, `?` not found on either chain.

## 3. Mislabelled rows: DB says `base` but tx is on Sepolia (DO NOT BOOK)

These 22 rows would over-state revenue if Colin trusted the `network` column. Treat as test data.

| Date | Brand | Token | Gross | Buyer | Sepolia tx |
|------|-------|------:|------:|-------|------------|
| 2026-03-09 | RRG | 8 | 1.00 | `0x369d04f0…` | [`0x18d1498c…`](https://sepolia.basescan.org/tx/0x18d1498cfdaaa7580e067843401bb63fc9d48d68e45e91d5f7bf28737c0a3c6c) |
| 2026-03-09 | RRG | 8 | 1.00 | `0xc12ecf02…` | [`0x9747c5a0…`](https://sepolia.basescan.org/tx/0x9747c5a08364a7cbcac5a982fe3f50c2a6b79ece74dc971e91dd97297ccc053e) |
| 2026-03-09 | RRG | 8 | 1.00 | `0x369d04f0…` | [`0x3a685cf7…`](https://sepolia.basescan.org/tx/0x3a685cf7adc6a234338c0c2ec7ec00be48f6fb1deb0e09c030fda74afcb9daa2) |
| 2026-03-09 | RRG | 24 | 1.50 | `0x369d04f0…` | [`0x09bbcf7e…`](https://sepolia.basescan.org/tx/0x09bbcf7eb4d0961ba93f044607a040810e79ab3b61aea09cc684761a58174167) |
| 2026-03-09 | RRG | 23 | 1.00 | `0xc12ecf02…` | [`0x06cf1b02…`](https://sepolia.basescan.org/tx/0x06cf1b0268cd89970134e633fa33cca21dd4691a83f50cf785357900ccd78620) |
| 2026-03-09 | RRG | 13 | 0.50 | `0xc12ecf02…` | [`0xedd4c99b…`](https://sepolia.basescan.org/tx/0xedd4c99b159bdc6e3068fe09184e144ed8e7e2ac4aa3c1a2f93c467605394bc7) |
| 2026-03-09 | RRG | 21 | 1.50 | `0xc12ecf02…` | [`0xebc171a1…`](https://sepolia.basescan.org/tx/0xebc171a111c10a1b131e25516f22395876b4d654a0860a0a75885a1ca6da3eeb) |
| 2026-03-08 | RRG | 18 | 1.00 | `0xc12ecf02…` | [`0x6b60b96d…`](https://sepolia.basescan.org/tx/0x6b60b96d5947fab33e66d99e83ce986d3bd91f15a6a02d6b78ed3f069ca49fba) |
| 2026-03-08 | RRG | 19 | 1.00 | `0xc12ecf02…` | [`0xe13fbe44…`](https://sepolia.basescan.org/tx/0xe13fbe442698199ec8f3ecdbd817c392ddcdbc3daf06f2367c3cf38b597aa9fc) |
| 2026-03-08 | RRG | 12 | 1.00 | `0xf7bba988…` | [`0xc8e13347…`](https://sepolia.basescan.org/tx/0xc8e13347efa002c5c0b50702e6a1c1cbbc19ce537089236a546fa1d906aaf3f5) |
| 2026-03-08 | RRG | 17 | 1.00 | `0x9f783931…` | [`0xf0ad6baf…`](https://sepolia.basescan.org/tx/0xf0ad6baf10d61f2867a4c679d187ae41ca0746612ea1f4662e49d31a799e0bcb) |
| 2026-03-08 | RRG | 8 | 1.00 | `0xc12ecf02…` | [`0xfb0bf265…`](https://sepolia.basescan.org/tx/0xfb0bf26599b80bcfdbea7771fac85218b2b6d45988b1cd94a4ba4039b4069fe0) |
| 2026-03-08 | RRG | 13 | 0.50 | `0xc12ecf02…` | [`0xabdac0f8…`](https://sepolia.basescan.org/tx/0xabdac0f8eb852bdacc6257896bd134e6611b8e69e6867aeac6ff462072036924) |
| 2026-03-08 | RRG | 14 | 1.00 | `0xc12ecf02…` | [`0x3f6f4c6e…`](https://sepolia.basescan.org/tx/0x3f6f4c6e06e5b6800a4a199df52bc4025b191d5e9d99dc1f7ac609d0f76d27af) |
| 2026-03-08 | RRG | 14 | 1.00 | `0xc12ecf02…` | [`0xe68561ab…`](https://sepolia.basescan.org/tx/0xe68561ab6420699b3195879cfb62faf6b13bab1d0195f7d6e41f0a93749a3dd8) |
| 2026-03-08 | RRG | 15 | 1.00 | `0xc12ecf02…` | [`0x4395c628…`](https://sepolia.basescan.org/tx/0x4395c628a231ece6ac8cbb056c5707d93f7a7c2379908e9eb6095ee9f955ebc4) |
| 2026-03-07 | RRG | 13 | 0.50 | `0xc12ecf02…` | [`0x82254ff1…`](https://sepolia.basescan.org/tx/0x82254ff1ff1cdfab1200aa813f71cb98ee221c63207677514df989fa4a45dd86) |
| 2026-03-07 | RRG | 12 | 1.00 | `0xc12ecf02…` | [`0x949c4821…`](https://sepolia.basescan.org/tx/0x949c4821a2c6194574fe28305dceadabc1eb31adf911fc179c066d1c8e4bc702) |
| 2026-03-07 | RRG | 10 | 1.00 | `0x0e0ef550…` | [`0xef0b7f3c…`](https://sepolia.basescan.org/tx/0xef0b7f3c63b11dbc872be6518acb95404cf6eecde120b843ad9226e2239a2de8) |
| 2026-03-07 | RRG | 8 | 1.00 | `0xc12ecf02…` | [`0x9131e42e…`](https://sepolia.basescan.org/tx/0x9131e42e85acb29653316eb105e818aa1b9bb9229847925942ea4979fc4a34ac) |
| 2026-03-06 | RRG | 5 | 0.50 | `0xc12ecf02…` | [`0xe630e844…`](https://sepolia.basescan.org/tx/0xe630e8448cdd69ba4143b1ad2df85e2fe58a50db66677949ce83e01d6aa5fd75) |
| 2026-03-06 | RRG | 6 | 1.00 | `0xc12ecf02…` | [`0xd703a07e…`](https://sepolia.basescan.org/tx/0xd703a07e683b26ac9a172680ead2ef437b0cd435eb680f40eda014254104f654) |

## 4. Correctly labelled Sepolia rows (DO NOT BOOK, no issue)

None.

## 5. Orphan rows: tx not found on either chain (DO NOT BOOK, investigate)

These 11 rows reference `tx_hash` values that don't exist on Base mainnet OR Base Sepolia. Possible causes: tx never confirmed, was reorg'd out, the hash was recorded incorrectly, or Blockscout indexing gap. Investigate before deciding whether to discard the row or reclassify.

| Date | Brand | Token | Gross | Labelled network | Buyer | Tx hash |
|------|-------|------:|------:|------------------|-------|---------|
| 2026-03-13 | East Coast Cassettes | 32 | 0.50 | base | `0xc12ecf02…` | `0x972dce1c9f62ae5007580a360a92f9a430c00366f9e64f87e538751b6a88c47f` |
| 2026-03-13 | East Coast Cassettes | 32 | 0.50 | base | `0xc12ecf02…` | `0x256144faa418db6b4286969b93898ccb98c1b3334bbce859838eabbcdaaa22e8` |
| 2026-03-13 | East Coast Cassettes | 32 | 0.50 | base | `0xc12ecf02…` | `0x608ff8a89fbc6eb5faa67bf0721f3860f9600d18be81aff9573ed9c953b29071` |
| 2026-03-13 | East Coast Cassettes | 32 | 0.50 | base | `0xc12ecf02…` | `0x333cb4a2bf31b236e91d24e75608d266f21dffddb04ba715c8aef916c4b7a47d` |
| 2026-03-13 | East Coast Cassettes | 32 | 0.50 | base | `0xc12ecf02…` | `0xa408b65c3a07c5a5b21d9456d893aa6352df2a48cb9db502c630882c81ab0b5e` |
| 2026-03-13 | East Coast Cassettes | 32 | 0.50 | base | `0xc12ecf02…` | `0x5cab7f0ffbb102b7c81bb15a5bc7bcb2c0cd1afda7509a2ae36c53c2c9bb9375` |
| 2026-03-13 | East Coast Cassettes | 32 | 0.50 | base | `0xc12ecf02…` | `0xb3e4df0b81a15e0d949f6384a8e8434536c818e83a3f41beeb5ff05bec1aa4fa` |
| 2026-03-12 | RRG | 13 | 0.50 | base | `0xc12ecf02…` | `0x4dd1c24a08817fa068aad05242cc4827ad27e68f78a70c221228befc356c4908` |
| 2026-03-12 | The Year Of... | 30 | 1.00 | base | `0xc12ecf02…` | `0xa4e83ba1fb0668e79748c239cf439b9fa350a5255d10283399eba21fe7927b75` |
| 2026-03-11 | RRG | 26 | 2.00 | base | `0xc12ecf02…` | `0xaf3caa06ba006a7c4a927a0b3c5a8de7c1d6a3eec6a081ee1909ab421aa6b5e6` |
| 2026-03-10 | RRG | 25 | 1.00 | base | `0xc12ecf02…` | `0xd8694c5fa7ef4c6e14ae3e8ec10f55ae9edf0b2649ed03ae7ea928215f3c1c85` |


## 6. Unaccounted on-chain USDC tx (need Richard's classification)

These USDC transfers hit a watched wallet on Base mainnet but do NOT correspond to any `rrg_purchases.tx_hash` or `payout_tx_hashes` value. They are top-ups, manual sends, gas rebates, agent micropayments, refunds, or other off-platform activity. Each needs a one-line classification before booking.

| Date | Wallet | Direction | USDC | Counterparty | Tx |
|------|--------|-----------|-----:|--------------|----|
| 2026-05-06 | Digital Fashion Week | OUT | 0.01 | `0xe3478b0bb1a5084567c319096437924948be1964` | [`0xfae3fd5a…`](https://basescan.org/tx/0xfae3fd5acde94228038e25ee50d24a2f455ce80c0e9bf87797d33c10467dbdc7) |
| 2026-05-06 | Digital Fashion Week | OUT | 2.00 | `0xa439d88ecd114226e28289e32cd0c8c4a1b300ab` | [`0xfae3fd5a…`](https://basescan.org/tx/0xfae3fd5acde94228038e25ee50d24a2f455ce80c0e9bf87797d33c10467dbdc7) |
| 2026-05-06 | Digital Fashion Week | OUT | 0.01 | `0xe3478b0bb1a5084567c319096437924948be1964` | [`0x2a7258be…`](https://basescan.org/tx/0x2a7258bede414ae7b9156ba979c554260a1fe603761627a6fd099fd3592ac03b) |
| 2026-05-06 | Digital Fashion Week | OUT | 2.00 | `0xb33fb3fd97922d3a8bf4b086af8660bb12cbb1f8` | [`0x2a7258be…`](https://basescan.org/tx/0x2a7258bede414ae7b9156ba979c554260a1fe603761627a6fd099fd3592ac03b) |
| 2026-05-06 | PLATFORM_WALLET | OUT | 2.00 | `0xc12ecf02448e0e56dad9c0d5473553b80d030d75` | [`0xb250b2cb…`](https://basescan.org/tx/0xb250b2cb3437dd73004f87d13eb89798549b47bb215e203587db6c3868c0d40a) |
| 2026-05-06 | Digital Fashion Week | IN | 2.00 | `0xbfd71ea27ffc99747da2873372f84346d9a8b7ed` | [`0xb250b2cb…`](https://basescan.org/tx/0xb250b2cb3437dd73004f87d13eb89798549b47bb215e203587db6c3868c0d40a) |
| 2026-05-06 | Digital Fashion Week | IN | 0.00 | `0xbfd7a92543ae9c1edb89ac2015c63865cd97b7ed` | [`0x6a70cf27…`](https://basescan.org/tx/0x6a70cf27a5a832e2bcb219f4cf13d959af7c94a43e0055346e9d3ea5adb2571b) |
| 2026-05-06 | PLATFORM_WALLET | IN | 2.00 | `0xc12ecf02448e0e56dad9c0d5473553b80d030d75` | [`0xc814754e…`](https://basescan.org/tx/0xc814754ea2b136e4e7d42585a76ce5b574a34ac08bcf3f865320a56617a82983) |
| 2026-05-06 | Digital Fashion Week | OUT | 2.00 | `0xbfd71ea27ffc99747da2873372f84346d9a8b7ed` | [`0xc814754e…`](https://basescan.org/tx/0xc814754ea2b136e4e7d42585a76ce5b574a34ac08bcf3f865320a56617a82983) |
| 2026-03-16 | East Coast Cassettes | IN | 0.00 | `0xe656ea297c34fabc660c38b23f41ea56e66a4375` | [`0xf18897df…`](https://basescan.org/tx/0xf18897dff67c1278d8f9102518e7846f7cccb086faac3da6db4de9b474c20807) |
| 2026-03-16 | DrHobbs personal | IN | 0.00 | `0x61ee12e276f8532e60033ad4404f6059740f6f19` | [`0x854c2b68…`](https://basescan.org/tx/0x854c2b6847a772bb1193774cecd608e84553eb61fb289952a7a9c0eb8bb19ff1) |
| 2026-03-16 | DrHobbs personal | OUT | 0.35 | `0x61e01997e6a0c692656e94955c67cb3ebcab8f19` | [`0xcf3fd2a5…`](https://basescan.org/tx/0xcf3fd2a5797ad472e9bb5ac7b367dc67397e43865f4fb4976fd1f9902d359d2e) |
| 2026-03-16 | East Coast Cassettes | IN | 0.35 | `0xe653804032a2d51cc031795afc601b9b1fd2c375` | [`0xcf3fd2a5…`](https://basescan.org/tx/0xcf3fd2a5797ad472e9bb5ac7b367dc67397e43865f4fb4976fd1f9902d359d2e) |
| 2026-03-16 | Digital Fashion Week | OUT | 0.01 | `0xe3478b0bb1a5084567c319096437924948be1964` | [`0x6ad56841…`](https://basescan.org/tx/0x6ad56841a6647105703ec70a8ca150b33c5bde991750783f90caa20e4d7c70ba) |
| 2026-03-16 | Digital Fashion Week | OUT | 1.00 | `0x2c9a1dadd6cb5425bf0e677fada64a257a558438` | [`0x6ad56841…`](https://basescan.org/tx/0x6ad56841a6647105703ec70a8ca150b33c5bde991750783f90caa20e4d7c70ba) |
| 2026-03-16 | Artemist | IN | 1.00 | `0xc12ecf02448e0e56dad9c0d5473553b80d030d75` | [`0x6ad56841…`](https://basescan.org/tx/0x6ad56841a6647105703ec70a8ca150b33c5bde991750783f90caa20e4d7c70ba) |
| 2026-03-16 | Digital Fashion Week | OUT | 0.01 | `0xe3478b0bb1a5084567c319096437924948be1964` | [`0x99116e9c…`](https://basescan.org/tx/0x99116e9c1457c18c52c3abe7e517ff232d48eb25e01894b132bf98ef22db67ac) |
| 2026-03-16 | Digital Fashion Week | OUT | 1.00 | `0x25b22971892b7314c36ec6dcfb5537500d50ea35` | [`0x99116e9c…`](https://basescan.org/tx/0x99116e9c1457c18c52c3abe7e517ff232d48eb25e01894b132bf98ef22db67ac) |
| 2026-03-09 | DEPLOYER | IN | 2.00 | `0xc12ecf02448e0e56dad9c0d5473553b80d030d75` | [`0xbf4305f0…`](https://basescan.org/tx/0xbf4305f0e252de58b8540cd31d79958c249ba7b19903d1afa23b3f57cb9376f3) |
| 2026-03-09 | Digital Fashion Week | OUT | 0.00 | `0xe3478b0bb1a5084567c319096437924948be1964` | [`0xbf4305f0…`](https://basescan.org/tx/0xbf4305f0e252de58b8540cd31d79958c249ba7b19903d1afa23b3f57cb9376f3) |
| 2026-03-09 | Digital Fashion Week | OUT | 2.00 | `0x369d04f08f245454926ac96a0164a634fd94660b` | [`0xbf4305f0…`](https://basescan.org/tx/0xbf4305f0e252de58b8540cd31d79958c249ba7b19903d1afa23b3f57cb9376f3) |
| 2026-03-09 | Digital Fashion Week | IN | 0.00 | `0xd898341e07bf5cd9149e87e486698440bed26456` | [`0xdaf33d47…`](https://basescan.org/tx/0xdaf33d47cb40274363ae346d9629903984344fb34c34bf43663e22b798ce3738) |
| 2026-03-09 | Digital Fashion Week | IN | 45.00 | `0xd89216bebfefc98a53e56d5fbf24eb5793f70456` | [`0xdd132328…`](https://basescan.org/tx/0xdd1323283c2c9036a877dccbe9ddf8769ef7a7e5d48775001eea0b0214426643) |
| 2026-03-07 | Digital Fashion Week | IN | 43.71 | `0xacc0c1f672b03b9a5fed4535f840f09b85f40e98` | [`0x9bcb8559…`](https://basescan.org/tx/0x9bcb85591815e8b125d858ebf26c10ea4716efc14bb9dfb862a407d0e7ec1fb5) |
| 2026-03-05 | DEPLOYER | IN | 3.00 | `0xc12ecf02448e0e56dad9c0d5473553b80d030d75` | [`0x7e4a6823…`](https://basescan.org/tx/0x7e4a682354ee7ad6548b6ff74c829755c451f16491e24227ccf9468fbd82e3ec) |
| 2026-03-05 | Digital Fashion Week | OUT | 0.00 | `0xe3478b0bb1a5084567c319096437924948be1964` | [`0x7e4a6823…`](https://basescan.org/tx/0x7e4a682354ee7ad6548b6ff74c829755c451f16491e24227ccf9468fbd82e3ec) |
| 2026-03-05 | Digital Fashion Week | OUT | 3.00 | `0x369d04f08f245454926ac96a0164a634fd94660b` | [`0x7e4a6823…`](https://basescan.org/tx/0x7e4a682354ee7ad6548b6ff74c829755c451f16491e24227ccf9468fbd82e3ec) |
| 2026-03-04 | DrHobbs personal | IN | 0.00 | `0xc1235a357693d4312cf403219b55c44ccf41bd75` | [`0x29e8cd7d…`](https://basescan.org/tx/0x29e8cd7d11ff8c653acddeca86e79e4ef682d3d56ef94fe4d1f6871458fc4b3f) |
| 2026-03-04 | Digital Fashion Week | IN | 0.00 | `0xe65197a57a2f04383056df2f7ce924931f97a375` | [`0x5e7dd40a…`](https://basescan.org/tx/0x5e7dd40a26949316881c4334141a69b7aa00151a111b2ee34ec529464b0a97bc) |
| 2026-03-04 | DrHobbs personal | IN | 0.25 | `0xc12ecf02448e0e56dad9c0d5473553b80d030d75` | [`0x9ecfa86f…`](https://basescan.org/tx/0x9ecfa86fd3e064622ef3926820cf503990234bb1be0a92dd8eb5e7555e4a68ef) |
| 2026-03-04 | Digital Fashion Week | OUT | 0.25 | `0xe653804032a2d51cc031795afc601b9b1fd2c375` | [`0x9ecfa86f…`](https://basescan.org/tx/0x9ecfa86fd3e064622ef3926820cf503990234bb1be0a92dd8eb5e7555e4a68ef) |
| 2026-03-03 | DrHobbs personal | IN | 0.50 | `0xc12ecf02448e0e56dad9c0d5473553b80d030d75` | [`0xcdd3ec7a…`](https://basescan.org/tx/0xcdd3ec7acd15f4f4ba237fe689a6757a71a77e6e2f3b9ae12861e8f1523a60a3) |
| 2026-03-03 | Digital Fashion Week | OUT | 0.01 | `0xe3478b0bb1a5084567c319096437924948be1964` | [`0xcdd3ec7a…`](https://basescan.org/tx/0xcdd3ec7acd15f4f4ba237fe689a6757a71a77e6e2f3b9ae12861e8f1523a60a3) |
| 2026-03-03 | Digital Fashion Week | OUT | 0.50 | `0xe653804032a2d51cc031795afc601b9b1fd2c375` | [`0xcdd3ec7a…`](https://basescan.org/tx/0xcdd3ec7acd15f4f4ba237fe689a6757a71a77e6e2f3b9ae12861e8f1523a60a3) |
| 2026-03-03 | Digital Fashion Week | IN | 3.87 | `0x0a2854fbbd9b3ef66f17d47284e7f899b9509330` | [`0x69c6f045…`](https://basescan.org/tx/0x69c6f04553667e722c60d2d0cc79b7d064ef494dc608d8140526fcd81efe9d25) |

## 7. Counterparty key

Identities for addresses that recur in the ledger. Treat unknown addresses as external and do not auto-classify them.

| Address | Identity | Source |
|---------|----------|--------|
| `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | RRG / PLATFORM_WALLET | docs/wallets.md section 1 |
| `0x369d04f08f245454926ac96a0164a634fd94660b` | DEPLOYER (gas signer; also test buyer on 4 mainnet purchases) | docs/wallets.md section 1 + rrg_purchases |
| `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | DrHobbs personal | docs/wallets.md section 1 + 2 |
| `0x58554E8423EF5C10be6fFC82EfABA9149f64de3d` | VIA Team Wallet | docs/wallets.md section 1 |
| `0x61e01997e6a0C692656e94955c67CB3ebcAb8f19` | East Coast Cassettes pre-handoff | docs/wallets.md section 2 |
| `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | Digital Fashion Week pre-handoff | docs/wallets.md section 2 |
| `0xdB59CD2c8F9c6e576510bf7ED294654f41241B65` | Personal pre-handoff (unbound) | docs/wallets.md section 2 |
| `0x2c9a1dadd6cb5425bf0e677fada64a257a558438` | Artemist (Richard's other test wallet, contact richard@bnv.me) | docs/wallets.md section 3 |
| `0xca5c9c4da1787fea491ed6c94e86b04ec46be61d` | Clooudie brand wallet | docs/wallets.md section 3 |
| `0x30b1e8cc377a75d9664c26415a820c4925afa595` | Frey Tailored brand wallet | docs/wallets.md section 3 |
| `0x019d94b9c90abd38f84ebbb488e6c833cdeffc57` | LIVVIUM brand wallet | docs/wallets.md section 3 |
| `0x9eb5405fef682e1d4d555f64a683a499076556a3` | MYKLÉ brand wallet | docs/wallets.md section 3 |
| `0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d` | Nolo brand wallet | docs/wallets.md section 3 |
| `0xb4febbe6c0a0cd350c76054ccfd037d8bf47e502` | PassportADV brand wallet | docs/wallets.md section 3 |
| `0x699e234a877ba075e1f16abb63f895a8a2250388` | The Year Of... brand wallet | docs/wallets.md section 3 |
| `0xe7ed24a6a66170070c725451c003917da83871da` | Unknown Union brand wallet | docs/wallets.md section 3 |
| `0x734a25fB869ab6415b78bbe9a39f1f99dab349E7` | Shared holding wallet | docs/wallets.md section 4 |
| `0x891c13aa323378637404efd971553a3a6df5aaf1` | Nolo handoff intermediary | docs/wallets.md section 5 |
| `0x0e0ef55048fb7b68b06dec7a6413b086a7ec029a` | Original RRG creator (token 13); also a buyer on 1 mainnet purchase | docs/wallets.md section 5 + rrg_purchases |
| `0xf2e7289889ea5ecc557439a134906f77a1d64b3e` | Artemist original creator (token 44) | docs/wallets.md section 5 |
| `0xf7bba988b1e9f28dcb293ed564b57f965ae1ec2b` | RRG submission original creator (tokens 12, 19); also a buyer on 1 mainnet purchase | docs/wallets.md section 5 + rrg_purchases |
| `0x9f783931cedc82c538028fb9be5289a38bc395df` | Buyer on 1 mainnet purchase (token 17, 2026-03-08, $1.00). Identity TBD: confirm with Richard before classifying | rrg_purchases |
| `0x25B22971892B7314c36EC6DCfB5537500d50Ea35` | Sepolia test buyer (1 row, 2026-03-16). Not in any other table. Treat as external test counterparty | rrg_purchases (sepolia only) |
| `0xe3478b0BB1A5084567C319096437924948Be1964` | Recurring 0.00-USDC paired counterparty in DFW history. Classic operator/relay-fee pattern (likely a permit relayer or paymaster service). Identity TBD: confirm before classifying | observed in DFW history |

## 8. Process for Colin going forward

1. Re-run the snapshot at start of day: in Supabase, execute the SQL in the comment block at the top of `docs/data/purchases-{DATE}.json`. Save as today's filename.
2. `node scripts/match-purchases.mjs docs/data/purchases-{TODAY}.json` regenerates this report at `docs/wallet-matching-{TODAY}.md`.
3. Diff section 5 (unaccounted on-chain tx) against the prior day's report. New rows are the tx that need classification today.
4. Post the new unaccounted rows in #admin asking Richard for classification. Wait for reply before booking.
5. Sepolia rows (section 4) NEVER post to Zoho.
