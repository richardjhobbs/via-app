/**
 * Mem0 Memory Layer for RRG MCP Server
 *
 * Provides persistent memory across agent sessions.
 * All writes are fire-and-forget (non-blocking).
 * All reads gracefully degrade to empty results on failure.
 * If MEM0_API_KEY is not set, all functions silently no-op.
 */

// Use REST API directly — the mem0ai npm package's MemoryClient
// expects named export patterns that vary between versions.
// Direct REST is more reliable and avoids SDK version churn.

const MEM0_API_BASE = 'https://api.mem0.ai';
const AGENT_ID = 'rrg-33313';
const APP_ID = 'rrg';

interface Mem0Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface MemoryResult {
  id: string;
  memory: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, string>;
  categories?: string[];
}

function getApiKey(): string | null {
  return process.env.MEM0_API_KEY || null;
}

function headers(): Record<string, string> {
  return {
    'Authorization': `Token ${getApiKey()}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Fire-and-forget memory write.
 * Same pattern as fireSubmitAttribution() — does not block the response.
 */
export function fireMemoryAdd(
  wallet: string,
  messages: Mem0Message[],
  metadata?: Record<string, string>
): void {
  const apiKey = getApiKey();
  if (!apiKey) return;

  const body = {
    messages,
    user_id: wallet.toLowerCase(),
    agent_id: AGENT_ID,
    app_id: APP_ID,
    metadata: metadata || {},
    infer: true,
  };

  // Fire and forget — no await
  fetch(`${MEM0_API_BASE}/v1/memories/`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  }).catch((err) => {
    console.warn('[mem0] Memory add failed (non-blocking):', err?.message || err);
  });
}

/**
 * Search memories for a specific wallet/query.
 * Blocking with 2-second timeout. Returns [] on failure.
 */
export async function searchMemory(
  wallet: string,
  query: string,
  limit: number = 5
): Promise<MemoryResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const body = {
      query,
      user_id: wallet.toLowerCase(),
      agent_id: AGENT_ID,
      app_id: APP_ID,
      top_k: limit,
    };

    const res = await fetch(`${MEM0_API_BASE}/v2/memories/search/`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[mem0] Search returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    // API returns { results: [...] } or directly an array
    return Array.isArray(data) ? data : (data.results || []);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      console.warn('[mem0] Search timed out (2s)');
    } else {
      console.warn('[mem0] Search failed:', msg);
    }
    return [];
  }
}

/**
 * Get all memories for an agent wallet.
 * Blocking with 3-second timeout. Returns [] on failure.
 */
export async function getAgentMemories(
  wallet: string
): Promise<MemoryResult[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const params = new URLSearchParams({
      user_id: wallet.toLowerCase(),
      agent_id: AGENT_ID,
      app_id: APP_ID,
    });

    const res = await fetch(`${MEM0_API_BASE}/v2/memories/?${params}`, {
      method: 'GET',
      headers: headers(),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[mem0] GetAll returned ${res.status}`);
      return [];
    }

    const data = await res.json();
    return Array.isArray(data) ? data : (data.results || []);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      console.warn('[mem0] GetAll timed out (3s)');
    } else {
      console.warn('[mem0] GetAll failed:', msg);
    }
    return [];
  }
}
