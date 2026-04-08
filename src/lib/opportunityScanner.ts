import { ethers } from "ethers";
import ArbitragePathfinder, { DEXPool, ArbitrageOpportunity } from "./arbitragePathfinder";

/**
 * Opportunity Scanner
 * Continuously scans for arbitrage opportunities across multiple DEXs
 * Implements real-time pool monitoring and opportunity detection
 */

export interface ScannerConfig {
  updateInterval: number; // milliseconds
  minProfitBps: number; // Minimum profit in basis points
  maxPathLength: number; // Maximum hops in arbitrage path
  gasEstimate: bigint; // Estimated gas cost in wei
}

export interface ScannerStats {
  lastUpdate: number;
  poolsMonitored: number;
  opportunitiesFound: number;
  topOpportunity: ArbitrageOpportunity | null;
  averageProfitBps: number;
}

class OpportunityScanner {
  private pathfinder: ArbitragePathfinder;
  private provider: ethers.Provider;
  private config: ScannerConfig;
  private stats: ScannerStats;
  private opportunities: ArbitrageOpportunity[] = [];
  private isScanning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;

  constructor(provider: ethers.Provider, config: ScannerConfig) {
    this.provider = provider;
    this.config = config;
    this.pathfinder = new ArbitragePathfinder(provider);
    this.stats = {
      lastUpdate: Date.now(),
      poolsMonitored: 0,
      opportunitiesFound: 0,
      topOpportunity: null,
      averageProfitBps: 0
    };
  }

  /**
   * Start scanning for opportunities
   */
  startScanning(): void {
    if (this.isScanning) return;
    this.isScanning = true;

    console.log("🔍 Opportunity Scanner started");

    this.scanInterval = setInterval(() => {
      this.scan().catch(err => {
        console.error("Scanner error:", err.message);
      });
    }, this.config.updateInterval);
  }

  /**
   * Stop scanning
   */
  stopScanning(): void {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.isScanning = false;
    console.log("⏸️  Opportunity Scanner stopped");
  }

  /**
   * Perform a single scan
   */
  private async scan(): Promise<void> {
    try {
      // Detect arbitrage cycles
      const cycles = this.pathfinder.detectArbitrageCycles(this.config.maxPathLength);

      // Filter by minimum profit
      this.opportunities = cycles.filter(opp => opp.profitBps >= this.config.minProfitBps);

      // Update statistics
      this.updateStats();

      if (this.opportunities.length > 0) {
        console.log(`✨ Found ${this.opportunities.length} opportunities`);
        console.log(`🏆 Top opportunity: ${this.opportunities[0].profitBps} bps`);
      }
    } catch (err: any) {
      console.error("Scan failed:", err.message);
    }
  }

  /**
   * Update scanner statistics
   */
  private updateStats(): void {
    const graphSize = this.pathfinder.getGraphSize();
    this.stats.lastUpdate = Date.now();
    this.stats.poolsMonitored = graphSize.nodes;
    this.stats.opportunitiesFound = this.opportunities.length;
    this.stats.topOpportunity = this.opportunities.length > 0 ? this.opportunities[0] : null;

    if (this.opportunities.length > 0) {
      const totalProfit = this.opportunities.reduce((sum, opp) => sum + opp.profitBps, 0);
      this.stats.averageProfitBps = Math.round(totalProfit / this.opportunities.length);
    } else {
      this.stats.averageProfitBps = 0;
    }
  }

  /**
   * Add a pool to the scanner
   */
  addPool(pool: DEXPool): void {
    this.pathfinder.addPool(pool);
  }

  /**
   * Get current opportunities
   */
  getOpportunities(): ArbitrageOpportunity[] {
    return [...this.opportunities];
  }

  /**
   * Get opportunities above a certain profit threshold
   */
  getOpportunitiesAbove(profitBps: number): ArbitrageOpportunity[] {
    return this.opportunities.filter(opp => opp.profitBps >= profitBps);
  }

  /**
   * Get statistics
   */
  getStats(): ScannerStats {
    return { ...this.stats };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.pathfinder.clear();
    this.opportunities = [];
    this.stats = {
      lastUpdate: Date.now(),
      poolsMonitored: 0,
      opportunitiesFound: 0,
      topOpportunity: null,
      averageProfitBps: 0
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ScannerConfig>): void {
    this.config = { ...this.config, ...config };
    if (this.scanInterval && config.updateInterval) {
      this.stopScanning();
      this.startScanning();
    }
  }
}

export default OpportunityScanner;
