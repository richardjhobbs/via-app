/**
 * deploy-rrg.cjs — Deploy a fresh RRG.sol to Base mainnet.
 * Run: node_modules/.bin/hardhat run scripts/deploy-rrg.cjs --network base
 */
const { ethers } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deploying from:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('Balance:', ethers.formatEther(balance), 'ETH');

  const RRG = await ethers.getContractFactory('RRG');
  console.log('Deploying RRG...');
  const rrg = await RRG.deploy();
  await rrg.waitForDeployment();

  const address = await rrg.getAddress();
  console.log('RRG deployed to:', address);
  console.log('Update NEXT_PUBLIC_VIA_CONTRACT_ADDRESS =', address);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
