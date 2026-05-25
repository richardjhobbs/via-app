// ── Agent ─────────────────────────────────────────────────────────────

export type AgentTier = 'basic' | 'pro';
export type AvatarSource = 'none' | 'preset' | 'uploaded' | 'generated';
export type BidAggression = 'conservative' | 'balanced' | 'aggressive';
export type WalletType = 'embedded' | 'imported';
export type LlmProvider = 'claude' | 'deepseek';

// Claude was disabled 2026-05-25: the chat path lacks Anthropic tool-use
// wiring, so Claude-backed concierges hallucinated tool calls and dumped
// raw `</function_result>` blocks into chat with fabricated URLs. DeepSeek
// has working tool-use via streamDeepSeekWithTools. Add Claude back here
// after wiring real Anthropic tool-use in lib/agent/llm.ts.
export const LLM_PROVIDER_OPTIONS = [
  { value: 'deepseek' as LlmProvider, label: 'DeepSeek' },
] as const;
export type AgentStatus = 'active' | 'suspended' | 'archived';

/** Buyer-facing display names per tier (from agent-naming-narrative) */
export const TIER_DISPLAY: Record<AgentTier, { label: string; tagline: string }> = {
  basic: { label: 'Personal Shopper', tagline: 'Your reliable assistant at your favourite store' },
  pro:   { label: 'Concierge',        tagline: 'A dedicated person who genuinely knows you' },
};

export interface InterestSelection {
  category: string;
  tags: string[];
}

/** Optional structured size profile captured at signup. Any field may be empty. */
export interface SizeProfile {
  sex?: 'menswear' | 'womenswear' | 'both' | '';
  tops?: string;          // e.g. "M", "10", "EU 38"
  bottoms?: string;       // e.g. "32W 32L", "UK 10"
  shoes?: string;         // e.g. "UK 9", "EU 43", "US 10"
  notes?: string;         // free text, e.g. "vanity-sized brands run small on me"
}

export const EMPTY_SIZE_PROFILE: SizeProfile = {
  sex: '', tops: '', bottoms: '', shoes: '', notes: '',
};

export interface Agent {
  id: string;
  created_at: string;
  updated_at: string;
  email: string;
  name: string;
  tier: AgentTier;
  style_tags: string[];
  free_instructions: string | null;
  parsed_rules: AgentRules;
  budget_ceiling_usdc: number | null;
  bid_aggression: BidAggression;
  wallet_address: string;
  wallet_type: WalletType;
  llm_provider: LlmProvider;
  credit_balance_usdc: number;
  erc8004_agent_id: number | null;
  erc8004_linked: boolean;
  status: AgentStatus;
  last_active_at: string | null;
  last_poll_at: string | null;
  // Owner's sex, persisted from wizard's SizeProfile.sex at signup.
  // Drives the default audience_filter on agent_search_drops so the
  // catalogue is pre-scoped to the owner's gender unless they ask
  // for something else.
  sex: 'male' | 'female' | 'other' | null;
  // Persona fields
  persona_bio: string | null;
  persona_voice: string | null;
  persona_comm_style: string | null;
  interest_categories: InterestSelection[];
  avatar_path: string | null;
  avatar_source: AvatarSource;
}

// ── Wizard state (creation flow) ────────────────────────────────────

export interface WizardState {
  tier: AgentTier;
  email: string;
  name: string;
  wallet_address: string;
  wallet_type: 'embedded' | 'imported';
  style_tags: string[];
  free_instructions: string;
  budget_ceiling_usdc: string;
  bid_aggression: BidAggression;
  llm_provider: LlmProvider;
  persona_bio: string;
  persona_voice: string;
  persona_comm_style: string;
  interest_categories: InterestSelection[];
  // Structured taste signals captured at signup. These get written to
  // agent_memory at create time so the concierge has context from chat 1.
  loved_brands: string[];     // brand slugs
  avoided_brands: string[];   // brand slugs
  sizes: SizeProfile;
}

// ── Rules (Basic agent) ──────────────────────────────────────────────

export interface AgentRules {
  tagWhitelist: string[];
  tagBlacklist: string[];
  brandWhitelist: string[];
  brandBlacklist: string[];
  maxPriceUsdc: number | null;
  minPriceUsdc: number | null;
  keywords: string[];
  keywordBlacklist: string[];
}

export const EMPTY_RULES: AgentRules = {
  tagWhitelist: [],
  tagBlacklist: [],
  brandWhitelist: [],
  brandBlacklist: [],
  maxPriceUsdc: null,
  minPriceUsdc: null,
  keywords: [],
  keywordBlacklist: [],
};

// ── Evaluation ───────────────────────────────────────────────────────

export type EvalDecision = 'skip' | 'recommend' | 'bid';

export interface AgentEvaluation {
  id: string;
  created_at: string;
  agent_id: string;
  drop_id: string;
  decision: EvalDecision;
  reasoning: string | null;
  rule_match_detail: Record<string, unknown> | null;
  suggested_bid_usdc: number | null;
  llm_tokens_used: number | null;
  llm_cost_usdc: number | null;
  owner_notified: boolean;
  owner_approved: boolean | null;
}

// ── Activity Log ─────────────────────────────────────────────────────

export interface ActivityLogEntry {
  id: string;
  created_at: string;
  agent_id: string;
  action: string;
  details: Record<string, unknown>;
  tx_hash: string | null;
}

// ── Credits ──────────────────────────────────────────────────────────

export type CreditTxType = 'topup' | 'deduction' | 'refund';

