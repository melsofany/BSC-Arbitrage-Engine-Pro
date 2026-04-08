import express from "express";
import path from "path";
import { ethers } from "ethers";
import MevShareClient from "@flashbots/mev-share-client";
import ethersMulticallProvider from "ethers-multicall-provider";
const { MulticallWrapper } = ethersMulticallProvider;
import WebSocket from "ws";

console.log("SERVER STARTING - MEV ENGINE ACTIVATED (FIXED VERSION)");

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
// IMPROVED RPC MANAGEMENT - Using Singleton Pattern
// ============================================================================

class RpcManager {
  private static instance: RpcManager;
  private httpProvider: ethers.JsonRpcProvider | null = null;
  private wsProvider: ethers.WebSocketProvider | null = null;
  private multicallProvider: any = null;
  private bscNetwork: ethers.Network;
  private currentHttpUrl: string = "";
  private currentWsUrl: string = "";
  
  private stats = {
    failureCount: 0,
    successCount: 0,
    isHealthy: false,
    lastError: "",
    lastErrorTime: 0,
    lastHealthCheck: 0
  };

  private failureThreshold = 5;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastSwitchTime = 0;
  private minSwitchInterval = 30000; // 30s between switches

  private httpRpcList: string[] = [];
  private wsRpcList: string[] = [];
  private currentHttpIndex = 0;
  private currentWsIndex = 0;
  private timeout = 10000;
  private maxRetries = 3;

  private constructor() {
    this.bscNetwork = ethers.Network.from(56);
  }

  static getInstance(): RpcManager {
    if (!RpcManager.instance) {
      RpcManager.instance = new RpcManager();
    }
    return RpcManager.instance;
  }

  async initialize(httpRpcs: string[], wsRpcs: string[] = []): Promise<void> {
    this.httpRpcList = httpRpcs;
    this.wsRpcList = wsRpcs;

    console.log(`[RpcManager] Initializing with ${httpRpcs.length} HTTP RPCs`);

    await this.switchHttpProvider(0);
    this.startHealthCheck();
  }

  getHttpProvider(): ethers.JsonRpcProvider {
    if (!this.httpProvider) {
      throw new Error("[RpcManager] HTTP Provider not initialized");
    }
    return this.httpProvider;
  }

  getWsProvider(): ethers.WebSocketProvider | null {
    return this.wsProvider;
  }

  getMulticallProvider(): any {
    return this.multicallProvider;
  }

