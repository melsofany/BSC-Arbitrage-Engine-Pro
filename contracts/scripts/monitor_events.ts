/**
 * ============================================================================
 *  EVENT MONITOR SCRIPT
 *  Listens to all events emitted by the MultiPathFlashArbitrage contract
 *  and displays them in a human-readable format in real-time.
 *
 *  Usage:
 *    CONTRACT_ADDRESS=0x... npx ts-node scripts/monitor_events.ts
 * ============================================================================
 */

import { ethers } from "ethers";

// ── Configuration ────────────────────────────────────────────────────────
const RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const WSS_URL = process.env.BSC_WSS_URL || "wss://bsc-ws-node.nariox.org:443";

// ── Contract ABI (events only) ───────────────────────────────────────────
const ABI = [
  "event Debug(string message, uint256 value)",
  "event DebugAddr(string message, address value)",
  "event DebugBalance(address indexed token, uint256 balance, string stage)",
  "event DebugStep(string stepName, uint256 timestamp)",
  "event ExecutionFailed(string reason, string step)",
  "event ArbStarted(address indexed loanToken, uint256 loanAmount, uint256 minProfitBps, uint256 deadline, uint256 buySteps, uint256 sellSteps, bytes32 nonce)",
  "event ArbFinished(uint256 timestamp)",
  "event FlashLoanReceived(address indexed pair, address indexed token, uint256 amount, uint256 availableLiquidity)",
  "event SwapExecuted(uint8 indexed leg, uint256 indexed stepIndex, address dexRouter, uint8 dexVersion, address tokenIn, address tokenOut, uint256 amountIn, uint256 estimatedOut, uint256 actualOut, int256 slippageWei)",
  "event Approved(address indexed token, address indexed spender, uint256 amount)",
  "event Settlement(address indexed token, uint256 loanAmount, uint256 fee, uint256 totalRepay, uint256 finalBalance, uint256 netProfit, uint256 profitBps)",
  "event ProfitSent(address indexed token, uint256 amount, address indexed recipient)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
];

// ── Token names for readability ──────────────────────────────────────────
const TOKEN_NAMES: Record<string, string> = {
  "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c": "WBNB",
  "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56": "BUSD",
  "0x55d398326f99059fF775485246999027B3197955": "USDT",
  "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d": "USDC",
  "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82": "CAKE",
};

const DEX_NAMES: Record<string, string> = {
  "0x10ED43C718714eb63d5aA57B78B54704E256024E": "PancakeV2",
  "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4": "PancakeV3",
  "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2": "UniswapV3",
  "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8": "BiSwap",
};

function tokenName(addr: string): string {
  return TOKEN_NAMES[addr] || addr.slice(0, 10) + "...";
}

function dexName(addr: string): string {
  return DEX_NAMES[addr] || addr.slice(0, 10) + "...";
}

