/**
 * POST /api/brand/telegram-webhook?brand=unknown-union
 *
 * Webhook endpoint for per-brand Telegram bots.
 * Routes to brand-specific handler based on ?brand= query param.
 *
 * Security: Verifies x-telegram-bot-api-secret-token header.
 * Always returns 200 to prevent Telegram retry storms.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  handleBrandBotUpdate,
  isBrandBotRelevant,
  getBrandBotConfig,
  type TgUpdate,
} from '@/lib/rrg/brand-telegram-bot';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const brandSlug = req.nextUrl.searchParams.get('brand');
  if (!brandSlug) {
    return NextResponse.json({ ok: false, error: 'missing ?brand= param' }, { status: 400 });
  }

  const config = getBrandBotConfig(brandSlug);
  if (!config) {
    return NextResponse.json({ ok: false, error: `unknown brand: ${brandSlug}` }, { status: 404 });
  }

  // Verify webhook secret (uses brand-specific or shared secret)
  const webhookSecret = process.env[`${brandSlug.toUpperCase().replace(/-/g, '_')}_TG_WEBHOOK_SECRET`]
    ?? process.env.BRAND_TG_WEBHOOK_SECRET
    ?? '';
  if (webhookSecret) {
    const token = req.headers.get('x-telegram-bot-api-secret-token');
    if (token !== webhookSecret) {
      console.warn(`[brand-tg-webhook] invalid secret for ${brandSlug}`);
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  let update: TgUpdate;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  if (!update.message) {
    return NextResponse.json({ ok: true, skipped: 'no message' });
  }

  if (!isBrandBotRelevant(update, config.botUsername)) {
    return NextResponse.json({ ok: true, skipped: 'not relevant' });
  }

  try {
    await handleBrandBotUpdate(update, brandSlug);
  } catch (err) {
    console.error(`[brand-tg-webhook] ${brandSlug} error:`, err);
    // Try to send error message
    try {
      const botToken = process.env[config.envTokenKey] ?? '';
      if (botToken && update.message?.chat) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: update.message.chat.id,
            text: "Something went wrong. Try /products or /sizes for quick info!",
            reply_to_message_id: update.message.message_id,
            allow_sending_without_reply: true,
          }),
          signal: AbortSignal.timeout(5_000),
        });
      }
    } catch { /* swallow */ }
  }

  return NextResponse.json({ ok: true });
}
