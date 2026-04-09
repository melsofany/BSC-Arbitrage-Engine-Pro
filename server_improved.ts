// ============================================================================
// IMPROVED SERVER WITH BETTER PROFIT CALCULATION AND SIMULATION
// ============================================================================
// This is an enhanced version of server.ts with the following improvements:
// 1. Better profit calculation with gas fees and slippage consideration
// 2. Improved transaction simulation before execution
// 3. Better error handling and logging
// 4. Dynamic gas price adjustment based on profit
// ============================================================================

import express from "express";
import path from "path";
import { ethers } from "ethers";
import MevShareClient from "@flashbots/mev-share-client";
import ethersMulticallProvider from "ethers-multicall-provider";
const { MulticallWrapper } = ethersMulticallProvider;
import WebSocket from "ws";

console.log("SERVER STARTING - MEV ENGINE ACTIVATED (IMPROVED VERSION)");

const app = express();
const PORT = 3000;

app.use(express.json());

// Request Logger
app.use((req, res, next) => {
  if (req.path.startsWith("/api")) {
    console.log(`[API] ${req.method} ${req.path}`);
  }
  next();
});

// ============================================================================
// ENHANCED PROFIT CALCULATION HELPER
// ============================================================================

/**
 * Calculate realistic profit after considering gas fees and slippage
 * @param amountIn - Input amount
 * @param amountOut - Output amount from DEX
 * @param gasUsed - Estimated gas used in wei
 * @param gasPrice - Current gas price in wei
 * @param slippagePercent - Slippage percentage (e.g., 0.5 for 0.5%)
 * @returns Realistic net profit in wei
 */
async function calculateRealisticProfit(
  amountIn: bigint,
  amountOut: bigint,
  gasUsed: bigint = 500000n, // Typical gas for arbitrage
  gasPrice: bigint,
  slippagePercent: number = 0.5
): Promise<{ profit: bigint; profitBps: bigint; breakdown: any }> {
  // Calculate gas cost
  const gasCost = gasUsed * gasPrice;
  
  // Calculate slippage impact
  const slippageAmount = (amountOut * BigInt(Math.floor(slippagePercent * 100))) / 10000n;
  const amountOutAfterSlippage = amountOut - slippageAmount;
  
  // Calculate net profit
  const netProfit = amountOutAfterSlippage - amountIn - gasCost;
  
  // Calculate profit in basis points
  const profitBps = amountIn > 0n ? (netProfit * 10000n) / amountIn : 0n;
  
  return {
    profit: netProfit,
    profitBps: profitBps,
    breakdown: {
      amountIn: ethers.formatEther(amountIn),
      amountOut: ethers.formatEther(amountOut),
      slippageAmount: ethers.formatEther(slippageAmount),
      amountOutAfterSlippage: ethers.formatEther(amountOutAfterSlippage),
      gasCost: ethers.formatEther(gasCost),
      netProfit: ethers.formatEther(netProfit),
      profitBps: profitBps.toString()
    }
  };
}

/**
 * Simulate a transaction before executing it
 * Uses eth_call to check if the transaction would succeed
 */
