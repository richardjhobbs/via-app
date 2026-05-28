/**
 * Update the on-chain contractURI to use the correct image URL
 */
import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const ABI = ['function setContractURI(string calldata newURI) external'];

const provider = new ethers.JsonRpcProvider(process.env.NEXT_PUBLIC_BASE_RPC_URL);
const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const contract = new ethers.Contract(
  process.env.NEXT_PUBLIC_VIA_CONTRACT_ADDRESS,
  ABI,
  signer
);

const metadata = {
  name: 'RRG — Real Real Genuine',
  description: 'Limited edition co-created designs on Base. Each drop is a unique collaboration between creator and platform, minted as an ERC-1155 token.',
  image: 'https://realrealgenuine.com/collection.png',
  external_link: 'https://realrealgenuine.com/rrg',
};

// Use data URI so it's self-contained on-chain
const dataUri = 'data:application/json;base64,' + Buffer.from(JSON.stringify(metadata)).toString('base64');

console.log('Setting contractURI...');
console.log('Image URL:', metadata.image);

const tx = await contract.setContractURI(dataUri);
console.log('TX hash:', tx.hash);
const receipt = await tx.wait(1);
console.log('✅ contractURI updated, gas used:', receipt.gasUsed.toString());
