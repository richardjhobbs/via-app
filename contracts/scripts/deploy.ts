import hre from 'hardhat';
const { ethers, network } = hre;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying RRG from:', deployer.address);
  console.log('Network:', network.name);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('ETH balance:', ethers.formatEther(balance));

  const isTestnet = network.name === 'baseSepolia';

  const USDC_ADDRESS = isTestnet
    ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'  // Base Sepolia USDC
    : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base Mainnet USDC (verified)

  const PLATFORM_WALLET = '0xe653804032A2d51Cc031795afC601B9b1fd2c375';
  const BASE_URI        = 'https://realrealgenuine.com/api/rrg/drops/';

  console.log('USDC:', USDC_ADDRESS);
  console.log('Platform wallet:', PLATFORM_WALLET);

  const RRG = await ethers.getContractFactory('RRG');
  const rrg = await RRG.deploy(USDC_ADDRESS, PLATFORM_WALLET, BASE_URI);

  await rrg.waitForDeployment();
  const address = await rrg.getAddress();

  console.log('');
  console.log('✅ RRG deployed to:', address);
  console.log('');
  console.log('Add to .env.local:');
  console.log(`NEXT_PUBLIC_VIA_CONTRACT_ADDRESS=${address}`);
  console.log('');

  if (isTestnet) {
    console.log(`Verify on Sepolia: https://sepolia.basescan.org/address/${address}`);
  } else {
    console.log(`Verify on Base: https://basescan.org/address/${address}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
