import { ethers } from "ethers";

/**
 * RpcManager - Singleton Pattern for RPC Provider Management
 * 
 * This class handles:
 * 1. Single HTTP provider instance (no duplication)
 * 2. Proper cleanup when switching RPC endpoints
 * 3. Intelligent retry logic with exponential backoff
 * 4. Connection health monitoring
 * 5. Separation of concerns: HTTP for calls, WS for events
 */

interface RpcConfig {
  httpUrl: string;
  wsUrl?: string;
  timeout?: number;
  maxRetries?: number;
  backoffMultiplier?: number;
}

interface ProviderStats {
  lastError?: string;
  lastErrorTime?: number;
  failureCount: number;
  successCount: number;
  isHealthy: boolean;
  lastHealthCheck?: number;
}

class RpcManager {
  private static instance: RpcManager;
  private httpProvider: ethers.JsonRpcProvider | null = null;
  private wsProvider: ethers.WebSocketProvider | null = null;
  private multicallProvider: any = null;
  private bscNetwork: ethers.Network;
  private currentHttpUrl: string = "";
  private currentWsUrl: string = "";
  private stats: ProviderStats = {
    failureCount: 0,
    successCount: 0,
    isHealthy: false
  };
  private failureThreshold = 5; // Switch RPC after 5 consecutive failures
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastSwitchTime = 0;
  private minSwitchInterval = 30000; // Minimum 30s between switches to prevent thrashing

  // Configuration
  private httpRpcList: string[] = [];
  private wsRpcList: string[] = [];
  private currentHttpIndex = 0;
  private currentWsIndex = 0;
  private timeout = 10000; // 10s timeout per request
  private maxRetries = 3;
  private backoffMultiplier = 2;

  private constructor() {
    this.bscNetwork = ethers.Network.from(56);
  }

  /**
   * Get singleton instance
   */
  static getInstance(): RpcManager {
    if (!RpcManager.instance) {
      RpcManager.instance = new RpcManager();
    }
    return RpcManager.instance;
  }

  /**
   * Initialize with RPC endpoints
   */
  async initialize(httpRpcs: string[], wsRpcs: string[] = []): Promise<void> {
    this.httpRpcList = httpRpcs;
    this.wsRpcList = wsRpcs;

    console.log(`[RpcManager] Initializing with ${httpRpcs.length} HTTP RPCs and ${wsRpcs.length} WS RPCs`);

    // Try to connect to first HTTP RPC
    await this.switchHttpProvider(0);

    // Start health check
    this.startHealthCheck();
  }

  /**
   * Get HTTP provider (for calls, state reads)
   */
  getHttpProvider(): ethers.JsonRpcProvider {
    if (!this.httpProvider) {
      throw new Error("[RpcManager] HTTP Provider not initialized. Call initialize() first.");
    }
    return this.httpProvider;
  }

  /**
   * Get WS provider (for events, subscriptions)
   */
  getWsProvider(): ethers.WebSocketProvider | null {
    return this.wsProvider;
  }

  /**
   * Get multicall provider (for batched calls)
   */
  getMulticallProvider(): any {
    return this.multicallProvider;
  }