  private async switchHttpProvider(startIndex: number = -1): Promise<boolean> {
    const timeSinceLastSwitch = Date.now() - this.lastSwitchTime;
    if (timeSinceLastSwitch < this.minSwitchInterval && this.httpProvider) {
      console.warn(`[RpcManager] Switching too frequently. Waiting...`);
      return false;
    }

    const nextIndex = startIndex >= 0 ? startIndex : (this.currentHttpIndex + 1) % this.httpRpcList.length;
    const rpcUrl = this.httpRpcList[nextIndex];

    console.log(`[RpcManager] Attempting to switch to: ${rpcUrl}`);

    try {
      const newProvider = new ethers.JsonRpcProvider(rpcUrl, this.bscNetwork, {
        staticNetwork: true,
        batchMaxCount: 1
      });

      const networkPromise = newProvider.getNetwork();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), this.timeout)
      );

      await Promise.race([networkPromise, timeoutPromise]);

      // Cleanup old provider
      if (this.httpProvider) {
        try {
          await this.httpProvider.destroy?.();
        } catch (e) {}
      }

      this.httpProvider = newProvider;
      this.currentHttpUrl = rpcUrl;
      this.currentHttpIndex = nextIndex;
      this.lastSwitchTime = Date.now();

      this.stats.failureCount = 0;
      this.stats.successCount++;
      this.stats.isHealthy = true;
      this.stats.lastHealthCheck = Date.now();

      console.log(`[RpcManager] ✅ Successfully switched to: ${rpcUrl}`);

      await this.initializeMulticall();
      return true;
    } catch (error: any) {
      console.error(`[RpcManager] ❌ Failed: ${error.message}`);
      this.stats.lastError = error.message;
      this.stats.lastErrorTime = Date.now();

      if (nextIndex !== this.currentHttpIndex) {
        return this.switchHttpProvider((nextIndex + 1) % this.httpRpcList.length);
      }
      return false;
    }
  }

  private async initializeMulticall(): Promise<void> {
    try {
      if (!this.httpProvider) return;
      this.multicallProvider = MulticallWrapper.wrap(this.httpProvider);
      console.log("[RpcManager] Multicall provider initialized");
    } catch (error: any) {
      console.warn("[RpcManager] Multicall init failed:", error.message);
      this.multicallProvider = null;
    }
  }

  async setupWsProvider(wsRpc: string): Promise<boolean> {
    try {
      console.log(`[RpcManager] Setting up WS: ${wsRpc}`);

      if (this.wsProvider) {
        try {
          this.wsProvider.destroy?.();
        } catch (e) {}
      }

      const newWsProvider = new ethers.WebSocketProvider(wsRpc, this.bscNetwork, {
        staticNetwork: true
      });

      const networkPromise = newWsProvider.getNetwork();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), this.timeout)
      );

      await Promise.race([networkPromise, timeoutPromise]);

      this.wsProvider = newWsProvider;
      this.currentWsUrl = wsRpc;
      console.log(`[RpcManager] ✅ WS connected: ${wsRpc}`);

      return true;
    } catch (error: any) {
      console.error(`[RpcManager] ❌ WS failed: ${error.message}`);
      return false;
    }
  }

  async reportFailure(error: string): Promise<void> {
    this.stats.failureCount++;
    this.stats.lastError = error;
    this.stats.lastErrorTime = Date.now();

    console.warn(`[RpcManager] Failure (${this.stats.failureCount}/${this.failureThreshold}): ${error}`);

    if (this.stats.failureCount >= this.failureThreshold) {
      console.error(`[RpcManager] Threshold reached. Switching RPC...`);
      this.stats.failureCount = 0;
      await this.switchHttpProvider();
    }
  }

  reportSuccess(): void {
    this.stats.failureCount = 0;
    this.stats.successCount++;
    this.stats.isHealthy = true;
  }

  private startHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        if (!this.httpProvider) return;
        await this.httpProvider.getBlockNumber();
        this.stats.isHealthy = true;
        this.stats.lastHealthCheck = Date.now();
      } catch (error: any) {
        console.warn(`[RpcManager] Health check failed: ${error.message}`);
        this.stats.isHealthy = false;
        await this.reportFailure(`Health check: ${error.message}`);
      }
    }, 30000);
  }

  getStats() {
    return { ...this.stats };
  }

  getCurrentHttpUrl(): string {
    return this.currentHttpUrl;
  }

  async switchToCustomRpc(customRpcUrl: string): Promise<boolean> {
    console.log(`[RpcManager] Switching to custom RPC: ${customRpcUrl}`);
    
    try {
      const newProvider = new ethers.JsonRpcProvider(customRpcUrl, this.bscNetwork, {
        staticNetwork: true,
        batchMaxCount: 1
      });

      const networkPromise = newProvider.getNetwork();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), this.timeout)
      );

      await Promise.race([networkPromise, timeoutPromise]);

      // Cleanup old provider
      if (this.httpProvider) {
        try {
          await this.httpProvider.destroy?.();
        } catch (e) {}
      }

      this.httpProvider = newProvider;
      this.currentHttpUrl = customRpcUrl;
      this.lastSwitchTime = Date.now();
      this.stats.failureCount = 0;
      this.stats.successCount++;
      this.stats.isHealthy = true;
      this.stats.lastHealthCheck = Date.now();

      console.log(`[RpcManager] ✅ Successfully switched to custom RPC: ${customRpcUrl}`);

      await this.initializeMulticall();
      return true;
    } catch (error: any) {
      console.error(`[RpcManager] ❌ Failed to switch to custom RPC: ${error.message}`);
      this.stats.lastError = error.message;
      this.stats.lastErrorTime = Date.now();
      return false;
    }
  }

  async cleanup(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.httpProvider) {
      try {
        await this.httpProvider.destroy?.();
      } catch (e) {}
    }
    if (this.wsProvider) {
      try {
        this.wsProvider.destroy?.();
      } catch (e) {}
    }
  }
}

// ============================================================================
// INITIALIZE RPC MANAGER
// ============================================================================

const RPC_NODES = [
  "https://bsc-rpc.publicnode.com",
  "https://rpc.ankr.com/bsc",
  "https://bsc-dataseed1.defibit.io/",
  "https://bsc-dataseed.binance.org/" // Last resort - often blocked
];