async function simulateTransaction(
  provider: ethers.JsonRpcProvider,
  contractAddress: string,
  data: string,
  from: string
): Promise<{ success: boolean; result?: string; error?: string }> {
  try {
    const result = await provider.call({
      to: contractAddress,
      data: data,
      from: from,
      gasLimit: 1000000
    });
    return { success: true, result };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Estimate gas for a transaction
 */
async function estimateGasForTransaction(
  provider: ethers.JsonRpcProvider,
  contractAddress: string,
  data: string,
  from: string
): Promise<{ gasEstimate: bigint; error?: string }> {
  try {
    const gasEstimate = await provider.estimateGas({
      to: contractAddress,
      data: data,
      from: from
    });
    return { gasEstimate };
  } catch (error: any) {
    return { gasEstimate: 500000n, error: error.message };
  }
}

// ============================================================================
// ENHANCED OPPORTUNITY DETECTION
// ============================================================================

/**
 * Detect opportunities with realistic profit calculation
 */
async function detectOpportunitiesWithProfitCheck(
  prices: any,
  provider: ethers.JsonRpcProvider,
  minProfitBps: number = 50 // 0.5% minimum profit
): Promise<any[]> {
  const opportunities = [];
  
  if (!prices.pairs) return opportunities;
  
  try {
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits("5", "gwei");
    
    for (const [pairName, dexPrices] of Object.entries(prices.pairs)) {
      if (typeof dexPrices !== 'object' || dexPrices === null) continue;
      
      const dexEntries = Object.entries(dexPrices as Record<string, string>)
        .filter(([_, price]) => parseFloat(price) > 0);
      
      if (dexEntries.length < 2) continue;
      
      // Find best buy and best sell
      let bestBuy = dexEntries[0];
      let bestSell = dexEntries[0];
      
      for (const entry of dexEntries) {
        if (parseFloat(entry[1]) < parseFloat(bestBuy[1])) bestBuy = entry;
        if (parseFloat(entry[1]) > parseFloat(bestSell[1])) bestSell = entry;
      }
      
      const buyPrice = parseFloat(bestBuy[1]);
      const sellPrice = parseFloat(bestSell[1]);
      const rawDiff = sellPrice - buyPrice;
      const rawDiffPercent = (rawDiff / buyPrice) * 100;
      
      // Only consider opportunities with at least 0.5% raw spread
      if (rawDiffPercent < 0.5) continue;
      
      // Simulate profit with gas and slippage
      const amountIn = ethers.parseEther("1"); // 1 token for simulation
      const amountOut = ethers.parseEther((sellPrice / buyPrice).toString());
      
      const profitCalc = await calculateRealisticProfit(
        amountIn,
        amountOut,
        500000n, // Typical gas for arbitrage
        gasPrice,
        0.5 // 0.5% slippage
      );
      
      // Only include if realistic profit exceeds minimum
      if (profitCalc.profitBps >= BigInt(minProfitBps)) {
        opportunities.push({
          pair: pairName,
          buyDex: bestBuy[0],
          sellDex: bestSell[0],
          buyPrice,
          sellPrice,
          rawSpreadPercent: rawDiffPercent,
          realisticProfitBps: Number(profitCalc.profitBps),
          breakdown: profitCalc.breakdown,
          gasPrice: ethers.formatUnits(gasPrice, "gwei")
        });
      }
    }
  } catch (error: any) {
    console.error("Error detecting opportunities with profit check:", error.message);
  }
  
  return opportunities;
}

// ============================================================================
// ENHANCED TRANSACTION EXECUTION WITH BETTER ERROR HANDLING
// ============================================================================

/**
 * Enhanced execution with simulation and better error reporting
 */
async function executeArbitrageWithValidation(
  provider: ethers.JsonRpcProvider,
  wallet: ethers.Wallet,
  contractAddress: string,
  params: any,
  minProfitBps: number
): Promise<{ success: boolean; txHash?: string; error?: string; simulation?: any }> {
  try {
    // Step 1: Verify contract
    const code = await provider.getCode(contractAddress);
    if (code === "0x") {
      return { success: false, error: "Contract address is not a valid contract" };
    }
    
    // Step 2: Create contract instance
    const contract = new ethers.Contract(contractAddress, [
      "function executeArbitrage((address pair, address tokenBorrow, address tokenOut, uint256 loanAmount, address buyDex, address sellDex, uint256 minProfitBps, bytes buyCalldata, uint8 sellDexVersion, uint24 sellFee, uint256 deadline, bytes32 nonce, uint256 sellMinOut, address quoterAddress) p) external",
      "function owner() view returns (address)"
    ], wallet);
    
    // Step 3: Verify ownership
    try {
      const owner = await contract.owner();
      if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
        return { success: false, error: `Wallet is not the owner of the contract` };
      }
    } catch (e) {
      console.warn("Could not verify contract ownership");
    }
    
    // Step 4: Encode function call
    const encodedCall = contract.interface.encodeFunctionData("executeArbitrage", [params]);
    
    // Step 5: Simulate transaction
    console.log("Simulating transaction...");
    const simulation = await simulateTransaction(provider, contractAddress, encodedCall, wallet.address);
    
    if (!simulation.success) {
      return { 
        success: false, 
        error: `Transaction simulation failed: ${simulation.error}`,
        simulation 
      };
    }
    
    // Step 6: Estimate gas
    const gasEstimate = await estimateGasForTransaction(provider, contractAddress, encodedCall, wallet.address);
    console.log(`Gas estimate: ${gasEstimate.gasEstimate.toString()}`);
    
    // Step 7: Get current gas price and adjust dynamically
    const feeData = await provider.getFeeData();
    let gasPrice = feeData.gasPrice || ethers.parseUnits("5", "gwei");
    
    // Boost gas price based on profit
    if (params.minProfitBps > 100) { // > 1% profit
      gasPrice = (gasPrice * 150n) / 100n; // 50% boost
    } else if (params.minProfitBps > 50) { // > 0.5% profit
      gasPrice = (gasPrice * 120n) / 100n; // 20% boost
    }
    
    // Step 8: Execute transaction
    console.log("Executing transaction with optimized gas price...");
    const tx = await contract.executeArbitrage(params, {
      gasLimit: gasEstimate.gasEstimate + 100000n, // Add buffer
      gasPrice: gasPrice
    });
    
    console.log(`Transaction sent: ${tx.hash}`);
    
    // Step 9: Wait for confirmation
    const receipt = await tx.wait();
    
    return {
      success: true,
      txHash: receipt?.hash,
      simulation
    };
    
  } catch (error: any) {
    console.error("Execution error:", error);
    return {
      success: false,
      error: error.message || "Unknown execution error"
    };
  }
}

// ============================================================================
// EXPORT ENHANCED FUNCTIONS FOR USE IN MAIN SERVER
// ============================================================================

export {
  calculateRealisticProfit,
  simulateTransaction,
  estimateGasForTransaction,
  detectOpportunitiesWithProfitCheck,
  executeArbitrageWithValidation
};

// Note: This file provides enhanced functions that should be integrated into the main server.ts
// Key improvements:
// 1. Realistic profit calculation considering gas fees and slippage
// 2. Transaction simulation before execution
// 3. Better error handling and reporting
// 4. Dynamic gas price adjustment
// 5. Enhanced opportunity detection with profit filtering