function dexVersionName(v: number): string {
  return v === 0 ? "V2" : v === 1 ? "UniV3" : v === 2 ? "PcV3" : `v${v}`;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  if (!CONTRACT_ADDRESS) {
    console.error("❌ Please set CONTRACT_ADDRESS environment variable.");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Multi-Path Flash Arbitrage — Event Monitor");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Contract: ${CONTRACT_ADDRESS}`);
  console.log(`  RPC:      ${RPC_URL}`);
  console.log("═══════════════════════════════════════════════════════════\n");
  console.log("👂 Listening for events...\n");

  // Try WebSocket first, fall back to HTTP polling
  let provider: ethers.Provider;
  try {
    provider = new ethers.WebSocketProvider(WSS_URL);
    console.log("🔗 Connected via WebSocket\n");
  } catch {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    console.log("🔗 Connected via HTTP (polling)\n");
  }

  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);

  // ── Listen to all events ───────────────────────────────────────────────

  contract.on("ArbStarted", (loanToken, loanAmount, minProfitBps, deadline, buySteps, sellSteps, nonce) => {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║  🚀 ARBITRAGE STARTED                                   ║");
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(`║  Loan Token:    ${tokenName(loanToken)}`);
    console.log(`║  Loan Amount:   ${ethers.formatEther(loanAmount)}`);
    console.log(`║  Min Profit:    ${minProfitBps.toString()} bps (${(Number(minProfitBps) / 100).toFixed(2)}%)`);
    console.log(`║  Buy Steps:     ${buySteps.toString()}`);
    console.log(`║  Sell Steps:    ${sellSteps.toString()}`);
    console.log(`║  Nonce:         ${nonce}`);
    console.log("╚══════════════════════════════════════════════════════════╝\n");
  });

  contract.on("FlashLoanReceived", (pair, token, amount, availableLiquidity) => {
    console.log(`  💰 Flash Loan Received:`);
    console.log(`     Token: ${tokenName(token)} | Amount: ${ethers.formatEther(amount)}`);
    console.log(`     Available Liquidity: ${ethers.formatEther(availableLiquidity)}\n`);
  });

  contract.on("SwapExecuted", (leg, stepIndex, dexRouter, dexVersion, tokenIn, tokenOut, amountIn, estimatedOut, actualOut, slippageWei) => {
    const legStr = Number(leg) === 0 ? "🟢 BUY" : "🔴 SELL";
    const slippage = Number(slippageWei);
    const slippageStr = slippage >= 0 ? `+${ethers.formatEther(slippageWei)}` : ethers.formatEther(slippageWei);
    
    console.log(`  ${legStr} Step #${stepIndex.toString()}:`);
    console.log(`     DEX: ${dexName(dexRouter)} (${dexVersionName(Number(dexVersion))})`);
    console.log(`     ${tokenName(tokenIn)} → ${tokenName(tokenOut)}`);
    console.log(`     Amount In:     ${ethers.formatEther(amountIn)}`);
    console.log(`     Estimated Out: ${ethers.formatEther(estimatedOut)}`);
    console.log(`     Actual Out:    ${ethers.formatEther(actualOut)}`);
    console.log(`     Slippage:      ${slippageStr} wei (${slippage >= 0 ? "✅" : "⚠️"})\n`);
  });

  contract.on("Settlement", (token, loanAmount, fee, totalRepay, finalBalance, netProfit, profitBps) => {
    console.log("╔══════════════════════════════════════════════════════════╗");
    console.log("║  💵 SETTLEMENT                                          ║");
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log(`║  Token:         ${tokenName(token)}`);
    console.log(`║  Loan Amount:   ${ethers.formatEther(loanAmount)}`);
    console.log(`║  Fee:           ${ethers.formatEther(fee)}`);
    console.log(`║  Total Repay:   ${ethers.formatEther(totalRepay)}`);
    console.log(`║  Final Balance: ${ethers.formatEther(finalBalance)}`);
    console.log(`║  ─────────────────────────────────────────────────────`);
    console.log(`║  💰 NET PROFIT: ${ethers.formatEther(netProfit)} (${profitBps.toString()} bps = ${(Number(profitBps) / 100).toFixed(2)}%)`);
    console.log("╚══════════════════════════════════════════════════════════╝\n");
  });

  contract.on("ProfitSent", (token, amount, recipient) => {
    console.log(`  ✅ Profit Sent: ${ethers.formatEther(amount)} ${tokenName(token)} → ${recipient}\n`);
  });

  contract.on("ArbFinished", (timestamp) => {
    const date = new Date(Number(timestamp) * 1000);
    console.log(`  🏁 Arbitrage Finished at ${date.toISOString()}\n`);
    console.log("───────────────────────────────────────────────────────────\n");
  });

  contract.on("ExecutionFailed", (reason, step) => {
    console.log(`  ❌ EXECUTION FAILED:`);
    console.log(`     Step:   ${step}`);
    console.log(`     Reason: ${reason}\n`);
  });

  contract.on("Debug", (message, value) => {
    console.log(`  🔍 Debug: ${message} = ${value.toString()}`);
  });

  contract.on("DebugAddr", (message, value) => {
    console.log(`  🔍 Debug: ${message} = ${value}`);
  });

  contract.on("DebugBalance", (token, balance, stage) => {
    console.log(`  📊 Balance [${stage}]: ${tokenName(token)} = ${ethers.formatEther(balance)}`);
  });

  contract.on("DebugStep", (stepName, timestamp) => {
    console.log(`  ⏱️  Step: ${stepName} @ ${new Date(Number(timestamp) * 1000).toISOString()}`);
  });

  // Keep the script running
  console.log("Press Ctrl+C to stop monitoring.\n");
  await new Promise(() => {}); // Block forever
}

main().catch(console.error);
