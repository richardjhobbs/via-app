import { notFound } from 'next/navigation';
import { db } from '@/lib/rrg/db';
import { getSignedUrl } from '@/lib/rrg/storage';
import { PRESET_AVATARS } from '@/lib/agent/avatars';
import { TIER_DISPLAY } from '@/lib/agent/types';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ viaAgentId: string }>;
}

/** Resolve avatar_path to a displayable URL. */
async function resolveAvatar(source: string | null, path: string | null): Promise<string | null> {
  if (!path) return null;
  if (source === 'preset') {
    const preset = PRESET_AVATARS.find(p => p.id === path);
    return preset?.src ?? null;
  }
  if (source === 'uploaded' || source === 'generated') {
    try {
      return await getSignedUrl(path, 604800);
    } catch {
      return null;
    }
  }
  return null;
}

/** Format a date as "Apr 2026" */
function formatMemberSince(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/** Truncate wallet: 0x1234...abcd */
function truncateWallet(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { viaAgentId } = await params;
  const id = parseInt(viaAgentId, 10);
  if (isNaN(id)) return { title: 'Agent Not Found | RRG' };

  const { data: agent } = await db
    .from('agent_agents')
    .select('name, tier')
    .eq('erc8004_agent_id', id)
    .single();

  if (!agent) return { title: `VIA Agent #${id} | RRG` };

  const tierLabel = TIER_DISPLAY[agent.tier as keyof typeof TIER_DISPLAY]?.label ?? agent.tier;
  return {
    title: `${agent.name} — VIA Agent #${id} | RRG`,
    description: `${tierLabel} on RRG. VIA Agent #${id}.`,
  };
}

export default async function ViaAgentProfilePage({ params }: Props) {
  const { viaAgentId: raw } = await params;
  const viaId = parseInt(raw, 10);
  if (isNaN(viaId) || viaId <= 0) notFound();

  // Look up agent by ERC-8004 ID
  const { data: agent } = await db
    .from('agent_agents')
    .select('id, name, tier, wallet_address, erc8004_agent_id, erc8004_linked, status, created_at, persona_bio, persona_voice, persona_comm_style, interest_categories, style_tags, avatar_source, avatar_path')
    .eq('erc8004_agent_id', viaId)
    .single();

  const scanUrl = `https://8004scan.io/agents/base/${viaId}`;

  // Agent exists on-chain but not on RRG
  if (!agent) {
    return (
      <div className="min-h-screen bg-black text-white">
        <RRGHeader />
        <main className="px-6 py-16 max-w-2xl mx-auto text-center">
          <div className="text-5xl font-mono text-green-400 mb-4">#{viaId}</div>
          <h1 className="text-xl font-semibold mb-3">VIA Agent #{viaId}</h1>
          <p className="text-white/50 mb-6">
            This agent exists on the VIA network but doesn&apos;t have a profile on RRG yet.
          </p>
          <a
            href={scanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-green-500/30 text-green-400 rounded hover:bg-green-500/10 transition-colors"
          >
            View on 8004scan &rarr;
          </a>
        </main>
        <RRGFooter />
      </div>
    );
  }

  const tierDisplay = TIER_DISPLAY[agent.tier as keyof typeof TIER_DISPLAY];
  const avatarUrl = await resolveAvatar(agent.avatar_source, agent.avatar_path);
  const interests = (agent.interest_categories ?? []) as { category: string; tags: string[] }[];

  return (
    <div className="min-h-screen bg-black text-white">
      <RRGHeader />
      <main className="px-6 py-12 max-w-2xl mx-auto">

        {/* Header: avatar + name + badges */}
        <div className="flex items-start gap-5 mb-8">
          <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-light flex-shrink-0 bg-white/10 text-white/60 overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
            ) : (
              agent.name.charAt(0).toUpperCase()
            )}
          </div>
          <div className="pt-1">
            <h1 className="text-3xl font-light mb-2">{agent.name}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={scanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono bg-green-500/10 text-green-400 border border-green-500/30 rounded hover:bg-green-500/20 transition-colors"
                title="View on 8004scan"
              >
                VIA #{viaId}
              </a>
              <Badge variant={agent.tier === 'pro' ? 'pro' : 'default'}>
                {tierDisplay?.label ?? agent.tier}
              </Badge>
              <Badge variant={agent.status === 'active' ? 'success' : 'warning'}>
                {agent.status}
              </Badge>
            </div>
          </div>
        </div>

        <div className="space-y-6">

          {/* Bio */}
          {agent.persona_bio && (
            <Card>
              <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">About</h2>
              <p className="text-white/80 leading-relaxed">{agent.persona_bio}</p>
            </Card>
          )}

          {/* Persona details */}
          {(agent.persona_voice || agent.persona_comm_style) && (
            <Card>
              <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">Personality</h2>
              <div className="space-y-2 text-sm">
                {agent.persona_voice && (
                  <div className="flex justify-between">
                    <span className="text-white/40">Voice</span>
                    <span className="text-white/80 capitalize">{agent.persona_voice}</span>
                  </div>
                )}
                {agent.persona_comm_style && (
                  <div className="flex justify-between">
                    <span className="text-white/40">Communication</span>
                    <span className="text-white/80 capitalize">{agent.persona_comm_style}</span>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Interests */}
          {interests.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">Interests</h2>
              <div className="space-y-3">
                {interests.map((ic) => (
                  <div key={ic.category}>
                    <div className="text-xs text-white/40 mb-1">{ic.category}</div>
                    <div className="flex flex-wrap gap-1">
                      {ic.tags.map((tag) => (
                        <span key={tag} className="px-2 py-0.5 text-xs bg-green-500/10 text-green-400/80 border border-green-500/20 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Style tags */}
          {agent.style_tags?.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">Style</h2>
              <div className="flex flex-wrap gap-1">
                {agent.style_tags.map((tag: string) => (
                  <span key={tag} className="px-2 py-0.5 text-xs border border-green-500/30 text-green-400/80 rounded">
                    {tag}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {/* Identity */}
          <Card>
            <h2 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-3">Identity</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/40">VIA Agent ID</span>
                <span className="text-green-400 font-mono">#{viaId}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-white/40">Wallet</span>
                <span className="text-white/60 font-mono text-xs" title={agent.wallet_address}>
                  {truncateWallet(agent.wallet_address)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Member since</span>
                <span className="text-white/60">{formatMemberSince(agent.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/40">Network</span>
                <span className="text-white/60">Base</span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-white/5">
              <a
                href={scanUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-xs text-green-400 hover:text-green-300 transition-colors"
              >
                View on-chain identity on 8004scan &rarr;
              </a>
            </div>
          </Card>
        </div>
      </main>
      <RRGFooter />
    </div>
  );
}
