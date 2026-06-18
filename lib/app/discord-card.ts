/**
 * lib/app/discord-card.ts
 *
 * Minimal Discord webhook embed sender, ported from RRG's lib/rrg/discord-brief.ts
 * so VIA can post + edit approval cards (Nostr content approvals) to the same
 * channels Rosie/Priscilla already use. send returns the message id (?wait=true)
 * so the card can be edited in place after approve/reject.
 */
const WEBHOOK_USERNAME = 'VIA';

export interface DiscordEmbedField { name: string; value: string; inline?: boolean }
export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
}
export interface DiscordCardPayload { content?: string; embeds: DiscordEmbed[] }

export async function sendDiscordCardReturningId(webhookUrl: string, payload: DiscordCardPayload): Promise<string | null> {
  if (!webhookUrl) return null;
  const sep = webhookUrl.includes('?') ? '&' : '?';
  const resp = await fetch(`${webhookUrl}${sep}wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, username: WEBHOOK_USERNAME }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Discord webhook failed (${resp.status})`);
  const json = (await resp.json().catch(() => null)) as { id?: string } | null;
  return json?.id ?? null;
}

export async function editDiscordCard(webhookUrl: string, messageId: string, payload: DiscordCardPayload): Promise<void> {
  if (!webhookUrl) return;
  const base = webhookUrl.split('?')[0].replace(/\/$/, '');
  const resp = await fetch(`${base}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`Discord webhook edit failed (${resp.status})`);
}