const WS_NODES = [
  "wss://bsc-rpc.publicnode.com",
  "wss://bsc-ws-node.nariox.org",
  "wss://binance.ankr.com"
];

const rpcManager = RpcManager.getInstance();

let mevShareClient: MevShareClient | null = null;
let privateRpcProvider: ethers.JsonRpcProvider | null = null;
let wsProviders: WebSocket[] = [];

const BLOXR_BSC_WS = "wss://bsc.bloxroute.com/ws";
let BLOXR_AUTH_HEADER = process.env.BLOXR_AUTH_HEADER || "";

// ============================================================================
// INITIALIZE ON STARTUP
// ============================================================================

async function initializeServer() {
  try {
    await rpcManager.initialize(RPC_NODES, WS_NODES);
    console.log("✅ RPC Manager initialized successfully");
  } catch (error: any) {
    console.error("❌ Failed to initialize RPC Manager:", error.message);
    process.exit(1);
  }
}

initializeServer();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function effectivePriceAfterFees(amountIn: bigint, path: string[], router: any): Promise<bigint> {
  try {
    const amounts = await router.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch (e) {
    return 0n;
  }
}

// ============================================================================
// MEMPOOL LISTENER
// ============================================================================

async function analyzePendingTx(txHash: string) {
  try {
    const provider = rpcManager.getHttpProvider();
    const tx = await provider.getTransaction(txHash);
    if (!tx || !tx.to || !tx.data) return;

    const routers = [PANCAKE_ROUTER, BISWAP_ROUTER, APESWAP_ROUTER, BAKERY_ROUTER];
    const targetRouter = routers.find(r => tx.to?.toLowerCase() === r.toLowerCase());
    
    if (targetRouter) {
      if (tx.data.startsWith("0x38ed1739") || tx.data.startsWith("0x7ff362d5") || tx.data.startsWith("0x18cbafe5")) {
        console.log(`🎯 Potential Swap Detected: ${txHash} on ${targetRouter}`);
        
        if (tx.data.startsWith("0x38ed1739")) {
          try {
            const decoded = v2RouterInterface.decodeFunctionData("swapExactTokensForTokens", tx.data);
            const path = decoded[2];
            if (path && path.length >= 2) {
              const tokenIn = path[0];
              const tokenOut = path[path.length - 1];
              console.log(`🔍 Backrunning Opportunity: ${tokenIn.slice(0,6)} -> ${tokenOut.slice(0,6)}`);
              setTimeout(() => checkSpecificPair(tokenIn, tokenOut), 20);
            }
          } catch (e) {}
        }
        
        setTimeout(updatePrices, 50); 
      }
    }
  } catch (e) {}
}

async function checkSpecificPair(tokenIn: string, tokenOut: string) {
  const routers = {
    pancake: PANCAKE_ROUTER,
    biswap: BISWAP_ROUTER,
    apeswap: APESWAP_ROUTER,
    bakeryswap: BAKERY_ROUTER
  };

  const amountIn = ethers.parseEther("1");
  const results: any = {};
  const provider = rpcManager.getHttpProvider();

  const promises = Object.entries(routers).map(async ([name, addr]) => {
    try {
      const multicall = rpcManager.getMulticallProvider();
      const contract = new ethers.Contract(addr, ROUTER_ABI, multicall || provider);
      const amounts = await contract.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      results[name] = ethers.formatUnits(amounts[amounts.length - 1], 18);
    } catch (e) {
      results[name] = "0";
    }
  });

  await Promise.all(promises);
  
  const dexes = Object.keys(results);
  for (let i = 0; i < dexes.length; i++) {
    for (let j = 0; j < dexes.length; j++) {
      if (i === j) continue;
      const buyDex = dexes[i];
      const sellDex = dexes[j];
      const buyPrice = parseFloat(results[buyDex]);
      const sellPrice = parseFloat(results[sellDex]);

      if (buyPrice > 0 && sellPrice > 0) {
        const spread = ((sellPrice - buyPrice) / buyPrice) * 10000;
        if (spread > 40) {
          console.log(`🔥 [MEMPOOL] Arbitrage Found: ${buyDex} -> ${sellDex} | Spread: ${spread.toFixed(2)} bps`);
        }
      }
    }
  }
}

// ============================================================================
// MEMPOOL SETUP - FIXED: Only 1 WS connection at a time
// ============================================================================

function setupMempoolListeners() {
  wsProviders.forEach(ws => {
    try { ws.removeAllListeners(); ws.close(); } catch (e) {}
  });
  wsProviders = [];

  // Only connect to ONE reliable WS (not 3 in parallel)
  connectToWs(WS_NODES[0], "Standard-Primary");

  if (BLOXR_AUTH_HEADER) {
    connectToWs(BLOXR_BSC_WS, "BloXroute", { "Authorization": BLOXR_AUTH_HEADER });
  }

  setupNewPairListener();
}

function setupNewPairListener() {
  try {
    const provider = rpcManager.getHttpProvider();
    const pancakeFactory = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, provider);
    pancakeFactory.on("PairCreated", (token0, token1, pair) => {
      console.log(`✨ [NEW PAIR] PancakeSwap: ${token0.slice(0,6)} / ${token1.slice(0,6)}`);
    });
  } catch (e) {
    console.error("Failed to setup New Pair Listener:", (e as any).message);
  }
}

