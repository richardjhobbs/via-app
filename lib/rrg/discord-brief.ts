/**
 * lib/rrg/discord-brief.ts
 *
 * Send a Discord embed to a webhook URL. Used by the brand-live event
 * orchestrator to brief Priscilla and Rosie when a brand crosses the live
 * threshold. Mirror of the multipart-less branch of `sendDiscord` in
 * lib/rrg/autopost.ts but specialised for richly-formatted text-only briefs.
 */

const DISCORD_WEBHOOK_USERNAME = 'RRG';

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
}

export interface DiscordBriefPayload {
  content?: string;
  embeds: DiscordEmbed[];
}

export async function sendDiscordBrief(webhookUrl: string, payload: DiscordBriefPayload): Promise<void> {
  if (!webhookUrl) {
    throw new Error('webhookUrl required');
  }
  const resp = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      username: DISCORD_WEBHOOK_USERNAME,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    throw new Error(`Discord webhook failed (${resp.status}): ${await resp.text()}`);
  }
}
