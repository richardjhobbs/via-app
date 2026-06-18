/**
 * lib/app/erc8004-signal-queue.ts
 *
 * Durable, nonce-safe queue for the both-agent ERC-8004 reputation signals that
 * fire when a seller pays the per-item micro-fee at the brief door. The door
 * ENQUEUES (fast, no on-chain work in the request path); a serialized cron
 * drainer posts each signal one at a time with sequential deployer nonces, so
 * concurrent door requests on serverless never collide on the gas-wallet nonce.
 *
 * Buyer-side is enqueued only when the buyer has a registered ERC-8004 agent id;
 * an unregistered buyer simply gets no buyer signal (the seller signal still fires).
 */
import { ethers } from 'ethers';
import { db } from './db';
import { getRpcProvider } from './contract';
import { postViaReputationSignal, parseAgentId } from './via-reputation';

const MAX_ATTEMPTS = 5;

interface QueueRow {
  id:        string;
  agent_id:  string;
  role:      'buyer' | 'seller';
  order_ref: string;
  tx_hash:   string;
  attempts:  number;
}

/** Enqueue the seller (and buyer, when registered) reputation signal for one
 *  paid offer. Idempotent on (order_ref, agent_id, role). */
export async function enqueueOfferSignals(input: {
  orderRef:         string;
  txHash:           string;
  sellerErc8004Id?: string | null;
  buyerErc8004Id?:  string | null;
}): Promise<void> {
  const rows: Array<{ agent_id: string; role: 'buyer' | 'seller'; order_ref: string; tx_hash: string }> = [];
  if (parseAgentId(input.sellerErc8004Id)) rows.push({ agent_id: String(input.sellerErc8004Id).trim(), role: 'seller', order_ref: input.orderRef, tx_hash: input.txHash });
  if (parseAgentId(input.buyerErc8004Id))  rows.push({ agent_id: String(input.buyerErc8004Id).trim(),  role: 'buyer',  order_ref: input.orderRef, tx_hash: input.txHash });
  if (rows.length === 0) return;
  const { error } = await db
    .from('app_erc8004_signal_queue')
    .upsert(rows, { onConflict: 'order_ref,agent_id,role', ignoreDuplicates: true });
  if (error) console.error('[erc8004-queue] enqueue failed:', error.message);
}

/** Drain pending signals one at a time on chained deployer nonces. Best-effort:
 *  a failure marks the row for retry (up to MAX_ATTEMPTS) and resyncs the nonce. */
export async function drainSignalQueue(limit = 10): Promise<{ processed: number; done: number; failed: number }> {
  const { data, error } = await db
    .from('app_erc8004_signal_queue')
    .select('id, agent_id, role, order_ref, tx_hash, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) { console.error('[erc8004-queue] drain read failed:', error.message); return { processed: 0, done: 0, failed: 0 }; }
  const rows = (data ?? []) as QueueRow[];
  if (rows.length === 0) return { processed: 0, done: 0, failed: 0 };

  const provider = getRpcProvider();
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY as string, provider);
  let nonce = await provider.getTransactionCount(deployer.address, 'pending');

  let done = 0, failed = 0;
  for (const r of rows) {
    const agentId = parseAgentId(r.agent_id);
    if (!agentId) {
      await db.from('app_erc8004_signal_queue').update({ status: 'failed', last_error: 'invalid agent_id', attempts: r.attempts + 1, updated_at: new Date().toISOString() }).eq('id', r.id);
      failed++; continue;
    }
    try {
      const signalTx = await postViaReputationSignal({ agentId, orderRef: r.order_ref, txHash: r.tx_hash, role: r.role, nonce });
      nonce++;
      await db.from('app_erc8004_signal_queue').update({ status: 'done', signal_tx_hash: signalTx, attempts: r.attempts + 1, updated_at: new Date().toISOString() }).eq('id', r.id);
      done++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const attempts = r.attempts + 1;
      await db.from('app_erc8004_signal_queue').update({ status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, last_error: msg.slice(0, 300), updated_at: new Date().toISOString() }).eq('id', r.id);
      failed++;
      nonce = await provider.getTransactionCount(deployer.address, 'pending'); // resync after a possible partial send
    }
  }
  return { processed: rows.length, done, failed };
}
