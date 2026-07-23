/**
 * Resolve which LLM a Buying Agent runs on: the platform model (DeepSeek,
 * metered against credits) or the owner's bring-your-own key (billed directly
 * by their provider, so platform credits are NOT consumed).
 *
 * Mirrors RRG's resolveAgentLlm. BYO providers are OpenAI-compatible (openai,
 * openrouter), so every call site reuses the same OpenAI-SDK / chat-completions
 * shape , only apiKey, baseURL and model change. OpenRouter reaches Claude,
 * Gemini, Llama, etc. through one key.
 */
import { decryptByoKey } from './byo-key-crypt';

export interface ResolvedLlm {
  apiKey:  string;
  baseURL: string;  // OpenAI-SDK style base (no /chat/completions)
  model:   string;
  isByo:   boolean;
  label:   string;  // for UI / logs, e.g. "DeepSeek (platform)" or "OpenRouter"
}

export interface BuyerLlmFields {
  llm_byo_provider?:      string | null;
  llm_byo_key_encrypted?: string | null;
  llm_byo_model?:         string | null;
}

const PLATFORM: ResolvedLlm = {
  apiKey:  process.env.DEEPSEEK_API_KEY ?? '',
  baseURL: 'https://api.deepseek.com',
  model:   'deepseek-v4-flash',
  isByo:   false,
  label:   'DeepSeek (platform)',
};

const OPENAI_DEFAULT_MODEL     = 'gpt-4o-mini';
const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';

export function resolveBuyerLlm(buyer: BuyerLlmFields): ResolvedLlm {
  const provider = buyer.llm_byo_provider;
  const enc      = buyer.llm_byo_key_encrypted;

  if (provider && enc) {
    try {
      const key = decryptByoKey(enc);
      if (provider === 'openai') {
        return { apiKey: key, baseURL: 'https://api.openai.com/v1', model: OPENAI_DEFAULT_MODEL, isByo: true, label: 'OpenAI' };
      }
      if (provider === 'openrouter') {
        return {
          apiKey:  key,
          baseURL: 'https://openrouter.ai/api/v1',
          model:   (buyer.llm_byo_model && buyer.llm_byo_model.trim()) || OPENROUTER_DEFAULT_MODEL,
          isByo:   true,
          label:   'OpenRouter',
        };
      }
    } catch (err) {
      // A bad/undecryptable key must not brick the agent , fall back to platform.
      console.error('[buyer-llm] BYO key resolve failed, falling back to platform:', err);
    }
  }
  return { ...PLATFORM };
}