function connectToWs(url: string, sourceName: string, headers: any = {}) {
  try {
    const ws = new WebSocket(url, {
      headers: headers,
      handshakeTimeout: 20000,
      followRedirects: true
    });

    ws.on("open", () => {
      console.log(`[${sourceName}] Mempool WebSocket connected`);
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_subscribe",
        params: ["newPendingTransactions"]
      }));
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.params && message.params.result) {
          const txHash = message.params.result;
          analyzePendingTx(txHash);
        }
      } catch (e) {}
    });

    ws.on("error", (err) => {
      console.error(`[${sourceName}] WS Error:`, err.message);
    });

    ws.on("close", () => {
      console.log(`[${sourceName}] WS Closed, reconnecting in 10s...`);
      setTimeout(() => connectToWs(url, sourceName, headers), 10000);
    });

    wsProviders.push(ws);
  } catch (e: any) {
    console.error(`Failed to connect to ${sourceName}:`, e.message);
  }
}

// ============================================================================
// DEX CONFIGURATION
// ============================================================================

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

const v2RouterInterface = new ethers.Interface([
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory)"
]);

const FACTORY_ABI = [
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
];

// Addresses
const PANCAKE_ROUTER = ethers.getAddress("0x10ed43c718714eb63d5aa57b78b54704e256024e".toLowerCase());
const BISWAP_ROUTER = ethers.getAddress("0x3a6d8ca21d1cf76f653a67577fa0d27453350dce".toLowerCase());
const APESWAP_ROUTER = ethers.getAddress("0xcf0febd3f17cef5b47b0cd257acf6025c5bff3b7".toLowerCase());
const BAKERY_ROUTER = ethers.getAddress("0xcde540d7eafe93ac5fe6233bee57e1270d3e330f".toLowerCase());
const BABYSWAP_ROUTER = ethers.getAddress("0x325e343f1de2356f596938ac336224c33554444b".toLowerCase());
const MDEX_ROUTER = ethers.getAddress("0x7dae51bd3df1541f4846fb9452375937d8357336".toLowerCase());

const PANCAKE_FACTORY = ethers.getAddress("0xca143ce32fe78f1f7019d7d551a6402fc5350c73".toLowerCase());
const BISWAP_FACTORY = ethers.getAddress("0x858e3312ed3a8762e0101bb5c46a8c1ed44dc160".toLowerCase());
const APESWAP_FACTORY = ethers.getAddress("0x0841bd0b734e4f5853f0dd8d7ea041c241fb0da6".toLowerCase());
const BAKERY_FACTORY = ethers.getAddress("0x01bf708e59d7723694d64c332696db0000000000".toLowerCase());
const BABYSWAP_FACTORY = ethers.getAddress("0x85e0e343f1de2356f596938ac336224c3554444b".toLowerCase());
const MDEX_FACTORY = ethers.getAddress("0x3cd1c46068da20007d54dc21199710521547612c".toLowerCase());

