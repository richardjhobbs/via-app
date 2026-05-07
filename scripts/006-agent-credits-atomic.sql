-- Atomic credit balance updates for agent_agents
-- Prevents read-modify-write races on concurrent chat turns and top-ups.
-- Run once via Supabase SQL Editor.

CREATE OR REPLACE FUNCTION agent_credits_deduct(
  p_agent_id uuid,
  p_cost numeric
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  UPDATE agent_agents
  SET
    credit_balance_usdc = GREATEST(0, credit_balance_usdc - p_cost),
    updated_at = NOW()
  WHERE id = p_agent_id
  RETURNING credit_balance_usdc INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found: %', p_agent_id;
  END IF;

  RETURN v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION agent_credits_topup(
  p_agent_id uuid,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  UPDATE agent_agents
  SET
    credit_balance_usdc = credit_balance_usdc + p_amount,
    updated_at = NOW()
  WHERE id = p_agent_id
  RETURNING credit_balance_usdc INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agent not found: %', p_agent_id;
  END IF;

  RETURN v_new_balance;
END;
$$;
