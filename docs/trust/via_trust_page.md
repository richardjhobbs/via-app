# Trust and your data on VIA

VIA connects your store to buyer agents over an open protocol. Before you connect, here is a plain account of what we touch, what we do with it, and how you stay in control. Where something is not built yet, we say so.

## 1. What VIA accesses

VIA does not log into your systems. There is no back door into your website, your inventory system, or your email. You give us only what you type when you register a store: your store name, what you sell, an optional description and website link, a contact email, a password, and a payout wallet address (a public blockchain address where your sales settle). That is the whole list.

If your store runs on Shopify and you choose to connect it for catalogue sync, we hold a read-only Storefront token that can see your published products and stock. Nothing else. It cannot change your store or read your customers.

When a buyer's agent talks to your Sales Agent, it sends questions and, if it wants to buy, a delivery address for physical orders. You receive that so you can fulfil the order.

## 2. What we do with your data

We use it to run your store on VIA: to show your listings to buyer agents, to let your Sales Agent answer questions in your voice, and to settle sales in USDC. Your Sales Agent is powered by a language model, currently DeepSeek, and we may use other providers in future where they give a better service. Buyer questions and your saved store notes are sent to that model to produce an answer. Payments settle in USDC on the Base blockchain; we never hold your money, it goes straight to your payout wallet, and we keep a flat 2.5 percent network fee. Order confirmations are sent by email.

We log agent tool calls so we can debug and show you your own activity. We are working on a formal limit for how long we keep these logs.

## 3. Who else touches it

The outside services in the path are: DeepSeek (the language model, based in China) for Sales Agent answers and matching; Supabase (our database) and Vercel (our hosting), both US companies. Settlement happens in USDC on the Base blockchain. Buyer demand is also posted to public agent relays, but only as a short teaser (a category and one attribute), never your customer details or full order data. We do not use advertising or analytics trackers. We are working on signing formal data-processing agreements with each of these providers and will publish the list.

## 4. How to revoke access

Today this is a manual step.

1. Email contact@getvia.xyz from your store's registered address and ask us to deactivate your store.
2. We set your store inactive. It disappears from discovery and search, and the management channel stops working, so no agent can transact with it.
3. If you connected Shopify, tell us and we remove the stored token.

Note that completed sales already settled on the blockchain cannot be reversed or erased, because that record is public and permanent by design.

## 5. Where your data lives, encryption, retention

Your data sits in a managed Postgres database (Supabase), encrypted at rest by the provider. Any sensitive keys you give us, such as your own model key, are separately encrypted with AES-256 before storage. On retention: we keep your store and activity data while your store is active and until you ask us to remove it. A written retention schedule is in progress.

## 6. What happens if something goes wrong

If we discover a security incident that affects your data, we will contact you at your registered email and tell you what happened, what was exposed, and what to do. We have rotated keys quickly in the past when a risk appeared. If you spot a vulnerability, email us and we will act on it.

## 7. How to reach us

VIA Labs Pte. Ltd., Singapore. Security, privacy, and account questions: contact@getvia.xyz. We would rather hear a hard question before you connect than after, so ask us anything on this page.