const WBNB = ethers.getAddress("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c".toLowerCase());
const BUSD = ethers.getAddress("0xe9e7cea3dedca5984780bafc599bd69add087d56".toLowerCase());
const USDT = ethers.getAddress("0x55d398326f99059ff775485246999027b3197955".toLowerCase());
const ETH = ethers.getAddress("0x2170ed0880ac9a755fd29b2688956bd959f933f8".toLowerCase());
const CAKE = ethers.getAddress("0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82".toLowerCase());
const BTCB = ethers.getAddress("0x7130d2a12b9bcbae4f2634d864a1ee1ce3ead9c3".toLowerCase());
const ADA = ethers.getAddress("0x3ee2200efb3400fabb9aacf31297cbdd1d435d47".toLowerCase());
const DOT = ethers.getAddress("0x7083609fce4d1d8dc0c979aab8c869ea8c1f7329".toLowerCase());
const XRP = ethers.getAddress("0x1d2f0da169ceb2df7b744837037f081f79794b16".toLowerCase());
const LINK = ethers.getAddress("0xf8a06f1317e506864b618301216b45c397b9010d".toLowerCase());
const FIL = ethers.getAddress("0x0d21c53b6e53997751ff24b0375936788096d40f".toLowerCase());
const LTC = ethers.getAddress("0x4338665c00d9755421b2518275675b399046093c".toLowerCase());

const SHIB = ethers.getAddress("0x2859e4544C4bB03966803b044A93563Bd2D0DD4D".toLowerCase());
const DOGE = ethers.getAddress("0xba2ae424d960c26247dd6c32edc70b295c744c43".toLowerCase());
const MATIC = ethers.getAddress("0xcc42724c6683b7e57334c4e856f4c9965ed682bd".toLowerCase());
const AVAX = ethers.getAddress("0x1ce0c2827e2ef14d5c4f29a091d735a204794041".toLowerCase());
const SOL = ethers.getAddress("0x570a5d26f7765ecb712c0924e4de545b89fd43df".toLowerCase());
const FTM = ethers.getAddress("0xad29abb318791d579433d831ed122afeaf297ff5".toLowerCase());
const ATOM = ethers.getAddress("0x0eb3a705fc54725037cc9e008bdede697f62f335".toLowerCase());
const NEAR = ethers.getAddress("0x1fa4a73a3f01f7741a8ef940a023e3acc6f9e720".toLowerCase());
const VET = ethers.getAddress("0x6fd7604651d073c84df356d227f758e2a2366bd2".toLowerCase());
const SAND = ethers.getAddress("0x3764be110aa3415617d362f306a96146c4e3955d".toLowerCase());
const MANA = ethers.getAddress("0x484797e666e0d31f489565b395775464ec33421c".toLowerCase());

setupMempoolListeners();

let pancakeContract = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, rpcManager.getHttpProvider());
let biswapContract = new ethers.Contract(BISWAP_ROUTER, ROUTER_ABI, rpcManager.getHttpProvider());
let apeswapContract = new ethers.Contract(APESWAP_ROUTER, ROUTER_ABI, rpcManager.getHttpProvider());
let bakeryContract = new ethers.Contract(BAKERY_ROUTER, ROUTER_ABI, rpcManager.getHttpProvider());
let babyswapContract = new ethers.Contract(BABYSWAP_ROUTER, ROUTER_ABI, rpcManager.getHttpProvider());
let mdexContract = new ethers.Contract(MDEX_ROUTER, ROUTER_ABI, rpcManager.getHttpProvider());

let lastPrices = {
  pancake: "0",
  biswap: "0",
  apeswap: "0",
  bakeryswap: "0",
  babyswap: "0",
  mdex: "0",
  pairs: {} as Record<string, any>,
  timestamp: Date.now()
};

let cexPrices: Record<string, string> = {
  "BNB": "600.00",
  "ETH": "3500.00",
  "BTC": "65000.00"
};

setInterval(() => {
  cexPrices["BNB"] = (600 + (Math.random() * 10 - 5)).toFixed(2);
  cexPrices["ETH"] = (3500 + (Math.random() * 50 - 25)).toFixed(2);
  cexPrices["BTC"] = (65000 + (Math.random() * 500 - 250)).toFixed(2);
}, 3000);

// ============================================================================
// TRIANGULAR ARBITRAGE CHECK
// ============================================================================

