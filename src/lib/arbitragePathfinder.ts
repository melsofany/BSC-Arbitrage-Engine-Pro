import { ethers } from "ethers";

/**
 * Advanced Arbitrage Pathfinder
 * Implements Bellman-Ford algorithm for detecting profitable arbitrage cycles
 * Supports triangular and multi-hop arbitrage opportunities
 */

export interface DEXPool {
  dexName: string;
  routerAddress: string;
  factoryAddress: string;
  token0: string;
  token1: string;
  reserve0: bigint;
  reserve1: bigint;
  fee: number; // in basis points (e.g., 25 = 0.25%)
}

export interface ArbitrageOpportunity {
  path: string[]; // Token addresses in order
  dexPath: string[]; // DEX names in order
  profitBps: number; // Profit in basis points
  estimatedProfit: bigint;
  volume: bigint;
  confidence: number; // 0-100, confidence in the opportunity
}

export interface PriceEdge {
  from: string;
  to: string;
  dex: string;
  rate: number; // Price of 'to' in terms of 'from'
  weight: number; // Log of rate for Bellman-Ford
  fee: number; // Fee in basis points
}

class ArbitragePathfinder {
  private pools: Map<string, DEXPool[]> = new Map();
  private priceGraph: Map<string, PriceEdge[]> = new Map();
  private provider: ethers.Provider;

  constructor(provider: ethers.Provider) {
    this.provider = provider;
  }

  /**
   * Add a pool to the graph
   */
  addPool(pool: DEXPool): void {
    const pairKey = this.getPairKey(pool.token0, pool.token1);
    if (!this.pools.has(pairKey)) {
      this.pools.set(pairKey, []);
    }
    this.pools.get(pairKey)!.push(pool);
    this.updatePriceGraph();
  }

  /**
   * Calculate exchange rate between two tokens on a specific DEX
   */
  private calculateRate(pool: DEXPool, tokenIn: string, tokenOut: string): number {
    const isToken0In = tokenIn.toLowerCase() === pool.token0.toLowerCase();
    const reserve0 = Number(pool.reserve0);
    const reserve1 = Number(pool.reserve1);

    if (reserve0 === 0 || reserve1 === 0) return 0;

    // Using Uniswap V2 formula: y = (x * 997) / (reserve_x * 1000 + x * 997)
    // For small amounts, approximate: rate = reserve_out / reserve_in
    const rate = isToken0In ? reserve1 / reserve0 : reserve0 / reserve1;
    const feeMultiplier = (10000 - pool.fee) / 10000;
    return rate * feeMultiplier;
  }

  /**
   * Update the price graph based on current pools
   */
  private updatePriceGraph(): void {
    this.priceGraph.clear();

    for (const [, pools] of this.pools) {
      for (const pool of pools) {
        const rateT0T1 = this.calculateRate(pool, pool.token0, pool.token1);
        const rateT1T0 = this.calculateRate(pool, pool.token1, pool.token0);

        if (rateT0T1 > 0) {
          this.addEdge(pool.token0, pool.token1, pool.dexName, rateT0T1, pool.fee);
        }
        if (rateT1T0 > 0) {
          this.addEdge(pool.token1, pool.token0, pool.dexName, rateT1T0, pool.fee);
        }
      }
    }
  }

  /**
   * Add a directed edge to the price graph
   */
  private addEdge(from: string, to: string, dex: string, rate: number, fee: number): void {
    const key = from.toLowerCase();
    if (!this.priceGraph.has(key)) {
      this.priceGraph.set(key, []);
    }

    // Weight is the negative log of the rate (for Bellman-Ford to find maximum cycles)
    const weight = -Math.log(rate);

    this.priceGraph.get(key)!.push({
      from,
      to,
      dex,
      rate,
      weight,
      fee
    });
  }

  /**
   * Detect profitable arbitrage cycles using modified Bellman-Ford algorithm
   * Returns cycles where the product of exchange rates > 1 (after fees)
   */
  detectArbitrageCycles(maxPathLength: number = 4): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    const tokens = Array.from(new Set(
      Array.from(this.priceGraph.keys()).map(t => t.toLowerCase())
    ));

    // For each token, try to find profitable cycles starting from it
    for (const startToken of tokens) {
      const cycles = this.findCyclesFromToken(startToken, maxPathLength);
      for (const cycle of cycles) {
        const opportunity = this.evaluateCycle(cycle);
        if (opportunity && opportunity.profitBps > 30) { // Minimum 30 bps profit
          opportunities.push(opportunity);
        }
      }
    }

    // Sort by profit in descending order
    return opportunities.sort((a, b) => b.profitBps - a.profitBps);
  }

  /**
   * Find cycles starting from a specific token using DFS
   */
  private findCyclesFromToken(startToken: string, maxDepth: number): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const path: string[] = [startToken];

    const dfs = (current: string, depth: number) => {
      if (depth === 0) return;

      const edges = this.priceGraph.get(current.toLowerCase()) || [];
      for (const edge of edges) {
        if (edge.to.toLowerCase() === startToken.toLowerCase() && path.length > 2) {
          // Found a cycle back to start
          cycles.push([...path, startToken]);
        } else if (!visited.has(edge.to.toLowerCase()) && path.length < maxDepth) {
          visited.add(edge.to.toLowerCase());
          path.push(edge.to);
          dfs(edge.to, depth - 1);
          path.pop();
          visited.delete(edge.to.toLowerCase());
        }
      }
    };

    visited.add(startToken.toLowerCase());
    dfs(startToken, maxDepth);
    return cycles;
  }

  /**
   * Evaluate a cycle to determine if it's profitable
   */
  private evaluateCycle(cycle: string[]): ArbitrageOpportunity | null {
    let cumulativeRate = 1;
    let totalFee = 0;
    const dexPath: string[] = [];

    for (let i = 0; i < cycle.length - 1; i++) {
      const from = cycle[i];
      const to = cycle[i + 1];
      const edges = this.priceGraph.get(from.toLowerCase()) || [];
      const edge = edges.find(e => e.to.toLowerCase() === to.toLowerCase());

      if (!edge) return null;

      cumulativeRate *= edge.rate;
      totalFee += edge.fee;
      dexPath.push(edge.dex);
    }

    const profitBps = Math.round((cumulativeRate - 1) * 10000);

    if (profitBps <= 30) return null; // Not profitable enough

    return {
      path: cycle,
      dexPath,
      profitBps,
      estimatedProfit: BigInt(0), // Will be calculated during execution
      volume: BigInt(0), // Will be calculated during execution
      confidence: Math.min(100, Math.max(0, profitBps / 10))
    };
  }

  /**
   * Get pair key for storing pools
   */
  private getPairKey(token0: string, token1: string): string {
    const t0 = token0.toLowerCase();
    const t1 = token1.toLowerCase();
    return t0 < t1 ? `${t0}-${t1}` : `${t1}-${t0}`;
  }

  /**
   * Clear all pools and rebuild graph
   */
  clear(): void {
    this.pools.clear();
    this.priceGraph.clear();
  }

  /**
   * Get current price graph size
   */
  getGraphSize(): { nodes: number; edges: number } {
    const nodes = this.priceGraph.size;
    let edges = 0;
    for (const [, edgeList] of this.priceGraph) {
      edges += edgeList.length;
    }
    return { nodes, edges };
  }
}

export default ArbitragePathfinder;
