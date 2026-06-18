/**
 * One-off: repoint three ERC-8004 identities' on-chain MCP endpoint to their
 * real, live per-seller MCP. They were minted with the dead /api/agent/<id>/mcp
 * shape (404 on 8004scan). This rewrites only services[0].endpoint via
 * setAgentURI, preserving every other field. Idempotent and safe to re-run.
 *
 * Requires the VIA registrar key (the wallet that custodies these NFTs):
 *   VIA_REGISTRAR_PRIVATE_KEY=<key> node scripts/fix-agent-uris.mjs
 * Optional: BASE_RPC_URL (defaults to https://mainnet.base.org)
 *
 * Verified 2026-06-04: all three owned by 0xa439d88ecd114226e28289E32CD0c8c4A1b300ab;
 * all target endpoints return HTTP 200.
 */
import { ethers } from 'ethers';

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const ABI = [
  'function tokenURI(uint256) view returns (string)',
  'function ownerOf(uint256) view returns (address)',
  'function setAgentURI(uint256 agentId, string calldata newURI) external',
];

const FIXES = [
  { tokenId: 53846n, endpoint: 'https://app.getvia.xyz/sellers/eli-s-artisan-bakery/mcp' },
  { tokenId: 54475n, endpoint: 'https://app.getvia.xyz/sellers/the-dude-s-store/mcp' },
  { tokenId: 54476n, endpoint: 'https://app.getvia.xyz/sellers/the-sentient-startup/mcp' },
];

const pk = process.env.VIA_REGISTRAR_PRIVATE_KEY;
if (!pk) {
  console.error('Set VIA_REGISTRAR_PRIVATE_KEY (the registrar wallet key) and re-run.');
  process.exit(1);
}

function decodeUri(uri) {
  if (uri.startsWith('data:application/json;base64,')) {
    return JSON.parse(Buffer.from(uri.slice('data:application/json;base64,'.length), 'base64').toString('utf8'));
  }
  if (uri.startsWith('data:application/json,')) {
    return JSON.parse(decodeURIComponent(uri.slice('data:application/json,'.length)));
  }
  throw new Error(`unexpected tokenURI form: ${uri.slice(0, 48)}...`);
}
function encodeUri(obj) {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(obj)).toString('base64')}`;
}

const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL || 'https://mainnet.base.org');
const signer = new ethers.Wallet(pk, provider);
const contract = new ethers.Contract(IDENTITY_REGISTRY, ABI, signer);

console.log('registrar signer:', signer.address);

for (const { tokenId, endpoint } of FIXES) {
  try {
    const owner = await contract.ownerOf(tokenId);
    if (owner.toLowerCase() !== signer.address.toLowerCase()) {
      console.error(`#${tokenId}: owned by ${owner}, not the signer. Skipping (only the owner can setAgentURI).`);
      continue;
    }
    const json = decodeUri(await contract.tokenURI(tokenId));
    if (!Array.isArray(json.services) || !json.services[0]) {
      console.error(`#${tokenId}: registration has no services[0]; skipping.`);
      continue;
    }
    const before = json.services[0].endpoint;
    if (before === endpoint) {
      console.log(`#${tokenId}: already correct (${endpoint}); skipping.`);
      continue;
    }
    json.services[0].endpoint = endpoint;
    const tx = await contract.setAgentURI(tokenId, encodeUri(json));
    const rc = await tx.wait(1);
    console.log(`#${tokenId}: ${before} -> ${endpoint} | tx ${rc.hash}`);
  } catch (e) {
    console.error(`#${tokenId}: FAILED -`, e.shortMessage || e.message);
  }
}
console.log('done. Re-check on 8004scan; the recorded MCP endpoint should now return 200.');
