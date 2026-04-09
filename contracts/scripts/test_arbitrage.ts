/**
 * ============================================================================
 *  TEST ARBITRAGE SCRIPT
 *  Builds an ArbParams payload and calls executeArbitrage on the contract.
 *  Use this script to test on BSC Testnet or a local Hardhat fork.
 * ============================================================================
 */

import { ethers } from "hardhat";

// ── BSC Mainnet addresses (used for Hardhat fork testing) ────────────────
const PANCAKE_FACTORY   = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
const PANCAKE_ROUTER_V2 = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const BISWAP_ROUTER     = "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8";
const WBNB              = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const BUSD              = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56";
const USDT              = "0x55d398326f99059fF775485246999027B3197955";

// ── PancakeSwap V2 Pair (WBNB/BUSD) for flash loan ──────────────────────
const WBNB_BUSD_PAIR    = "0x58F876857a02D6762E0101bb5C46A8c1ED44Dc16";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Multi-Path Flash Arbitrage — Test Execution");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Signer: ${signer.address}`);
  console.log(`  Balance: ${ethers.formatEther(await ethers.provider.getBalance(signer.address))} BNB`);

  // ── Deploy contract (or use existing address) ──────────────────────────
  const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
  let contract;

  if (CONTRACT_ADDRESS) {
    console.log(`\n📋 Using existing contract: ${CONTRACT_ADDRESS}`);
    contract = await ethers.getContractAt("MultiPathFlashArbitrage", CONTRACT_ADDRESS);
  } else {
    console.log("\n⏳ Deploying fresh contract for testing...");
    const Factory = await ethers.getContractFactory("MultiPathFlashArbitrage");
    contract = await Factory.deploy(PANCAKE_FACTORY);
    await contract.waitForDeployment();
    console.log(`✅ Deployed at: ${await contract.getAddress()}`);
  }

  // ── Build ArbParams ────────────────────────────────────────────────────
  // Example: WBNB -> BUSD (PancakeSwap V2) -> WBNB (BiSwap)
  // This is a simple 2-hop arbitrage for testing purposes.

  const loanAmount = ethers.parseEther("1"); // Borrow 1 WBNB
  const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes from now
  const nonce = ethers.keccak256(ethers.toUtf8Bytes(`test-${Date.now()}`));

  const arbParams = {
    flashPair: WBNB_BUSD_PAIR,
    loanToken: WBNB,
    loanAmount: loanAmount,
    buyHops: [
      {
        dexRouter: PANCAKE_ROUTER_V2,
        tokenIn: WBNB,
        tokenOut: BUSD,
        amountOutMin: 0, // No slippage protection for testing
        fee: 0,
        dexVersion: 0, // V2
        quoter: ethers.ZeroAddress,
      },
    ],
    sellHops: [
      {
        dexRouter: BISWAP_ROUTER,
        tokenIn: BUSD,
        tokenOut: WBNB,
        amountOutMin: 0, // No slippage protection for testing
        fee: 0,
        dexVersion: 0, // V2
        quoter: ethers.ZeroAddress,
      },
    ],
    minProfitBps: 0, // Accept any profit for testing
    deadline: deadline,
    nonce: nonce,
  };

  console.log("\n📦 ArbParams:");
  console.log(`  Flash Pair:    ${arbParams.flashPair}`);
  console.log(`  Loan Token:    ${arbParams.loanToken} (WBNB)`);
  console.log(`  Loan Amount:   ${ethers.formatEther(arbParams.loanAmount)} WBNB`);
  console.log(`  Buy Hops:      ${arbParams.buyHops.length}`);
  console.log(`  Sell Hops:     ${arbParams.sellHops.length}`);
  console.log(`  Min Profit:    ${arbParams.minProfitBps} bps`);
  console.log(`  Deadline:      ${arbParams.deadline}`);
  console.log(`  Nonce:         ${arbParams.nonce}`);

  // ── Simulate (static call) ─────────────────────────────────────────────
  console.log("\n⏳ Simulating transaction (staticCall)...");
  try {
    await contract.executeArbitrage.staticCall(arbParams);
    console.log("✅ Simulation PASSED — transaction would succeed!");
  } catch (error: any) {
    console.log(`❌ Simulation FAILED: ${error.reason || error.message}`);
    console.log("   This is expected if there's no profitable spread between DEXs.");
    console.log("   The bot should only execute when a real opportunity exists.\n");
    return;
  }

  // ── Execute (real transaction) ─────────────────────────────────────────
  console.log("\n⏳ Executing transaction...");
  try {
    const tx = await contract.executeArbitrage(arbParams, {
      gasLimit: 1_000_000,
    });
    console.log(`📤 TX Hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ TX Confirmed in block ${receipt?.blockNumber}`);
    console.log(`⛽ Gas Used: ${receipt?.gasUsed.toString()}`);

    // ── Parse events ─────────────────────────────────────────────────
    console.log("\n📊 Events emitted:");
    for (const log of receipt?.logs || []) {
      try {
        const parsed = contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed) {
          console.log(`  [${parsed.name}]`);
          for (const [key, value] of Object.entries(parsed.args)) {
            if (isNaN(Number(key))) {
              console.log(`    ${key}: ${value}`);
            }
          }
        }
      } catch {
        // Skip non-contract events
      }
    }
  } catch (error: any) {
    console.log(`❌ Execution FAILED: ${error.reason || error.message}`);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Test Complete");
  console.log("═══════════════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
