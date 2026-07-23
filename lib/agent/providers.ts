/**
 * LLM provider metadata — single source of truth for display, status, and costs.
 */

import { LLM_COST_PER_EVAL, CHAT_COST_ESTIMATE } from './credits';
import type { LlmProvider } from './types';

export interface ProviderInfo {
  key: LlmProvider;
  label: string;
  model: string;
  envKey: string;
  costPerEval: number;
  chatCostEstimate: string;
  color: string;
}

export const LLM_PROVIDERS: Record<LlmProvider, ProviderInfo> = {
  claude: {
    key: 'claude',
    label: 'Claude (Anthropic)',
    model: 'claude-sonnet-4',
    envKey: 'ANTHROPIC_API_KEY',
    costPerEval: LLM_COST_PER_EVAL.claude,
    chatCostEstimate: CHAT_COST_ESTIMATE.claude,
    color: '#d97706', // amber
  },
  deepseek: {
    key: 'deepseek',
    label: 'DeepSeek',
    model: 'deepseek-v4-flash',
    envKey: 'DEEPSEEK_API_KEY',
    costPerEval: LLM_COST_PER_EVAL.deepseek,
    chatCostEstimate: CHAT_COST_ESTIMATE.deepseek,
    color: '#3b82f6', // blue
  },
};