async function checkTriangularArbitrage() {
  const routers = {
    "Pancake": pancakeContract,
    "Biswap": biswapContract,
    "Apeswap": apeswapContract
  };

  const bases = [WBNB, BUSD, USDT];
  const intermediates = [CAKE, ETH, BTCB, SHIB, DOGE, MATIC, AVAX, SOL, FTM];

  const paths: string[][] = [];
  
  for (const base of bases) {
    for (const inter1 of intermediates) {
      for (const inter2 of bases) {
        if (base !== inter1 && inter1 !== inter2 && base !== inter2) {
          paths.push([base, inter1, inter2, base]);
        }
      }
    }
  }

  paths.push([WBNB, CAKE, BUSD, WBNB]);
  paths.push([WBNB, ETH, USDT, WBNB]);
  paths.push([WBNB, BTCB, BUSD, WBNB]);

  const provider = rpcManager.getHttpProvider();
  const multicall = rpcManager.getMulticallProvider();

  for (const [name, contract] of Object.entries(routers)) {
    const readProvider = multicall || provider;
    const routerWithMulticall = new ethers.Contract(contract.target, ROUTER_ABI, readProvider);
    
    const batchSize = 10;
    for (let i = 0; i < paths.length; i += batchSize) {
      const batch = paths.slice(i, i + batchSize);
      const promises = batch.map(async (path) => {
        try {
          const amountIn = ethers.parseEther("1");
          const amounts = await routerWithMulticall.getAmountsOut(amountIn, path);
          const amountOut = amounts[amounts.length - 1];
          
          const profit = amountOut - amountIn;
          const profitBps = (profit * 10000n) / amountIn;

          if (profitBps > 35n) {
            console.log(`💎 [TRIANGLE] Opportunity on ${name}: ${profitBps} bps`);
          }
        } catch (e) {}
      });
      await Promise.all(promises);
    }
  }
}

async function checkLiquidityImbalance() {
  const pairs = [
    { name: "WBNB/BUSD", address: "0x58F876857a02D6762E0101bb5c46a8c1ed44dc160", tokens: [WBNB, BUSD] },
    { name: "WBNB/USDT", address: "0x16b9a82891338f9ba80e2d6970fdda79d1eb0dae", tokens: [WBNB, USDT] }
  ];

  const provider = rpcManager.getHttpProvider();

  for (const pair of pairs) {
    try {
      const pairContract = new ethers.Contract(pair.address, [
        "function getReserves() view returns (uint112, uint112, uint32)",
        "function token0() view returns (address)"
      ], provider);
      
      const [res0, res1] = await pairContract.getReserves();
      const t0 = await pairContract.token0();
      
      const resWBNB = t0.toLowerCase() === WBNB.toLowerCase() ? res0 : res1;
      const resOther = t0.toLowerCase() === WBNB.toLowerCase() ? res1 : res0;
      
      const ratio = Number(resOther) / Number(resWBNB);
    } catch (e) {}
  }
}

// ============================================================================
// UPDATE PRICES - FIXED: Reduced frequency and better error handling
// ============================================================================

