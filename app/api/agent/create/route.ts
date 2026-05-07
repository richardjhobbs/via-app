import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/rrg/db';
import { parseInstructions } from '@/lib/agent/rules';
import { setAgentSession } from '@/lib/agent/auth';
import { saveMemory } from '@/lib/agent/memory';
import type { AgentTier, BidAggression, LlmProvider, WalletType, SizeProfile } from '@/lib/agent/types';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/create
 *
 * Register a new agent with an embedded Thirdweb wallet.
 * The wallet is created client-side via Thirdweb SDK; we receive the address.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      email,
      name,
      tier = 'basic',
      wallet_address,
      wallet_type = 'embedded',
      style_tags = [],
      free_instructions = null,
      budget_ceiling_usdc = null,
      bid_aggression = 'balanced',
      llm_provider = 'claude',
      persona_bio = null,
      persona_voice = null,
      persona_comm_style = null,
      interest_categories = [],
      loved_brands = [],
      avoided_brands = [],
      sizes = {} as SizeProfile,
    } = body as {
      email: string;
      name: string;
      tier?: AgentTier;
      wallet_address: string;
      wallet_type?: WalletType;
      style_tags?: string[];
      free_instructions?: string | null;
      budget_ceiling_usdc?: number | null;
      bid_aggression?: BidAggression;
      llm_provider?: LlmProvider;
      persona_bio?: string | null;
      persona_voice?: string | null;
      persona_comm_style?: string | null;
      interest_categories?: { category: string; tags: string[] }[];
      loved_brands?: string[];
      avoided_brands?: string[];
      sizes?: SizeProfile;
    };

    // Validate required fields
    if (!email || !name || !wallet_address) {
      return NextResponse.json(
        { error: 'email, name, and wallet_address are required' },
        { status: 400 }
      );
    }

    // Check wallet not already registered
    const { data: existing } = await db
      .from('agent_agents')
      .select('id')
      .eq('wallet_address', wallet_address.toLowerCase())
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'This wallet is already registered. Go to your dashboard to manage it.' },
        { status: 409 }
      );
    }

    // Parse instructions into rules for Basic tier (or as fallback for Pro)
    const parsed_rules = parseInstructions(free_instructions);

    const { data: agent, error } = await db
      .from('agent_agents')
      .insert({
        email: email.toLowerCase().trim(),
        name: name.trim(),
        tier,
        style_tags,
        free_instructions,
        parsed_rules,
        budget_ceiling_usdc,
        bid_aggression,
        wallet_address: wallet_address.toLowerCase(),
        wallet_type,
        llm_provider,
        credit_balance_usdc: 0,
        status: 'active',
        persona_bio,
        persona_voice,
        persona_comm_style,
        interest_categories,
      })
      .select('*')
      .single();

    if (error) {
      console.error('Agent creation error:', error);
      return NextResponse.json(
        { error: 'Failed to create agent' },
        { status: 500 }
      );
    }

    // Log activity
    await db.from('agent_activity_log').insert({
      agent_id: agent.id,
      action: 'agent_created',
      details: { tier, wallet_type: 'embedded' },
    });

    // Seed agent_memory from the structured wizard inputs. These rows have
    // source_session_id = NULL, which lets the prompt formatter group them
    // as "Set at signup" vs the chat-extracted ones. The concierge sees
    // them in the system prompt from the very first chat — no training
    // phase required.
    try {
      const seedTasks: Promise<void>[] = [];

      for (const slug of loved_brands) {
        if (!slug) continue;
        seedTasks.push(saveMemory(agent.id, 'brand', `Likes ${slug} (set at signup)`));
      }
      for (const slug of avoided_brands) {
        if (!slug) continue;
        seedTasks.push(saveMemory(agent.id, 'brand', `Avoids ${slug} (set at signup)`));
      }

      const sizeParts: string[] = [];
      if (sizes.sex) sizeParts.push(sizes.sex);
      if (sizes.tops) sizeParts.push(`tops ${sizes.tops}`);
      if (sizes.bottoms) sizeParts.push(`bottoms ${sizes.bottoms}`);
      if (sizes.shoes) sizeParts.push(`shoes ${sizes.shoes}`);
      if (sizeParts.length > 0) {
        const note = sizes.notes ? ` — ${sizes.notes}` : '';
        seedTasks.push(saveMemory(agent.id, 'size', `${sizeParts.join(', ')}${note} (set at signup)`));
      } else if (sizes.notes) {
        seedTasks.push(saveMemory(agent.id, 'size', `${sizes.notes} (set at signup)`));
      }

      if (style_tags.length > 0) {
        seedTasks.push(saveMemory(agent.id, 'style', `Style preferences: ${style_tags.join(', ')} (set at signup)`));
      }

      if (free_instructions && free_instructions.trim()) {
        seedTasks.push(saveMemory(agent.id, 'preference', `${free_instructions.trim()} (set at signup)`));
      }

      // Run all seeds in parallel; failures are non-blocking.
      await Promise.allSettled(seedTasks);
    } catch (err) {
      console.error('[agent_memory seed] failed (non-blocking):', err);
    }

    // Auto-mint ERC-8004 identity (fire-and-forget, don't block the response)
    (async () => {
      let assignedAgentId: number | null = null;
      try {
        const { registerAgentIdentity, getAgentIdForWallet } = await import('@/lib/agent/erc8004');

        // Check if wallet already has an identity token
        const existingId = await getAgentIdForWallet(wallet_address.toLowerCase());
        if (existingId !== null) {
          assignedAgentId = Number(existingId);
          await db.from('agent_agents').update({ erc8004_agent_id: assignedAgentId, erc8004_linked: true }).eq('id', agent.id);
          await db.from('agent_activity_log').insert({ agent_id: agent.id, action: 'erc8004_linked', details: { agent_id_on_chain: assignedAgentId, method: 'existing' } });
        } else {
          const { tokenId, txHash } = await registerAgentIdentity(agent.id, name.trim(), wallet_address.toLowerCase(), tier);
          assignedAgentId = Number(tokenId);
          await db.from('agent_agents').update({ erc8004_agent_id: assignedAgentId, erc8004_linked: true }).eq('id', agent.id);
          await db.from('agent_activity_log').insert({ agent_id: agent.id, action: 'erc8004_minted', details: { agent_id_on_chain: assignedAgentId, method: 'auto' }, tx_hash: txHash });
          console.log(`ERC-8004 auto-minted: VIA #${tokenId} for agent ${agent.id}`);
        }
      } catch (err) {
        console.error('ERC-8004 auto-mint failed (non-blocking):', err);
      }

      // Once we have an erc8004_agent_id, match this agent against active
      // brands and write agent_brand_preferences rows. Feeds the onboarding
      // credit engine. Fire-and-forget.
      if (assignedAgentId !== null) {
        try {
          const { queueAgentBrandMatch } = await import('@/lib/rrg/agent-brand-match');
          queueAgentBrandMatch({
            id: agent.id,
            erc8004_agent_id: assignedAgentId,
            style_tags: agent.style_tags,
            interest_categories: agent.interest_categories,
            free_instructions: agent.free_instructions,
            persona_bio: agent.persona_bio,
            persona_voice: agent.persona_voice,
          });
        } catch (err) {
          console.error('[agent-brand-match] queue failed:', err);
        }
      }
    })();

    // Set session cookie on the response
    const response = NextResponse.json({ agent: { ...agent, via_agent_id: agent.erc8004_agent_id } }, { status: 201 });
    response.cookies.set('via_agent_session', agent.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    return response;
  } catch (err) {
    console.error('Agent create error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
