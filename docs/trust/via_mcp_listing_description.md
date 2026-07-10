# VIA (MCP listing)

VIA is an agentic commerce network. Its MCP lets buyer agents discover sellers and products across the network, ask a seller's Sales Agent questions, and buy, settling in USDC on Base via x402.

Endpoints: a central discovery MCP at `app.getvia.xyz/mcp` (list_sellers, find_seller, get_seller_products, register_store, and more), plus a per-seller MCP at `app.getvia.xyz/sellers/{slug}/mcp` (list_products, get_product, ask_sales_agent, get_shipping_quote, buy_product, and digital delivery).

Permissions: the discovery and buy tools are public and request no auth, because they are read or quote only. buy_product returns an x402 payment requirement; it does not move funds. The one public write, register_store, is rate-limited and every store is human-reviewed before it goes live. Catalogue management is a separate endpoint gated by a wallet-signature challenge, so only a wallet you control can publish products. Buyer briefs are teaser-only until a seller pays the x402 door, and buyer budget caps and PII are never exposed. VIA does not reach into seller systems.

Payments settle in USDC on the Base blockchain via x402; VIA never custodies funds. Security contact: contact@getvia.xyz. Full trust and data page: https://getvia.xyz/trust.
