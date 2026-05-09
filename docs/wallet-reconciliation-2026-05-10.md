# Wallet Reconciliation Report: All Registered Wallets

Source: Blockscout V2 API (https://base.blockscout.com), Base mainnet (chain 8453). Window: last 90 days (since 2026-02-08). Generated 2026-05-09. USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. Phishing tokens that spoof USDC name and symbol are filtered out by exact contract match.

Wallets covered: 21. Groups: Core operating, Personal pre-handoff, Brand-owned, Holding (shared), Historic creators.

## Master summary

| Group | Wallet | Address | USDC in | USDC out | USDC net | Tx | Gas (ETH) |
|-------|--------|---------|--------:|---------:|---------:|---:|----------:|
| Core operating | RRG / PLATFORM_WALLET | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | 7.66 | 6.34 | 1.32 | 26 | 0.000008 |
| Core operating | DEPLOYER | `0x369d04f08f245454926ac96a0164a634fd94660b` | 5.00 | 1.39 | 3.61 | 7 | 0.000343 |
| Core operating | VIA Team Wallet | `0x58554E8423EF5C10be6fFC82EfABA9149f64de3d` | 0.00 | 0.00 | 0.00 | 0 | 0.000000 |
| Core operating | DrHobbs (also pre-handoff #4) | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | 3.05 | 5.95 | -2.90 | 27 | 0.000006 |
| Personal pre-handoff | East Coast Cassettes (eastcoast) | `0x61e01997e6a0C692656e94955c67CB3ebcAb8f19` | 1.40 | 0.00 | 1.40 | 5 | 0.000000 |
| Personal pre-handoff | Digital Fashion Week (dfw) | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | 95.64 | 14.79 | 80.85 | 27 | 0.000003 |
| Personal pre-handoff | Unbound personal wallet | `0xdB59CD2c8F9c6e576510bf7ED294654f41241B65` | 0.00 | 0.00 | 0.00 | 0 | 0.000000 |
| Brand-owned | Artemist | `0x2c9a1dadd6cb5425bf0e677fada64a257a558438` | 1.00 | 0.70 | 0.30 | 7 | 0.000000 |
| Brand-owned | Clooudie | `0xca5c9c4da1787fea491ed6c94e86b04ec46be61d` | 0.98 | 0.00 | 0.98 | 2 | 0.000003 |
| Brand-owned | Frey Tailored | `0x30b1e8cc377a75d9664c26415a820c4925afa595` | 0.49 | 0.00 | 0.49 | 1 | 0.000005 |
| Brand-owned | LIVVIUM | `0x019d94b9c90abd38f84ebbb488e6c833cdeffc57` | 0.00 | 0.00 | 0.00 | 0 | 0.000000 |
| Brand-owned | MYKLÉ | `0x9eb5405fef682e1d4d555f64a683a499076556a3` | 0.00 | 0.00 | 0.00 | 0 | 0.000004 |
| Brand-owned | Nolo | `0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d` | 0.98 | 0.00 | 0.98 | 2 | 0.000004 |
| Brand-owned | PassportADV | `0xb4febbe6c0a0cd350c76054ccfd037d8bf47e502` | 0.00 | 0.00 | 0.00 | 0 | 0.000004 |
| Brand-owned | The Year Of... | `0x699e234a877ba075e1f16abb63f895a8a2250388` | 0.00 | 0.00 | 0.00 | 0 | 0.000000 |
| Brand-owned | Unknown Union | `0xe7ed24a6a66170070c725451c003917da83871da` | 0.00 | 0.00 | 0.00 | 0 | 0.000000 |
| Holding (shared) | RRG Test Brands holding | `0x734a25fB869ab6415b78bbe9a39f1f99dab349E7` | 0.49 | 0.00 | 0.49 | 1 | 0.000000 |
| Historic creators | Original RRG creator (token 13) | `0x0e0ef55048fb7b68b06dec7a6413b086a7ec029a` | 0.53 | 0.00 | 0.53 | 2 | 0.000000 |
| Historic creators | Nolo handoff intermediary (tokens 568-570) | `0x891c13aa323378637404efd971553a3a6df5aaf1` | 0.00 | 0.00 | 0.00 | 0 | 0.000004 |
| Historic creators | Artemist original creator (token 44) | `0xf2e7289889ea5ecc557439a134906f77a1d64b3e` | 0.00 | 0.00 | 0.00 | 0 | 0.000000 |
| Historic creators | RRG submission original creator (tokens 12,19) | `0xf7bba988b1e9f28dcb293ed564b57f965ae1ec2b` | 0.00 | 0.00 | 0.00 | 0 | 0.000000 |

## Group totals

| Group | Wallets | USDC in | USDC out | USDC net | Total tx | Total gas (ETH) |
|-------|--------:|--------:|---------:|---------:|---------:|----------------:|
| Core operating | 4 | 15.71 | 13.68 | 2.03 | 60 | 0.000357 |
| Personal pre-handoff | 3 | 97.04 | 14.79 | 82.25 | 32 | 0.000003 |
| Brand-owned | 9 | 3.45 | 0.70 | 2.75 | 12 | 0.000019 |
| Holding (shared) | 1 | 0.49 | 0.00 | 0.49 | 1 | 0.000000 |
| Historic creators | 4 | 0.53 | 0.00 | 0.53 | 2 | 0.000004 |

## USDC transfer detail (per wallet, last 90 days)

Tx tables omit zero-value spam (filter applied: `value_usdc > 0`). Counterparty is the other side of the transfer relative to the wallet.

### Group: Core operating

#### RRG / PLATFORM_WALLET: `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed`

Non-zero tx: 25 of 26 total. USDC net: 1.32.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-05-06 | OUT | 0.49 | `0xca5c9C4dA1787feA491eD6c94E86b04Ec46BE61d` | [`0x2601226d…`](https://basescan.org/tx/0x2601226dd5b263ae2d2cd68b9d0eee8b3d7c06437dabcee3cc2e918b035bc4a1) |
| 2026-05-06 | IN | 0.50 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x928a4b7d…`](https://basescan.org/tx/0x928a4b7d0152eea1e7515e34bf978faf3426af7168697d99e062f85c1aa64b67) |
| 2026-05-06 | OUT | 2.00 | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | [`0xb250b2cb…`](https://basescan.org/tx/0xb250b2cb3437dd73004f87d13eb89798549b47bb215e203587db6c3868c0d40a) |
| 2026-05-06 | IN | 2.00 | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | [`0xc814754e…`](https://basescan.org/tx/0xc814754ea2b136e4e7d42585a76ce5b574a34ac08bcf3f865320a56617a82983) |
| 2026-04-28 | OUT | 0.49 | `0x734a25fB869ab6415b78bbe9a39f1f99dab349E7` | [`0x6183c095…`](https://basescan.org/tx/0x6183c095e1c5144e0b63d60d48606256c6ab7d9ec2426bf59873682a4aca37c4) |
| 2026-04-28 | IN | 0.50 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x0796f5e5…`](https://basescan.org/tx/0x0796f5e5911d0b8012436326cbd464b1902e9388c9d02fdf86f80e611e9c92d7) |
| 2026-04-28 | OUT | 0.49 | `0xca5c9C4dA1787feA491eD6c94E86b04Ec46BE61d` | [`0xa8c0d133…`](https://basescan.org/tx/0xa8c0d13311b1f66cf3bd3c62334c1db258f94202b978c72cf5f9d73219b91df1) |
| 2026-04-28 | IN | 0.50 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0xe6b3fcbb…`](https://basescan.org/tx/0xe6b3fcbb0000a6c8241e674642c6610bdc12c322be4b1ba6d25b162feb7af05b) |
| 2026-04-27 | OUT | 0.49 | `0x30b1e8CC377a75D9664C26415A820C4925afa595` | [`0xaeb39820…`](https://basescan.org/tx/0xaeb39820adb6e7433739c095327f5fda69df16f8606cea3656f4c3ade51f1226) |
| 2026-04-27 | IN | 0.50 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x365dbc9d…`](https://basescan.org/tx/0x365dbc9dba9feb2ff6093cb035c924653bf25782c203c05e89b8d3e410912ef6) |
| 2026-04-27 | OUT | 0.49 | `0x27daa49fB93445cDB6e3f3a6BE7Cd6baE1f04E2d` | [`0x62bf0ed5…`](https://basescan.org/tx/0x62bf0ed58ed4e33cfcf6d990961ef7b6448d1ab541f69fb47aab4155b88652d0) |
| 2026-04-27 | IN | 0.50 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0xba1d2ab2…`](https://basescan.org/tx/0xba1d2ab27c8fbf8d911ed1685deab827c54b598495ce81c1ed7cd977ea4d206a) |
| 2026-04-27 | OUT | 0.49 | `0x27daa49fB93445cDB6e3f3a6BE7Cd6baE1f04E2d` | [`0x1371e430…`](https://basescan.org/tx/0x1371e43057cbb8f294fd6b6e97148348370d1e288370d51b8abe2a111a5b9801) |
| 2026-04-27 | IN | 0.50 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x4340636f…`](https://basescan.org/tx/0x4340636f67918b785b71bcec4867e84bcf11d07d986c3d245694fd7acf91d014) |
| 2026-03-20 | IN | 0.10 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x98303a99…`](https://basescan.org/tx/0x98303a991a189df87ebe1f2be02f0c38cce398f37a048fd57692feebdd3755c6) |
| 2026-03-20 | IN | 0.03 | `0x2C9a1DAdD6Cb5425Bf0e677FAdA64a257a558438` | [`0xdbb96084…`](https://basescan.org/tx/0xdbb960840bb5758abf4e6646f86399357031dd5667ee9e97bbd282608b8f2b5d) |
| 2026-03-20 | IN | 0.03 | `0x2C9a1DAdD6Cb5425Bf0e677FAdA64a257a558438` | [`0x47f42180…`](https://basescan.org/tx/0x47f421804d0797cc7c3259b393c6cbb45edcd3a052a46c759d9c0ebe9218ef95) |
| 2026-03-19 | IN | 0.50 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x4f39efcc…`](https://basescan.org/tx/0x4f39efcc967ab6b14d073823b177a8a0eca2eecdef309ba5e9213362cc548178) |
| 2026-03-19 | OUT | 0.35 | `0x61e01997e6a0C692656e94955c67CB3ebcAb8f19` | [`0x43466af9…`](https://basescan.org/tx/0x43466af97ccc759516df3867f47663b35e987e16cf753269345d936a8aacd0c3) |
| 2026-03-19 | OUT | 0.35 | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | [`0xa99ff082…`](https://basescan.org/tx/0xa99ff0827ad70926a5238c7e4e9c5b01f813f580b26cc1abd25fb45e7eec38d7) |
| 2026-03-19 | IN | 1.00 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x9f8e12cc…`](https://basescan.org/tx/0x9f8e12ccd0b0da5ec07e9b0c1999e0961f7ae7d370d5613f3576bbdcc76c775e) |
| 2026-03-18 | OUT | 0.35 | `0x61e01997e6a0C692656e94955c67CB3ebcAb8f19` | [`0x5bb1c783…`](https://basescan.org/tx/0x5bb1c78367599fbc5adf4585251a0e2c5e15a681dfc16073b375391bcd7202e2) |
| 2026-03-18 | IN | 0.50 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0xe620d9f4…`](https://basescan.org/tx/0xe620d9f4d8c6f159ae47275860e456afae6fc7d35f00880ee6b8b7f637ee6487) |
| 2026-03-18 | OUT | 0.35 | `0x61e01997e6a0C692656e94955c67CB3ebcAb8f19` | [`0xb06c134b…`](https://basescan.org/tx/0xb06c134b1d14c426fc6ba69c94faf61b0128647d30ca327b6dbc681d77acb8d0) |
| 2026-03-18 | IN | 0.50 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x54d21d08…`](https://basescan.org/tx/0x54d21d08ae2ec8047afb564a423da8157160ca7d315930912cdecc7f0df2956f) |

#### DEPLOYER: `0x369d04f08f245454926ac96a0164a634fd94660b`

Non-zero tx: 7 of 7 total. USDC net: 3.61.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-03-21 | OUT | 0.07 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x9cd2258d…`](https://basescan.org/tx/0x9cd2258d562cc19fda71c856bbe8c868c0d43110b429c86adf1d6713c9449287) |
| 2026-03-21 | OUT | 0.07 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x7a126bf1…`](https://basescan.org/tx/0x7a126bf1403eca4833ee88c692238015486045fefb1137605365277b5744421f) |
| 2026-03-20 | OUT | 0.07 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0xc8ba66b8…`](https://basescan.org/tx/0xc8ba66b8bcdaef2d4c0b2eb574f6a62366d504598abc42e825caecef6d20778f) |
| 2026-03-16 | OUT | 0.18 | `0x0e0eF55048Fb7B68B06Dec7a6413B086a7Ec029a` | [`0x57ddd9b1…`](https://basescan.org/tx/0x57ddd9b19ac085fd9bc7677b45256e14f86e765076efa7199f7c1e7b2c69a8c7) |
| 2026-03-09 | OUT | 1.00 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x3c9d6ef8…`](https://basescan.org/tx/0x3c9d6ef84775032d7f966fc09eeeed3ad9c3bfc3b28e4cfaa42ed144d3236370) |
| 2026-03-09 | IN | 2.00 | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | [`0xbf4305f0…`](https://basescan.org/tx/0xbf4305f0e252de58b8540cd31d79958c249ba7b19903d1afa23b3f57cb9376f3) |
| 2026-03-05 | IN | 3.00 | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | [`0x7e4a6823…`](https://basescan.org/tx/0x7e4a682354ee7ad6548b6ff74c829755c451f16491e24227ccf9468fbd82e3ec) |

#### VIA Team Wallet: `0x58554E8423EF5C10be6fFC82EfABA9149f64de3d`

No non-zero USDC transfers in window. Total tx count including zero-value: 0.

#### DrHobbs (also pre-handoff #4): `0xe653804032A2d51Cc031795afC601B9b1fd2c375`

Non-zero tx: 26 of 27 total. USDC net: -2.90.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-05-06 | OUT | 0.50 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x928a4b7d…`](https://basescan.org/tx/0x928a4b7d0152eea1e7515e34bf978faf3426af7168697d99e062f85c1aa64b67) |
| 2026-04-28 | OUT | 0.50 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x0796f5e5…`](https://basescan.org/tx/0x0796f5e5911d0b8012436326cbd464b1902e9388c9d02fdf86f80e611e9c92d7) |
| 2026-04-28 | OUT | 0.50 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0xe6b3fcbb…`](https://basescan.org/tx/0xe6b3fcbb0000a6c8241e674642c6610bdc12c322be4b1ba6d25b162feb7af05b) |
| 2026-04-27 | OUT | 0.50 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x365dbc9d…`](https://basescan.org/tx/0x365dbc9dba9feb2ff6093cb035c924653bf25782c203c05e89b8d3e410912ef6) |
| 2026-04-27 | OUT | 0.50 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0xba1d2ab2…`](https://basescan.org/tx/0xba1d2ab27c8fbf8d911ed1685deab827c54b598495ce81c1ed7cd977ea4d206a) |
| 2026-04-27 | OUT | 0.50 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x4340636f…`](https://basescan.org/tx/0x4340636f67918b785b71bcec4867e84bcf11d07d986c3d245694fd7acf91d014) |
| 2026-03-21 | IN | 0.07 | `0x369d04F08F245454926AC96a0164a634fd94660B` | [`0x9cd2258d…`](https://basescan.org/tx/0x9cd2258d562cc19fda71c856bbe8c868c0d43110b429c86adf1d6713c9449287) |
| 2026-03-21 | IN | 0.07 | `0x369d04F08F245454926AC96a0164a634fd94660B` | [`0x7a126bf1…`](https://basescan.org/tx/0x7a126bf1403eca4833ee88c692238015486045fefb1137605365277b5744421f) |
| 2026-03-20 | OUT | 0.10 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x98303a99…`](https://basescan.org/tx/0x98303a991a189df87ebe1f2be02f0c38cce398f37a048fd57692feebdd3755c6) |
| 2026-03-20 | IN | 0.07 | `0x2C9a1DAdD6Cb5425Bf0e677FAdA64a257a558438` | [`0xdbb96084…`](https://basescan.org/tx/0xdbb960840bb5758abf4e6646f86399357031dd5667ee9e97bbd282608b8f2b5d) |
| 2026-03-20 | IN | 0.07 | `0x369d04F08F245454926AC96a0164a634fd94660B` | [`0xc8ba66b8…`](https://basescan.org/tx/0xc8ba66b8bcdaef2d4c0b2eb574f6a62366d504598abc42e825caecef6d20778f) |
| 2026-03-20 | IN | 0.07 | `0x2C9a1DAdD6Cb5425Bf0e677FAdA64a257a558438` | [`0x47f42180…`](https://basescan.org/tx/0x47f421804d0797cc7c3259b393c6cbb45edcd3a052a46c759d9c0ebe9218ef95) |
| 2026-03-19 | OUT | 0.50 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x4f39efcc…`](https://basescan.org/tx/0x4f39efcc967ab6b14d073823b177a8a0eca2eecdef309ba5e9213362cc548178) |
| 2026-03-19 | OUT | 1.00 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x9f8e12cc…`](https://basescan.org/tx/0x9f8e12ccd0b0da5ec07e9b0c1999e0961f7ae7d370d5613f3576bbdcc76c775e) |
| 2026-03-18 | OUT | 0.50 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0xe620d9f4…`](https://basescan.org/tx/0xe620d9f4d8c6f159ae47275860e456afae6fc7d35f00880ee6b8b7f637ee6487) |
| 2026-03-18 | OUT | 0.50 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x54d21d08…`](https://basescan.org/tx/0x54d21d08ae2ec8047afb564a423da8157160ca7d315930912cdecc7f0df2956f) |
| 2026-03-16 | IN | 0.00 | `0x61Ee12e276F8532E60033aD4404F6059740f6f19` | [`0x854c2b68…`](https://basescan.org/tx/0x854c2b6847a772bb1193774cecd608e84553eb61fb289952a7a9c0eb8bb19ff1) |
| 2026-03-16 | OUT | 0.35 | `0x61e01997e6a0C692656e94955c67CB3ebcAb8f19` | [`0xcf3fd2a5…`](https://basescan.org/tx/0xcf3fd2a5797ad472e9bb5ac7b367dc67397e43865f4fb4976fd1f9902d359d2e) |
| 2026-03-16 | IN | 0.15 | `0x2C9a1DAdD6Cb5425Bf0e677FAdA64a257a558438` | [`0xd6db1cf8…`](https://basescan.org/tx/0xd6db1cf8f096f5cfe7cc9ca09a70a800ba55db427ef13fa32b27f1dd3286a08d) |
| 2026-03-16 | IN | 0.35 | `0x2C9a1DAdD6Cb5425Bf0e677FAdA64a257a558438` | [`0xd6db1cf8…`](https://basescan.org/tx/0xd6db1cf8f096f5cfe7cc9ca09a70a800ba55db427ef13fa32b27f1dd3286a08d) |
| 2026-03-16 | IN | 0.15 | `0x25B22971892B7314c36EC6DCfB5537500d50Ea35` | [`0x437af8fd…`](https://basescan.org/tx/0x437af8fd3abd8fc87e5f25c5768afc5d594a8ab1f5b985419878d10a95f27c26) |
| 2026-03-09 | IN | 1.00 | `0x369d04F08F245454926AC96a0164a634fd94660B` | [`0x3c9d6ef8…`](https://basescan.org/tx/0x3c9d6ef84775032d7f966fc09eeeed3ad9c3bfc3b28e4cfaa42ed144d3236370) |
| 2026-03-09 | IN | 0.30 | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | [`0xfaf35806…`](https://basescan.org/tx/0xfaf35806fb04e5b3f04c041b86bd294b42b6db9cbc1e138fde5a29a7f8c99d12) |
| 2026-03-04 | IN | 0.00 | `0xC1235A357693D4312CF403219b55c44ccF41Bd75` | [`0x29e8cd7d…`](https://basescan.org/tx/0x29e8cd7d11ff8c653acddeca86e79e4ef682d3d56ef94fe4d1f6871458fc4b3f) |
| 2026-03-04 | IN | 0.25 | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | [`0x9ecfa86f…`](https://basescan.org/tx/0x9ecfa86fd3e064622ef3926820cf503990234bb1be0a92dd8eb5e7555e4a68ef) |
| 2026-03-03 | IN | 0.50 | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | [`0xcdd3ec7a…`](https://basescan.org/tx/0xcdd3ec7acd15f4f4ba237fe689a6757a71a77e6e2f3b9ae12861e8f1523a60a3) |

### Group: Personal pre-handoff

#### East Coast Cassettes (eastcoast): `0x61e01997e6a0C692656e94955c67CB3ebcAb8f19`

Non-zero tx: 5 of 5 total. USDC net: 1.40.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-03-19 | IN | 0.35 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x43466af9…`](https://basescan.org/tx/0x43466af97ccc759516df3867f47663b35e987e16cf753269345d936a8aacd0c3) |
| 2026-03-18 | IN | 0.35 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x5bb1c783…`](https://basescan.org/tx/0x5bb1c78367599fbc5adf4585251a0e2c5e15a681dfc16073b375391bcd7202e2) |
| 2026-03-18 | IN | 0.35 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0xb06c134b…`](https://basescan.org/tx/0xb06c134b1d14c426fc6ba69c94faf61b0128647d30ca327b6dbc681d77acb8d0) |
| 2026-03-16 | IN | 0.00 | `0xe656Ea297C34fabc660C38b23f41ea56E66a4375` | [`0xf18897df…`](https://basescan.org/tx/0xf18897dff67c1278d8f9102518e7846f7cccb086faac3da6db4de9b474c20807) |
| 2026-03-16 | IN | 0.35 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0xcf3fd2a5…`](https://basescan.org/tx/0xcf3fd2a5797ad472e9bb5ac7b367dc67397e43865f4fb4976fd1f9902d359d2e) |

#### Digital Fashion Week (dfw): `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75`

Non-zero tx: 26 of 27 total. USDC net: 80.85.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-05-06 | OUT | 0.01 | `0xe3478b0BB1A5084567C319096437924948Be1964` | [`0xfae3fd5a…`](https://basescan.org/tx/0xfae3fd5acde94228038e25ee50d24a2f455ce80c0e9bf87797d33c10467dbdc7) |
| 2026-05-06 | OUT | 2.00 | `0xa439d88ecd114226e28289E32CD0c8c4A1b300ab` | [`0xfae3fd5a…`](https://basescan.org/tx/0xfae3fd5acde94228038e25ee50d24a2f455ce80c0e9bf87797d33c10467dbdc7) |
| 2026-05-06 | OUT | 0.01 | `0xe3478b0BB1A5084567C319096437924948Be1964` | [`0x2a7258be…`](https://basescan.org/tx/0x2a7258bede414ae7b9156ba979c554260a1fe603761627a6fd099fd3592ac03b) |
| 2026-05-06 | OUT | 2.00 | `0xb33fb3fd97922D3a8BF4B086aF8660Bb12CBb1F8` | [`0x2a7258be…`](https://basescan.org/tx/0x2a7258bede414ae7b9156ba979c554260a1fe603761627a6fd099fd3592ac03b) |
| 2026-05-06 | IN | 2.00 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0xb250b2cb…`](https://basescan.org/tx/0xb250b2cb3437dd73004f87d13eb89798549b47bb215e203587db6c3868c0d40a) |
| 2026-05-06 | IN | 0.00 | `0xBfD7a92543aE9C1EdB89Ac2015c63865CD97B7ED` | [`0x6a70cf27…`](https://basescan.org/tx/0x6a70cf27a5a832e2bcb219f4cf13d959af7c94a43e0055346e9d3ea5adb2571b) |
| 2026-05-06 | OUT | 2.00 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0xc814754e…`](https://basescan.org/tx/0xc814754ea2b136e4e7d42585a76ce5b574a34ac08bcf3f865320a56617a82983) |
| 2026-03-19 | IN | 0.35 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0xa99ff082…`](https://basescan.org/tx/0xa99ff0827ad70926a5238c7e4e9c5b01f813f580b26cc1abd25fb45e7eec38d7) |
| 2026-03-16 | OUT | 0.01 | `0xe3478b0BB1A5084567C319096437924948Be1964` | [`0x6ad56841…`](https://basescan.org/tx/0x6ad56841a6647105703ec70a8ca150b33c5bde991750783f90caa20e4d7c70ba) |
| 2026-03-16 | OUT | 1.00 | `0x2C9a1DAdD6Cb5425Bf0e677FAdA64a257a558438` | [`0x6ad56841…`](https://basescan.org/tx/0x6ad56841a6647105703ec70a8ca150b33c5bde991750783f90caa20e4d7c70ba) |
| 2026-03-16 | OUT | 0.01 | `0xe3478b0BB1A5084567C319096437924948Be1964` | [`0x99116e9c…`](https://basescan.org/tx/0x99116e9c1457c18c52c3abe7e517ff232d48eb25e01894b132bf98ef22db67ac) |
| 2026-03-16 | OUT | 1.00 | `0x25B22971892B7314c36EC6DCfB5537500d50Ea35` | [`0x99116e9c…`](https://basescan.org/tx/0x99116e9c1457c18c52c3abe7e517ff232d48eb25e01894b132bf98ef22db67ac) |
| 2026-03-09 | OUT | 0.00 | `0xe3478b0BB1A5084567C319096437924948Be1964` | [`0xbf4305f0…`](https://basescan.org/tx/0xbf4305f0e252de58b8540cd31d79958c249ba7b19903d1afa23b3f57cb9376f3) |
| 2026-03-09 | OUT | 2.00 | `0x369d04F08F245454926AC96a0164a634fd94660B` | [`0xbf4305f0…`](https://basescan.org/tx/0xbf4305f0e252de58b8540cd31d79958c249ba7b19903d1afa23b3f57cb9376f3) |
| 2026-03-09 | OUT | 0.30 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0xfaf35806…`](https://basescan.org/tx/0xfaf35806fb04e5b3f04c041b86bd294b42b6db9cbc1e138fde5a29a7f8c99d12) |
| 2026-03-09 | IN | 0.70 | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | [`0xfaf35806…`](https://basescan.org/tx/0xfaf35806fb04e5b3f04c041b86bd294b42b6db9cbc1e138fde5a29a7f8c99d12) |
| 2026-03-09 | IN | 0.00 | `0xD898341e07bf5cD9149E87e486698440Bed26456` | [`0xdaf33d47…`](https://basescan.org/tx/0xdaf33d47cb40274363ae346d9629903984344fb34c34bf43663e22b798ce3738) |
| 2026-03-09 | IN | 45.00 | `0xD89216beBfEFc98A53E56d5fbF24eB5793f70456` | [`0xdd132328…`](https://basescan.org/tx/0xdd1323283c2c9036a877dccbe9ddf8769ef7a7e5d48775001eea0b0214426643) |
| 2026-03-07 | IN | 43.71 | `0xaCc0c1f672B03B9a5fED4535f840f09B85f40E98` | [`0x9bcb8559…`](https://basescan.org/tx/0x9bcb85591815e8b125d858ebf26c10ea4716efc14bb9dfb862a407d0e7ec1fb5) |
| 2026-03-05 | OUT | 0.00 | `0xe3478b0BB1A5084567C319096437924948Be1964` | [`0x7e4a6823…`](https://basescan.org/tx/0x7e4a682354ee7ad6548b6ff74c829755c451f16491e24227ccf9468fbd82e3ec) |
| 2026-03-05 | OUT | 3.00 | `0x369d04F08F245454926AC96a0164a634fd94660B` | [`0x7e4a6823…`](https://basescan.org/tx/0x7e4a682354ee7ad6548b6ff74c829755c451f16491e24227ccf9468fbd82e3ec) |
| 2026-03-04 | IN | 0.00 | `0xe65197a57a2f04383056dF2F7Ce924931f97A375` | [`0x5e7dd40a…`](https://basescan.org/tx/0x5e7dd40a26949316881c4334141a69b7aa00151a111b2ee34ec529464b0a97bc) |
| 2026-03-04 | OUT | 0.25 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x9ecfa86f…`](https://basescan.org/tx/0x9ecfa86fd3e064622ef3926820cf503990234bb1be0a92dd8eb5e7555e4a68ef) |
| 2026-03-03 | OUT | 0.01 | `0xe3478b0BB1A5084567C319096437924948Be1964` | [`0xcdd3ec7a…`](https://basescan.org/tx/0xcdd3ec7acd15f4f4ba237fe689a6757a71a77e6e2f3b9ae12861e8f1523a60a3) |
| 2026-03-03 | OUT | 0.50 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0xcdd3ec7a…`](https://basescan.org/tx/0xcdd3ec7acd15f4f4ba237fe689a6757a71a77e6e2f3b9ae12861e8f1523a60a3) |
| 2026-03-03 | IN | 3.87 | `0x0a2854Fbbd9B3Ef66F17d47284E7f899b9509330` | [`0x69c6f045…`](https://basescan.org/tx/0x69c6f04553667e722c60d2d0cc79b7d064ef494dc608d8140526fcd81efe9d25) |

#### Unbound personal wallet: `0xdB59CD2c8F9c6e576510bf7ED294654f41241B65`

No non-zero USDC transfers in window. Total tx count including zero-value: 0.

### Group: Brand-owned

#### Artemist: `0x2c9a1dadd6cb5425bf0e677fada64a257a558438`

Non-zero tx: 7 of 7 total. USDC net: 0.30.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-03-20 | OUT | 0.03 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0xdbb96084…`](https://basescan.org/tx/0xdbb960840bb5758abf4e6646f86399357031dd5667ee9e97bbd282608b8f2b5d) |
| 2026-03-20 | OUT | 0.07 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0xdbb96084…`](https://basescan.org/tx/0xdbb960840bb5758abf4e6646f86399357031dd5667ee9e97bbd282608b8f2b5d) |
| 2026-03-20 | OUT | 0.03 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x47f42180…`](https://basescan.org/tx/0x47f421804d0797cc7c3259b393c6cbb45edcd3a052a46c759d9c0ebe9218ef95) |
| 2026-03-20 | OUT | 0.07 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0x47f42180…`](https://basescan.org/tx/0x47f421804d0797cc7c3259b393c6cbb45edcd3a052a46c759d9c0ebe9218ef95) |
| 2026-03-16 | OUT | 0.15 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0xd6db1cf8…`](https://basescan.org/tx/0xd6db1cf8f096f5cfe7cc9ca09a70a800ba55db427ef13fa32b27f1dd3286a08d) |
| 2026-03-16 | OUT | 0.35 | `0xe653804032A2d51Cc031795afC601B9b1fd2c375` | [`0xd6db1cf8…`](https://basescan.org/tx/0xd6db1cf8f096f5cfe7cc9ca09a70a800ba55db427ef13fa32b27f1dd3286a08d) |
| 2026-03-16 | IN | 1.00 | `0xc12Ecf02448e0E56DAd9C0D5473553b80d030D75` | [`0x6ad56841…`](https://basescan.org/tx/0x6ad56841a6647105703ec70a8ca150b33c5bde991750783f90caa20e4d7c70ba) |

#### Clooudie: `0xca5c9c4da1787fea491ed6c94e86b04ec46be61d`

Non-zero tx: 2 of 2 total. USDC net: 0.98.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-05-06 | IN | 0.49 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x2601226d…`](https://basescan.org/tx/0x2601226dd5b263ae2d2cd68b9d0eee8b3d7c06437dabcee3cc2e918b035bc4a1) |
| 2026-04-28 | IN | 0.49 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0xa8c0d133…`](https://basescan.org/tx/0xa8c0d13311b1f66cf3bd3c62334c1db258f94202b978c72cf5f9d73219b91df1) |

#### Frey Tailored: `0x30b1e8cc377a75d9664c26415a820c4925afa595`

Non-zero tx: 1 of 1 total. USDC net: 0.49.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-04-27 | IN | 0.49 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0xaeb39820…`](https://basescan.org/tx/0xaeb39820adb6e7433739c095327f5fda69df16f8606cea3656f4c3ade51f1226) |

#### LIVVIUM: `0x019d94b9c90abd38f84ebbb488e6c833cdeffc57`

No non-zero USDC transfers in window. Total tx count including zero-value: 0.

#### MYKLÉ: `0x9eb5405fef682e1d4d555f64a683a499076556a3`

No non-zero USDC transfers in window. Total tx count including zero-value: 0.

#### Nolo: `0x27daa49fb93445cdb6e3f3a6be7cd6bae1f04e2d`

Non-zero tx: 2 of 2 total. USDC net: 0.98.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-04-27 | IN | 0.49 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x62bf0ed5…`](https://basescan.org/tx/0x62bf0ed58ed4e33cfcf6d990961ef7b6448d1ab541f69fb47aab4155b88652d0) |
| 2026-04-27 | IN | 0.49 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x1371e430…`](https://basescan.org/tx/0x1371e43057cbb8f294fd6b6e97148348370d1e288370d51b8abe2a111a5b9801) |

#### PassportADV: `0xb4febbe6c0a0cd350c76054ccfd037d8bf47e502`

No non-zero USDC transfers in window. Total tx count including zero-value: 0.

#### The Year Of...: `0x699e234a877ba075e1f16abb63f895a8a2250388`

No non-zero USDC transfers in window. Total tx count including zero-value: 0.

#### Unknown Union: `0xe7ed24a6a66170070c725451c003917da83871da`

No non-zero USDC transfers in window. Total tx count including zero-value: 0.

### Group: Holding (shared)

#### RRG Test Brands holding: `0x734a25fB869ab6415b78bbe9a39f1f99dab349E7`

Non-zero tx: 1 of 1 total. USDC net: 0.49.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-04-28 | IN | 0.49 | `0xbfd71eA27FFc99747dA2873372f84346d9A8b7ed` | [`0x6183c095…`](https://basescan.org/tx/0x6183c095e1c5144e0b63d60d48606256c6ab7d9ec2426bf59873682a4aca37c4) |

### Group: Historic creators

#### Original RRG creator (token 13): `0x0e0ef55048fb7b68b06dec7a6413b086a7ec029a`

Non-zero tx: 2 of 2 total. USDC net: 0.53.

| Date | Direction | USDC | Counterparty | Tx |
|------|-----------|-----:|--------------|----|
| 2026-03-16 | IN | 0.18 | `0x369d04F08F245454926AC96a0164a634fd94660B` | [`0x57ddd9b1…`](https://basescan.org/tx/0x57ddd9b19ac085fd9bc7677b45256e14f86e765076efa7199f7c1e7b2c69a8c7) |
| 2026-03-16 | IN | 0.35 | `0x25B22971892B7314c36EC6DCfB5537500d50Ea35` | [`0x437af8fd…`](https://basescan.org/tx/0x437af8fd3abd8fc87e5f25c5768afc5d594a8ab1f5b985419878d10a95f27c26) |

#### Nolo handoff intermediary (tokens 568-570): `0x891c13aa323378637404efd971553a3a6df5aaf1`

No non-zero USDC transfers in window. Total tx count including zero-value: 0.

#### Artemist original creator (token 44): `0xf2e7289889ea5ecc557439a134906f77a1d64b3e`

No non-zero USDC transfers in window. Total tx count including zero-value: 0.

#### RRG submission original creator (tokens 12,19): `0xf7bba988b1e9f28dcb293ed564b57f965ae1ec2b`

No non-zero USDC transfers in window. Total tx count including zero-value: 0.