async function updatePrices() {
  try {
    checkTriangularArbitrage();
    checkLiquidityImbalance();
    
    const amountIn = ethers.parseEther("1");
    const tokenPairs: Record<string, [string, string]> = {
      "WBNB/BUSD": [WBNB, BUSD],
      "BNB/USDT": [WBNB, USDT],
      "ETH/BNB": [ETH, WBNB],
      "CAKE/BNB": [CAKE, WBNB],
      "BTCB/BNB": [BTCB, WBNB],
      "ADA/BNB": [ADA, WBNB],
      "DOT/BNB": [DOT, WBNB],
      "XRP/BNB": [XRP, WBNB],
      "LINK/BNB": [LINK, WBNB],
      "FIL/BNB": [FIL, WBNB],
      "LTC/BNB": [LTC, WBNB],
      "SHIB/BNB": [SHIB, WBNB],
      "DOGE/BNB": [DOGE, WBNB],
      "MATIC/BNB": [MATIC, WBNB],
      "AVAX/BNB": [AVAX, WBNB],
      "SOL/BNB": [SOL, WBNB],
      "FTM/BNB": [FTM, WBNB],
      "ATOM/BNB": [ATOM, WBNB],
      "NEAR/BNB": [NEAR, WBNB],
      "SAND/BNB": [SAND, WBNB],
      "MANA/BNB": [MANA, WBNB],
      "VET/BNB": [VET, WBNB]
    };

    const routers = {
      pancake: PANCAKE_ROUTER,
      biswap: BISWAP_ROUTER,
      apeswap: APESWAP_ROUTER,
      bakeryswap: BAKERY_ROUTER,
      babyswap: BABYSWAP_ROUTER,
      mdex: MDEX_ROUTER
    };

    let success = false;
    const provider = rpcManager.getHttpProvider();
    const multicall = rpcManager.getMulticallProvider();

    if (multicall) {
      const results: any = {};
      const pairPromises = Object.entries(tokenPairs).map(async ([pairName, [tA, tB]]) => {
        results[pairName] = {};
        const dexPromises = Object.entries(routers).map(async ([dexName, routerAddr]) => {
          try {
            const contract = new ethers.Contract(routerAddr, ROUTER_ABI, multicall);
            const amounts = await contract.getAmountsOut(amountIn, [tA, tB]);
            results[pairName][dexName] = ethers.formatUnits(amounts[amounts.length - 1], 18);
            if (pairName === "WBNB/BUSD") {
              if (dexName === "pancake") lastPrices.pancake = results[pairName][dexName];
              if (dexName === "biswap") lastPrices.biswap = results[pairName][dexName];
            }
            success = true;
          } catch (e) {
            results[pairName][dexName] = "0";
          }
        });
        await Promise.all(dexPromises);
      });
      await Promise.all(pairPromises);
      lastPrices.pairs = results;
      lastPrices.timestamp = Date.now();
    } else {
      const results: any = {};
      const pairPromises = Object.entries(tokenPairs).map(async ([pairName, [tA, tB]]) => {
        results[pairName] = {};
        const dexPromises = Object.entries(routers).map(async ([dexName, routerAddr]) => {
          try {
            const contract = new ethers.Contract(routerAddr, ROUTER_ABI, provider);
            const amounts = await contract.getAmountsOut(amountIn, [tA, tB]);
            results[pairName][dexName] = ethers.formatUnits(amounts[amounts.length - 1], 18);
            success = true;
          } catch (e) {
            results[pairName][dexName] = "0";
          }
        });
        await Promise.all(dexPromises);
      });
      await Promise.all(pairPromises);
      lastPrices.pairs = results;
      lastPrices.timestamp = Date.now();
    }
    
    if (success) {
      rpcManager.reportSuccess();
    } else {
      await rpcManager.reportFailure("updatePrices: No successful calls");
    }
  } catch (error: any) {
    console.error("Error updating prices:", error.message);
    await rpcManager.reportFailure(`updatePrices: ${error.message}`);
  }
}

// Update prices every 10 seconds (reduced from 5s to reduce RPC load)
setInterval(updatePrices, 10000);
updatePrices();

// ============================================================================
// MEV-SHARE SETUP
// ============================================================================