export interface CreditTransaction {
  id: string;
  created_at: string;
  agent_id: string;
  type: CreditTxType;
  amount_usdc: number;
  balance_after: number;
  description: string | null;
  tx_hash: string | null;
}

// ── Drops (Phase 2) ──────────────────────────────────────────────────

export type BrandStatus = 'pending' | 'approved' | 'suspended';
export type FulfilmentModel = 'shipping_included' | 'shipping_separate';
export type DropStatus =
  | 'draft'
  | 'scheduled'
  | 'live'
  | 'closed'
  | 'settling'
  | 'settled'
  | 'cancelled';
export type BidStatus =
  | 'submitted'
  | 'won'
  | 'lost'
  | 'settled'
  | 'failed';
export type SettlementStatus = 'pending' | 'completed' | 'failed';

export interface DropBrand {
  id: string;
  created_at: string;
  name: string;
  slug: string;
  description: string | null;
  website_url: string | null;
  contact_email: string;
  wallet_address: string;
  status: BrandStatus;
  verified_by: string | null;
  verified_at: string | null;
}

export interface DropListing {
  id: string;
  created_at: string;
  brand_id: string;
  title: string;
  description: string | null;
  content: string | null;
  image_urls: string[];
  quantity: number;
  reserve_price_usdc: number;
  ceiling_price_usdc: number | null;
  platform_fee_pct: number;
  fulfilment_model: FulfilmentModel;
  shipping_cost_usdc: number | null;
  shipping_details: Record<string, unknown>;
  bid_window_minutes: number;
  launch_at: string;
  closes_at: string | null;
  status: DropStatus;
}

export interface DropBid {
  id: string;
  created_at: string;
  drop_id: string;
  agent_id: string | null;
  agent_wallet: string;
  agent_erc8004_id: number;
  bid_amount_usdc: number;
  permit_data: Record<string, unknown> | null;
  is_external: boolean;
  status: BidStatus;
  settlement_tx_hash: string | null;
  settled_at: string | null;
}

export interface DropSettlement {
  id: string;
  created_at: string;
  bid_id: string;
  drop_id: string;
  buyer_wallet: string;
  seller_wallet: string;
  total_usdc: number;
  platform_fee_usdc: number;
  seller_receives_usdc: number;
  tx_hash: string | null;
  status: SettlementStatus;
}

// ── Style tag taxonomy ───────────────────────────────────────────────

export const STYLE_TAGS = [
  'streetwear',
  'luxury',
  'sportswear',
  'minimalist',
  'avant-garde',
  'vintage',
  'deadstock',
  'sneakers',
  'accessories',
  'outerwear',
  'denim',
  'tailoring',
  'workwear',
  'techwear',
  'sustainable',
  'unisex',
  'limited-edition',
  'collaboration',
  'artisan',
  'contemporary',
  'heritage',
  'emerging-designer',
  'basics',
  'statement-pieces',
] as const;

export type StyleTag = (typeof STYLE_TAGS)[number];

// ── Interest categories (broader than fashion) ──────────────────────

export const INTEREST_CATEGORIES = {
  fashion: {
    label: 'Fashion',
    tags: [...STYLE_TAGS],
  },
  art_culture: {
    label: 'Art & Culture',
    tags: [
      'contemporary-art', 'photography', 'graphic-design', 'illustration',
      'sculpture', 'street-art', 'gallery', 'museum', 'print', 'ceramics',
    ],
  },
  music_entertainment: {
    label: 'Music & Entertainment',
    tags: [
      'vinyl', 'hip-hop', 'electronic', 'indie', 'jazz', 'punk',
      'concert-merch', 'film', 'gaming', 'anime',
    ],
  },
  technology: {
    label: 'Technology',
    tags: [
      'web3', 'ai', 'hardware', 'open-source', 'wearables',
      'robotics', 'privacy', 'crypto', 'defi', 'nft',
    ],
  },
  lifestyle: {
    label: 'Lifestyle',
    tags: [
      'travel', 'food', 'fitness', 'wellness', 'interiors',
      'architecture', 'outdoors', 'automotive', 'cycling', 'skateboarding',
    ],
  },
  sustainability: {
    label: 'Sustainability',
    tags: [
      'circular-fashion', 'upcycling', 'organic', 'fair-trade', 'zero-waste',
      'repair', 'local-production', 'biodegradable', 'ethical-sourcing', 'slow-fashion',
    ],
  },
} as const;

export type InterestCategoryKey = keyof typeof INTEREST_CATEGORIES;

// ── Voice presets ───────────────────────────────────────────────────

export const VOICE_PRESETS = [
  { value: 'formal', label: 'Formal', description: 'Professional and precise' },
  { value: 'casual', label: 'Casual', description: 'Relaxed and conversational' },
  { value: 'witty', label: 'Witty', description: 'Sharp and playful' },
  { value: 'technical', label: 'Technical', description: 'Detail-oriented and analytical' },
  { value: 'streetwise', label: 'Streetwise', description: 'Culture-first, in the know' },
  { value: 'custom', label: 'Custom', description: 'Write your own tone' },
] as const;

export const COMM_STYLE_PRESETS = [
  { value: 'brief', label: 'Brief', description: 'Short and to the point' },
  { value: 'detailed', label: 'Detailed', description: 'Thorough explanations' },
  { value: 'conversational', label: 'Conversational', description: 'Natural back-and-forth' },
  { value: 'analytical', label: 'Analytical', description: 'Data-driven and structured' },
  { value: 'custom', label: 'Custom', description: 'Write your own style' },
] as const;
