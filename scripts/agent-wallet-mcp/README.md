# agent-wallet-mcp

Intrinsic wallet + generic MCP-call capability for any VIA agent. Drop-in MCP server — wire it into a nanobot config (or any MCP host), set `WALLET_PRIVATE_KEY`, and the agent can sign/send USDC on Base and call any MCP server over HTTP.

Built to fix "agent X lost its wallet" — every VIA agent (DrHobbs, Colin, Priscilla, Rosie, Jordan, Sasha, and whatever comes next) should have this wired so they retain their wallet across framework migrations (openclaw → nanobot → elizaos → whatever).

## Tools

- `get_wallet` — address, chain, ETH + USDC balance
- `send_usdc { to, amount_usd }` — returns tx hash
- `sign_message { message }` — EIP-191 signature
- `mcp_call { url, tool, arguments, timeout_ms? }` — generic MCP JSON-RPC POST to any URL

## Install on Box (nanobot host)

```powershell
# On Box (nucbox-k11)
cd C:\Users\Richard\mcp-servers
# Copy or clone this folder as 'agent-wallet'
cd agent-wallet
npm install
```

Then add to the agent's `.nanobot\config.json` under `tools.mcp_servers`:

```json
"wallet": {
  "command": "node",
  "args": ["C:\\Users\\Richard\\mcp-servers\\agent-wallet\\server.js"],
  "env": {
    "WALLET_PRIVATE_KEY": "<agent private key, hex, with or without 0x>",
    "AGENT_LABEL":        "DrHobbs #17666"
  }
}
```

Optional env: `RPC_URL`, `USDC_ADDRESS`, `CHAIN_ID` (defaults are Base mainnet + USDC).

## Security

Private key lives in the nanobot config's `env` block, read only by the agent process. Never logged or returned by any tool. Signing happens in-process with `ethers.Wallet`.