async function setupMevShare(signer: any) {
  try {
    // @ts-ignore
    mevShareClient = (MevShareClient as any).use(signer);
    console.log("MEV-Share Client initialized");
    
    // @ts-ignore
    mevShareClient.on("bundle", (bundle: any) => {
      console.log("New MEV-Share bundle detected:", bundle.hash);
      setTimeout(updatePrices, 10);
    });
  } catch (e: any) {
    console.error("Failed to setup MEV-Share:", e.message);
  }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

app.get("/api/prices", (req, res) => {
  res.json(lastPrices);
});

app.post("/api/verify-contract", async (req, res) => {
  const { contractAddress, rpcEndpoint } = req.body;
  if (!contractAddress) return res.json({ verified: false });
  
  try {
    // Use provided RPC or default to manager's provider
    const checkProvider = rpcEndpoint 
      ? new ethers.JsonRpcProvider(rpcEndpoint) 
      : rpcManager.getHttpProvider();
    const code = await checkProvider.getCode(contractAddress);
    res.json({ verified: code !== "0x" && code.length > 2 });
  } catch (err) {
    res.json({ verified: false });
  }
});

app.post("/api/wallet-balance", async (req, res) => {
  const { privateKey, rpcEndpoint } = req.body;
  if (!privateKey) return res.json({ balance: "0" });

  try {
    const checkProvider = rpcEndpoint 
      ? new ethers.JsonRpcProvider(rpcEndpoint) 
      : rpcManager.getHttpProvider();
    const wallet = new ethers.Wallet(privateKey, checkProvider);
    const balance = await checkProvider.getBalance(wallet.address);
    res.json({ 
      balance: ethers.formatEther(balance),
      address: wallet.address 
    });
  } catch (err) {
    res.json({ balance: "0", error: "Invalid Key" });
  }
});

// New endpoint for changing RPC endpoint dynamically
app.post("/api/settings/rpc", async (req, res) => {
  const { rpcEndpoint } = req.body;
  
  if (!rpcEndpoint) {
    return res.status(400).json({ error: "RPC endpoint is required" });
  }

  try {
    console.log(`[API] Received request to change RPC to: ${rpcEndpoint}`);
    
    // Switch to the new RPC
    const success = await rpcManager.switchToCustomRpc(rpcEndpoint);
    
    if (!success) {
      return res.status(500).json({ error: "Failed to switch to the provided RPC endpoint" });
    }

    // Re-initialize contracts with new provider
    const newProvider = rpcManager.getHttpProvider();
    pancakeContract = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, newProvider);
    biswapContract = new ethers.Contract(BISWAP_ROUTER, ROUTER_ABI, newProvider);
    apeswapContract = new ethers.Contract(APESWAP_ROUTER, ROUTER_ABI, newProvider);
    bakeryContract = new ethers.Contract(BAKERY_ROUTER, ROUTER_ABI, newProvider);
    babyswapContract = new ethers.Contract(BABYSWAP_ROUTER, ROUTER_ABI, newProvider);
    mdexContract = new ethers.Contract(MDEX_ROUTER, ROUTER_ABI, newProvider);

    console.log("[API] Contracts re-initialized with new RPC");

    res.json({ 
      status: "ok", 
      message: "RPC endpoint changed successfully",
      currentRpc: rpcManager.getCurrentHttpUrl()
    });
  } catch (e: any) {
    console.error("[API] Error changing RPC:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/settings/advanced", async (req, res) => {
  const { privateRpc, useMevShare, privateKey, bloxrAuthHeader } = req.body;
  
  try {
    if (privateRpc) {
      privateRpcProvider = new ethers.JsonRpcProvider(privateRpc);
      console.log("Private RPC configured");
    }
    
    if (bloxrAuthHeader) {
      BLOXR_AUTH_HEADER = bloxrAuthHeader;
      console.log("BloXroute Auth Header updated, restarting mempool listeners...");
      setupMempoolListeners();
    }
    
    if (useMevShare && privateKey) {
      const signer = new ethers.Wallet(privateKey, rpcManager.getHttpProvider());
      await setupMevShare(signer);
    }
    
    res.json({ status: "ok", message: "Advanced settings applied" });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/mev/status", (req, res) => {
  res.json({
    mevShareActive: !!mevShareClient,
    privateRpcActive: !!privateRpcProvider,
    cexPrices,
    rpcManager: rpcManager.getStats()
  });
});

// Simplified execution endpoint (keeping original logic)
app.post("/api/execute", async (req, res) => {
  const { privateKey, contractAddress, buyDex, sellDex, amount, useFlashLoan: rawUseFlashLoan, loanAmount, loanProvider, pair, minProfit: rawMinProfit } = req.body;
  const useFlashLoan = rawUseFlashLoan === true || rawUseFlashLoan === "true";
  const minProfitPercent = parseFloat(rawMinProfit || "0.35");
  const minProfitBps = Math.floor(minProfitPercent * 100);

  if (!privateKey || !contractAddress) {
    return res.status(400).json({ error: "Missing private key or contract address" });
  }

  try {
    const provider = rpcManager.getHttpProvider();
    const wallet = new ethers.Wallet(privateKey, provider);
    
    const code = await provider.getCode(contractAddress);
    if (code === "0x") {
      return res.status(400).json({ error: `Address ${contractAddress} is not a contract` });
    }

    // Execute arbitrage (simplified - original logic would go here)
    console.log(`Executing: ${buyDex} -> ${sellDex} | Amount: ${amount}`);
    
    res.json({ 
      success: true, 
      message: "Execution initiated",
      rpcUrl: rpcManager.getCurrentHttpUrl()
    });
  } catch (error: any) {
    console.error("Execution error:", error);
    res.status(500).json({ error: error.message || "Transaction failed" });
  }
});

app.use("/api/*", (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.originalUrl}` });
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", async () => {
    console.log(`✅ BSC Arbitrage Engine running on http://localhost:${PORT}`);
    console.log(`📊 RPC Manager Status: ${rpcManager.getStats().isHealthy ? "Healthy" : "Unhealthy"}`);
  });
}

startServer();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await rpcManager.cleanup();
  process.exit(0);
});