  /**
   * Switch to next HTTP RPC endpoint with retry logic
   */
  private async switchHttpProvider(startIndex: number = -1): Promise<boolean> {
    // Prevent rapid switching (thrashing protection)
    const timeSinceLastSwitch = Date.now() - this.lastSwitchTime;
    if (timeSinceLastSwitch < this.minSwitchInterval) {
      console.warn(
        `[RpcManager] Switching too frequently (${timeSinceLastSwitch}ms ago). Waiting...`
      );
      return false;
    }

    const nextIndex = startIndex >= 0 ? startIndex : (this.currentHttpIndex + 1) % this.httpRpcList.length;
    const rpcUrl = this.httpRpcList[nextIndex];

    console.log(`[RpcManager] Attempting to switch to HTTP RPC: ${rpcUrl}`);

    try {
      // Create new provider with timeout
      const newProvider = new ethers.JsonRpcProvider(rpcUrl, this.bscNetwork, {
        staticNetwork: true,
        batchMaxCount: 1
      });

      // Test connection with timeout
      const networkPromise = newProvider.getNetwork();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Network detection timeout")), this.timeout)
      );

      await Promise.race([networkPromise, timeoutPromise]);

      // Close old provider if exists
      if (this.httpProvider) {
        try {
          await this.httpProvider.destroy?.();
        } catch (e) {
          console.warn("[RpcManager] Error destroying old provider:", (e as any).message);
        }
      }

      // Update provider
      this.httpProvider = newProvider;
      this.currentHttpUrl = rpcUrl;
      this.currentHttpIndex = nextIndex;
      this.lastSwitchTime = Date.now();

      // Reset failure counter on success
      this.stats.failureCount = 0;
      this.stats.successCount++;
      this.stats.isHealthy = true;
      this.stats.lastHealthCheck = Date.now();

      console.log(`[RpcManager] ✅ Successfully switched to: ${rpcUrl}`);

      // Reinitialize multicall with new provider
      await this.initializeMulticall();

      return true;
    } catch (error: any) {
      console.error(`[RpcManager] ❌ Failed to switch to ${rpcUrl}: ${error.message}`);
      this.stats.lastError = error.message;
      this.stats.lastErrorTime = Date.now();

      // Try next RPC if available
      if (nextIndex !== this.currentHttpIndex) {
        return this.switchHttpProvider((nextIndex + 1) % this.httpRpcList.length);
      }

      return false;
    }
  }

  /**
   * Initialize multicall provider
   */
  private async initializeMulticall(): Promise<void> {
    try {
      if (!this.httpProvider) return;

      const { MulticallWrapper } = await import("ethers-multicall-provider");
      this.multicallProvider = MulticallWrapper.wrap(this.httpProvider);
      console.log("[RpcManager] Multicall provider initialized");
    } catch (error: any) {
      console.warn("[RpcManager] Multicall initialization failed:", error.message);
      this.multicallProvider = null;
    }
  }

  /**
   * Setup WebSocket provider (separate from HTTP)
   */
  async setupWsProvider(wsRpc: string): Promise<boolean> {
    try {
      console.log(`[RpcManager] Setting up WS provider: ${wsRpc}`);

      // Close old WS if exists
      if (this.wsProvider) {
        try {
          this.wsProvider.destroy?.();
        } catch (e) {
          console.warn("[RpcManager] Error destroying old WS provider:", (e as any).message);
        }
      }

      const newWsProvider = new ethers.WebSocketProvider(wsRpc, this.bscNetwork, {
        staticNetwork: true
      });

      // Test connection
      const networkPromise = newWsProvider.getNetwork();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("WS network detection timeout")), this.timeout)
      );

      await Promise.race([networkPromise, timeoutPromise]);

      this.wsProvider = newWsProvider;
      this.currentWsUrl = wsRpc;
      console.log(`[RpcManager] ✅ WS provider connected: ${wsRpc}`);

      return true;
    } catch (error: any) {
      console.error(`[RpcManager] ❌ Failed to setup WS provider: ${error.message}`);
      return false;
    }
  }

  /**
   * Report a failure and potentially switch RPC
   */
  async reportFailure(error: string): Promise<void> {
    this.stats.failureCount++;
    this.stats.lastError = error;
    this.stats.lastErrorTime = Date.now();

    console.warn(
      `[RpcManager] Failure reported (${this.stats.failureCount}/${this.failureThreshold}): ${error}`
    );

    // Switch RPC if threshold reached
    if (this.stats.failureCount >= this.failureThreshold) {
      console.error(`[RpcManager] Failure threshold reached. Switching RPC...`);
      this.stats.failureCount = 0;
      await this.switchHttpProvider();
    }
  }

  /**
   * Report success
   */
  reportSuccess(): void {
    this.stats.failureCount = 0;
    this.stats.successCount++;
    this.stats.isHealthy = true;
  }

  /**
   * Health check - periodically verify provider is working
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        if (!this.httpProvider) return;

        const blockNumber = await this.httpProvider.getBlockNumber();
        this.stats.isHealthy = true;
        this.stats.lastHealthCheck = Date.now();
        console.log(`[RpcManager] Health check OK - Block: ${blockNumber}`);
      } catch (error: any) {
        console.warn(`[RpcManager] Health check failed: ${error.message}`);
        this.stats.isHealthy = false;
        await this.reportFailure(`Health check failed: ${error.message}`);
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Get provider statistics
   */
  getStats(): ProviderStats {
    return { ...this.stats };
  }

  /**
   * Get current HTTP URL
   */
  getCurrentHttpUrl(): string {
    return this.currentHttpUrl;
  }

  /**
   * Get current WS URL
   */
  getCurrentWsUrl(): string {
    return this.currentWsUrl;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    if (this.httpProvider) {
      try {
        await this.httpProvider.destroy?.();
      } catch (e) {
        console.warn("[RpcManager] Error destroying HTTP provider:", (e as any).message);
      }
    }

    if (this.wsProvider) {
      try {
        this.wsProvider.destroy?.();
      } catch (e) {
        console.warn("[RpcManager] Error destroying WS provider:", (e as any).message);
      }
    }

    console.log("[RpcManager] Cleanup complete");
  }
}

export default RpcManager;
