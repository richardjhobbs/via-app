-- Forward-only cutover to a VIA-branded mint contract.
--
-- VIA forked from RRG and historically minted every product receipt on the
-- legacy RRG ERC-1155 (0x9f07621f73e7caaf2040c35833d5350f666b7177, name
-- "RRG - Real Real Genuine"). A VIA-branded contract ("VIA Network") is being
-- deployed; from then on all NEW drops register/mint on it, while existing
-- tokens stay on the legacy contract.
--
-- This column records which contract a product's drop was registered on so
-- every on-chain read (getDrop, balanceOf, mint resume) targets the right one.
-- NULL = legacy contract (every pre-existing row), resolved at read time as
-- on_chain_contract_address ?? NEXT_PUBLIC_VIA_CONTRACT_ADDRESS.

ALTER TABLE app_seller_products
  ADD COLUMN IF NOT EXISTS on_chain_contract_address text;
