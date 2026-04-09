import { ethers } from "hardhat";

// ============================================================================
// BSC ADDRESSES
// ============================================================================

const BSC_MAINNET = {
  PANCAKE_FACTORY: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
  PANCAKE_ROUTER_V2: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  PANCAKE_ROUTER_V3: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
  UNISWAP_V3_ROUTER: "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2",
  BISWAP_ROUTER: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  BUSD: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};

const BSC_TESTNET = {
  PANCAKE_FACTORY: "0x6725F303b657a9451d8BA641348b6761A6CC7a17",
  PANCAKE_ROUTER_V2: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
  WBNB: "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd",
};

// ============================================================================
// DEPLOY SCRIPT
// ============================================================================

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Multi-Path Flash Arbitrage Engine v2.0 — Deployment");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Network:   ${chainId === 56 ? "BSC Mainnet" : chainId === 97 ? "BSC Testnet" : `Unknown (${chainId})`}`);
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // Select factory address based on network
  let pancakeFactory: string;
  if (chainId === 56) {
    pancakeFactory = BSC_MAINNET.PANCAKE_FACTORY;
    console.log("📡 Deploying to BSC MAINNET...");
  } else if (chainId === 97) {
    pancakeFactory = BSC_TESTNET.PANCAKE_FACTORY;
    console.log("🧪 Deploying to BSC TESTNET...");
  } else {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  // Deploy the contract
  console.log(`\n🏭 PancakeFactory: ${pancakeFactory}`);
  console.log("⏳ Deploying MultiPathFlashArbitrage...\n");

  const Factory = await ethers.getContractFactory("MultiPathFlashArbitrage");
  const contract = await Factory.deploy(pancakeFactory);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  ✅ DEPLOYMENT SUCCESSFUL!");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Contract Address: ${contractAddress}`);
  console.log(`  Owner:            ${deployer.address}`);
  console.log(`  PancakeFactory:   ${pancakeFactory}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // Verify on BscScan (optional)
  if (chainId === 56 || chainId === 97) {
    console.log("📋 To verify on BscScan, run:");
    console.log(`   npx hardhat verify --network ${chainId === 56 ? "bsc" : "bscTestnet"} ${contractAddress} ${pancakeFactory}\n`);
  }

  // Print useful addresses for the bot configuration
  if (chainId === 56) {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  📌 BSC MAINNET DEX ADDRESSES (for bot config)");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  PancakeSwap V2 Router: ${BSC_MAINNET.PANCAKE_ROUTER_V2}`);
    console.log(`  PancakeSwap V3 Router: ${BSC_MAINNET.PANCAKE_ROUTER_V3}`);
    console.log(`  Uniswap V3 Router:     ${BSC_MAINNET.UNISWAP_V3_ROUTER}`);
    console.log(`  BiSwap Router:         ${BSC_MAINNET.BISWAP_ROUTER}`);
    console.log(`  WBNB:                  ${BSC_MAINNET.WBNB}`);
    console.log(`  BUSD:                  ${BSC_MAINNET.BUSD}`);
    console.log(`  USDT:                  ${BSC_MAINNET.USDT}`);
    console.log(`  USDC:                  ${BSC_MAINNET.USDC}`);
    console.log("═══════════════════════════════════════════════════════════\n");
  }

  return contractAddress;
}

main()
  .then((addr) => {
    console.log(`\n🎉 Done! Contract deployed at: ${addr}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
