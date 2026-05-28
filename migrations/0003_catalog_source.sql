-- migrations/0003_catalog_source.sql
--
-- Adds catalogue-source metadata to app_sellers so sync flows
-- (Shopify, Squarespace) know what to pull and at what FX rate.
--
-- catalog_source  — 'shopify' | 'squarespace' | 'csv' | 'services' | null.
--                   Captured during onboarding (the wizard's catalog step)
--                   and used by the dashboard to surface the right sync
--                   button. Existing rows stay null.
--
-- squarespace_shop_url — full URL to the Squarespace shop page (e.g.
--                        https://www.passportadv.com/shop-1). Symmetric
--                        with shopify_domain. Null when source isn't
--                        Squarespace.
--
-- source_currency — ISO 4217 code (3 letters) of the seller's native
--                   storefront pricing currency. Used by sync flows to
--                   convert price → USDC via frankfurter.app + 3% spread.
--                   Defaults to USD (most common, no conversion needed).
--                   Stored in upper case; check constraint enforces 3-letter shape.

alter table app_sellers
  add column if not exists catalog_source       text
                                                check (catalog_source in ('shopify', 'squarespace', 'csv', 'services')),
  add column if not exists squarespace_shop_url text,
  add column if not exists source_currency      text not null default 'USD'
                                                check (length(source_currency) = 3
                                                       and source_currency = upper(source_currency));
