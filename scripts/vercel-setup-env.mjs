/**
 * vercel-setup-env.mjs
 *
 * Sets all required environment variables on the Vercel project.
 * Run with: node scripts/vercel-setup-env.mjs YOUR_VERCEL_TOKEN
 *
 * Get a token at: https://vercel.com/account/tokens
 * (Settings → Tokens → Create Token)
 */

const TOKEN      = process.argv[2];
const TEAM_ID    = 'team_vlx6eD796bG9EoiaTkG6UoxX';
const PROJECT_ID = 'prj_ih9vJjwuqijbGazxjcRh0Bi2q9Fj';

if (!TOKEN) {
  console.error('Usage: node scripts/vercel-setup-env.mjs <VERCEL_TOKEN>');
  console.error('');
  console.error('Get a token at: https://vercel.com/account/tokens');
  process.exit(1);
}

// All environments to use for each var
const ALL_ENVS = ['production', 'preview', 'development'];

// Env vars to set
const envVars = [
  // Public vars — all environments
  { key: 'NEXT_PUBLIC_BASE_RPC_URL',              value: 'https://mainnet.base.org',                                  envs: ALL_ENVS },
  { key: 'NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL',      value: 'https://sepolia.base.org',                                  envs: ALL_ENVS },
  { key: 'NEXT_PUBLIC_USDC_CONTRACT_MAINNET',     value: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',               envs: ALL_ENVS },
  { key: 'NEXT_PUBLIC_USDC_CONTRACT_TESTNET',     value: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',               envs: ALL_ENVS },
  { key: 'NEXT_PUBLIC_RRG_CONTRACT_ADDRESS',      value: '0x573fad302Be48df7D3A39B381e5E5e794619e174',               envs: ALL_ENVS },
  { key: 'NEXT_PUBLIC_CHAIN_ID',                  value: '84532',                                                     envs: ALL_ENVS },
  { key: 'NEXT_PUBLIC_PLATFORM_WALLET',           value: '0xe653804032A2d51Cc031795afC601B9b1fd2c375',               envs: ALL_ENVS },
  { key: 'NEXT_PUBLIC_SUPABASE_URL',              value: 'https://sanvqnvvzdkjvfmxnxur.supabase.co',                 envs: ALL_ENVS },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',         value: 'sb_publishable_llxiA4Ha8Dy0PjezythuPA_WB_ci27b',           envs: ALL_ENVS },
  { key: 'NEXT_PUBLIC_SITE_URL',                  value: 'https://realrealgenuine.com',                               envs: ALL_ENVS },

  // Secret vars — production + preview only (read from local env)
  { key: 'DEPLOYER_PRIVATE_KEY',  value: process.env.DEPLOYER_PRIVATE_KEY  || '', envs: ['production', 'preview'] },
  { key: 'SUPABASE_SERVICE_KEY',  value: process.env.SUPABASE_SERVICE_KEY  || '', envs: ['production', 'preview'] },
  { key: 'PINATA_API_KEY',        value: process.env.PINATA_API_KEY        || '', envs: ['production', 'preview'] },
  { key: 'PINATA_SECRET_KEY',     value: process.env.PINATA_SECRET_KEY     || '', envs: ['production', 'preview'] },
  { key: 'RESEND_API_KEY',        value: process.env.RESEND_API_KEY        || '', envs: ['production', 'preview'] },
  { key: 'FROM_EMAIL',            value: 'deliver@realrealgenuine.com',           envs: ['production', 'preview'] },
  { key: 'ADMIN_SECRET',          value: process.env.ADMIN_SECRET          || '', envs: ['production', 'preview'] },
  { key: 'ADMIN_READONLY_SECRET', value: process.env.ADMIN_READONLY_SECRET || '', envs: ['production', 'preview'] },
];

const BASE_URL = `https://api.vercel.com/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}`;

async function listExistingEnvs() {
  const res = await fetch(BASE_URL, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to list env vars: ${err}`);
  }
  const data = await res.json();
  return data.envs || [];
}

async function upsertEnvVar(key, value, envs) {
  const existing = existingEnvs.find(e => e.key === key);

  const body = { key, value, type: 'encrypted', target: envs };

  if (existing) {
    // Update
    const url = `https://api.vercel.com/v10/projects/${PROJECT_ID}/env/${existing.id}?teamId=${TEAM_ID}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, target: envs }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to update ${key}: ${err}`);
    }
    console.log(`  ✓ Updated  ${key}`);
  } else {
    // Create
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to create ${key}: ${err}`);
    }
    console.log(`  ✓ Created  ${key}`);
  }
}

let existingEnvs = [];

async function run() {
  console.log('Fetching existing environment variables...');
  existingEnvs = await listExistingEnvs();
  console.log(`Found ${existingEnvs.length} existing env vars.\n`);

  console.log('Setting environment variables...');
  for (const { key, value, envs } of envVars) {
    await upsertEnvVar(key, value, envs);
  }

  console.log('\n✅ All environment variables set!');
  console.log('\nTriggering a new deployment...');

  // Trigger redeploy by hitting the deploy hook or just noting the git push will do it
  console.log('Push a commit to GitHub (or use Vercel dashboard → Deployments → Redeploy)');
  console.log(`Dashboard: https://vercel.com/richard-entrepotasis-projects/rrg`);
}

run().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
