-- migrations/0004_shipping.sql
--
-- Adds a jsonb column to app_sellers storing the seller's shipping
-- configuration. Pattern ported from via-brand-onboarding's
-- rrg_brands.brand_data.shipping; via-app stores it as a dedicated
-- column rather than under a generic blob so queries / filters can
-- target shipping policy directly (e.g. "active sellers with
-- domestic shipping to a given country").
--
-- ShippingConfig shape (validated server-side in lib/app/shipping.ts):
--
--   {
--     mode:                  'flat_rate' | 'quote_on_purchase',
--     ships_from_country?:   'GB' | 'US' | ...        -- ISO 3166-1 alpha-2
--     domestic_flat_usd?:    number  >= 0             -- USD, six decimals NOT stored here (presentation layer is human USD)
--     international_flat_usd?: number | null          -- null = no international shipping
--     excluded_countries?:   ['XX', ...]              -- ISO 3166-1 alpha-2 codes
--     notes?:                string                   -- e.g. "Free over $200"
--   }
--
-- Empty default '{}' so existing rows (incl. arc-lights) do not error
-- on read; lib/app/shipping.ts isShippingReady() treats an empty object
-- as unconfigured.

alter table app_sellers
  add column if not exists shipping jsonb not null default '{}'::jsonb;

create index if not exists app_sellers_shipping_mode_idx
  on app_sellers ((shipping->>'mode'));
