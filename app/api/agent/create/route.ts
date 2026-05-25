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
      // llm_provider from the request body is ignored on create.
      // The CAC programme funds DeepSeek only (1.00 USDC at DeepSeek pricing
      // gets ~5x the chat budget that Claude pricing would). Owners can
      // switch to Claude from the dashboard after topping up their balance.
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

    // Check wallet not already registered. The 409 response carries the
    // existing agent's identity so the wizard can render a direct
    // "sign in to your dashboard" CTA instead of a string dead-end.
    const { data: existing } = await db
      .from('agent_agents')
      .select('id, name, tier')
      .eq('wallet_address', wallet_address.toLowerCase())
      .maybeSingle();

    if (existing) {
      // Deliberately does NOT include agent name or id in the response,
      // so a stranger POSTing garbage cannot enumerate which wallets are
      // registered or learn the owner's chosen agent name.
      return NextResponse.json(
        {
          error: 'This wallet is already registered. We will email a sign-in link to the address on file.',
          conflict: 'wallet',
        },
        { status: 409 },
      );
    }

    // Check email not already registered. Mirrors the wallet check so the
    // signup CAC grant (1.00 USDC) is one-per-email AND one-per-wallet.
    // Without this, one email + N wallets could farm $N of LLM credits.
    const { data: existingEmail } = await db
      .from('agent_agents')
      .select('id, name, tier')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existingEmail) {
      // Same redaction as the wallet branch: do not leak agent name or id.
      return NextResponse.json(
        {
          error: 'This email is already registered. We will email you a sign-in link.',
          conflict: 'email',
        },
        { status: 409 },
      );
    }

    // Parse instructions into rules for Basic tier (or as fallback for Pro)
    const parsed_rules = parseInstructions(free_instructions);

    // Map the wizard's SizeProfile.sex label to the agent_agents.sex
    // domain ('male'|'female'|'other'|null). 'unisex' and unset both
    // become null so agent_search_drops applies no audience filter and
    // the owner sees the full catalogue by default.
    const wizardSex = sizes?.sex ?? '';
    const persistedSex: 'male' | 'female' | 'other' | null =
      wizardSex === 'menswear' ? 'male' :
      wizardSex === 'womenswear' ? 'female' :
      null;

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
        // CAC programme is DeepSeek-only. Hardcoded here so the wizard
        // body's llm_provider is ignored at signup. Owners can switch via
        // the dashboard LlmStatusCard once they have topped up.
        llm_provider: 'deepseek' as LlmProvider,
        credit_balance_usdc: 1.0,
        status: 'active',
        persona_bio,
        persona_voice,
        persona_comm_style,
        interest_categories,
        sex: persistedSex,
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

    // Record the signup grant in the credit ledger so it's auditable alongside
    // topups and deductions. Type uses the existing 'topup' bucket (CHECK
    // constraint is topup/deduction/refund); description distinguishes the
    // CAC grant from real top-ups. Stored as USD for accounting honesty;
    // UI shows it as 1000 credits at 1 USD = 1000.
    await db.from('agent_credit_transactions').insert({
      agent_id: agent.id,
      type: 'topup',
      amount_usdc: 1.0,
      balance_after: 1.0,
      description: 'Signup grant (1000 credits, CAC)',
    });

    // Seed agent_memory from the structured wizard inputs. These rows have
    // source_session_id = NULL, which lets the prompt formatter group them
    // as "Set at signup" vs the chat-extracted ones. The concierge sees
    // them in the system prompt from the very first chat, no training
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
        const note = sizes.notes ? `, ${sizes.notes}` : '';
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

    // Mint a fresh ERC-8004 identity (fire-and-forget, don't block the response).
    //
    // Design note: we do NOT auto-link to existing tokens on this wallet.
    // Several real wallets in this system are shared multi-agent wallets
    // (e.g. an agent-team wallet that holds tokens for colin, priscilla,
    // rosie, jordan, sasha, etc). Linking would hijack a sibling agent's
    // identity. Each new agent_agents row gets its own fresh ERC-8004
    // token, owned by the agent's wallet. If a true "import existing
    // identity" flow is needed later, it belongs in a separate wizard
    // branch, not here.
    (async () => {
      let assignedAgentId: number | null = null;
      try {
        const { registerAgentIdentity } = await import('@/lib/agent/erc8004');
        const { tokenId, txHash } = await registerAgentIdentity(agent.id, name.trim(), wallet_address.toLowerCase(), tier);
        assignedAgentId = Number(tokenId);
        await db.from('agent_agents').update({ erc8004_agent_id: assignedAgentId, erc8004_linked: true }).eq('id', agent.id);
        await db.from('agent_activity_log').insert({
          agent_id: agent.id,
          action: 'erc8004_minted',
          details: { agent_id_on_chain: assignedAgentId, method: 'auto' },
          tx_hash: txHash,
        });
        console.log(`ERC-8004 auto-minted: VIA #${tokenId} for agent ${agent.id}`);
      } catch (err) {
        // Persist failure to the activity log so it's visible on the
        // dashboard rather than dying silently in stdout. The dashboard's
        // amber "VIA pending" pill stays until a manual retry succeeds.
        const message = err instanceof Error ? err.message : String(err);
        console.error('ERC-8004 auto-mint failed (non-blocking):', message);
        try {
          await db.from('agent_activity_log').insert({
            agent_id: agent.id,
            action: 'erc8004_mint_failed',
            details: {
              error: message.slice(0, 500),
              wallet_address: wallet_address.toLowerCase(),
              tier,
            },
          });
        } catch (logErr) {
          console.error('[erc8004_mint_failed log]', logErr);
        }
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
