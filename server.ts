import express from "express";
import path from "path";
import { ethers } from "ethers";
import MevShareClient from "@flashbots/mev-share-client";
import ethersMulticallProvider from "ethers-multicall-provider";
const { MulticallWrapper } = ethersMulticallProvider;
import WebSocket from "ws";

console.log("SERVER STARTING - MEV ENGINE ACTIVATED");

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

// Advanced MEV Configuration
let mevShareClient: MevShareClient | null = null;
let privateRpcProvider: ethers.JsonRpcProvider | null = null;
let multicallProvider: any = null;
let wsProviders: WebSocket[] = [];

// BSC RPC URLs - Using multiple fallbacks for reliability
const RPC_NODES = [
  "https://bsc-dataseed.binance.org/",
  "https://bsc-rpc.publicnode.com",
  "https://rpc.ankr.com/bsc",
  "https://bsc-dataseed1.defibit.io/"
];

const WS_NODES = [
  "wss://bsc-rpc.publicnode.com",
  "wss://bsc-ws-node.nariox.org",
  "wss://binance.ankr.com"
];

// BloXroute & Flashbots Endpoints (BSC)
const BLOXR_BSC_WS = "wss://bsc.bloxroute.com/ws";
let BLOXR_AUTH_HEADER = process.env.BLOXR_AUTH_HEADER || ""; // User should provide this in settings

let currentWsIndex = 0;
let currentRpcIndex = 0;

// Initialize provider with static network to avoid "failed to detect network" errors
const bscNetwork = ethers.Network.from(56);

// Use a more robust initialization for JsonRpcProvider
let provider = new ethers.JsonRpcProvider(RPC_NODES[currentRpcIndex], bscNetwork, { 
  staticNetwork: true,
  batchMaxCount: 1 
});

// Initial connection check
async function verifyInitialConnection() {
  try {
    // Timeout the network check to avoid hanging
    const networkPromise = provider.getNetwork();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
    
    await Promise.race([networkPromise, timeoutPromise]);
    console.log(`✅ Connected to BSC via ${RPC_NODES[currentRpcIndex]}`);
  } catch (e: any) {
    console.warn(`⚠️ Initial RPC ${RPC_NODES[currentRpcIndex]} failed (${e.message}), switching...`);
    await switchRpc();
  }
}
verifyInitialConnection();

let switchRetries = 0;
let isSwitching = false;

async function initMulticall() {
  try {
    multicallProvider = MulticallWrapper.wrap(provider);
    console.log("Multicall Provider initialized (ethers-multicall-provider)");
  } catch (e: any) {
    console.error("Multicall init failed:", e.message);
  }
}

initMulticall();

// Helper for effective price calculation
async function effectivePriceAfterFees(amountIn: bigint, path: string[], router: any): Promise<bigint> {
  try {
    const amounts = await router.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch (e) {
    return 0n;
  }
}

// Mempool Listener for MEV with Rotation
async function analyzePendingTx(txHash: string) {
  try {
    const tx = await provider.getTransaction(txHash);
    if (!tx || !tx.to || !tx.data) return;

    const routers = [PANCAKE_ROUTER, BISWAP_ROUTER, APESWAP_ROUTER, BAKERY_ROUTER];
    const targetRouter = routers.find(r => tx.to?.toLowerCase() === r.toLowerCase());
    
    if (targetRouter) {
      // Check if it's a swapExactTokensForTokens (0x38ed1739) or swapExactETHForTokens (0x7ff362d5)
      if (tx.data.startsWith("0x38ed1739") || tx.data.startsWith("0x7ff362d5") || tx.data.startsWith("0x18cbafe5")) {
        console.log(`🎯 Potential Swap Detected in Mempool: ${txHash} on ${targetRouter}`);
        
        // Try to decode path if it's swapExactTokensForTokens
        if (tx.data.startsWith("0x38ed1739")) {
          try {
            const decoded = v2RouterInterface.decodeFunctionData("swapExactTokensForTokens", tx.data);
            const path = decoded[2];
            if (path && path.length >= 2) {
              const tokenIn = path[0];
              const tokenOut = path[path.length - 1];
              console.log(`🔍 Backrunning Opportunity: ${tokenIn.slice(0,6)} -> ${tokenOut.slice(0,6)}`);
              
              // Targeted check for this specific pair across all routers
              setTimeout(() => checkSpecificPair(tokenIn, tokenOut), 20);
            }
          } catch (e) {}
        }
        
        // Trigger general update if it's a major router
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

  const promises = Object.entries(routers).map(async ([name, addr]) => {
    try {
      const contract = new ethers.Contract(addr, ROUTER_ABI, multicallProvider || provider);
      const amounts = await contract.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      results[name] = ethers.formatUnits(amounts[amounts.length - 1], 18);
    } catch (e) {
      results[name] = "0";
    }
  });

  await Promise.all(promises);
  
  // Compare results and log if profitable
  const dexes = Object.keys(results);
  for (let i = 0; i < dexes.length; i++) {
    for (let j = 0; j < dexes.length; j++) {
      if (i === j) continue;
      const buyDex = dexes[i];
      const sellDex = dexes[j];
      const buyPrice = parseFloat(results[buyDex]);
      const sellPrice = parseFloat(results[sellDex]);

      if (buyPrice > 0 && sellPrice > 0) {
        // This is a very rough check, real check happens in execute
        const spread = ((sellPrice - buyPrice) / buyPrice) * 10000;
        if (spread > 40) {
          console.log(`🔥 [MEMPOOL] Arbitrage Found: ${buyDex} -> ${sellDex} | Spread: ${spread.toFixed(2)} bps`);
        }
      }
    }
  }
}

// Multi-Source Mempool Listener
function setupMempoolListeners() {
  // Clear existing
  wsProviders.forEach(ws => {
    try { ws.removeAllListeners(); ws.close(); } catch (e) {}
  });
  wsProviders = [];

  // 1. Standard BSC Nodes (Concurrent)
  WS_NODES.slice(0, 2).forEach((url, idx) => {
    connectToWs(url, `Standard-${idx}`);
  });

  // 2. BloXroute (if configured)
  if (BLOXR_AUTH_HEADER) {
    connectToWs(BLOXR_BSC_WS, "BloXroute", { "Authorization": BLOXR_AUTH_HEADER });
  } else {
    console.log("BloXroute Auth Header missing, skipping BloXroute mempool...");
  }

  // 3. New Pair Listener
  setupNewPairListener();
}

function setupNewPairListener() {
  try {
    const pancakeFactory = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, provider);
    pancakeFactory.on("PairCreated", (token0, token1, pair) => {
      console.log(`✨ [NEW PAIR] PancakeSwap: ${token0.slice(0,6)} / ${token1.slice(0,6)} at ${pair.slice(0,6)}`);
    });
  } catch (e) {
    console.error("Failed to setup New Pair Listener:", e.message);
  }
}

function connectToWs(url: string, sourceName: string, headers: any = {}) {
  try {
    const ws = new WebSocket(url, {
      headers: headers,
      handshakeTimeout: 20000, // Increased to 20s
      followRedirects: true
    });

    ws.on("open", () => {
      console.log(`[${sourceName}] Mempool WebSocket connected to ${url}`);
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
      console.log(`[${sourceName}] WS Closed, reconnecting in 5s...`);
      setTimeout(() => connectToWs(url, sourceName, headers), 5000);
    });

    wsProviders.push(ws);
  } catch (e: any) {
    console.error(`Failed to connect to ${sourceName}:`, e.message);
  }
}



async function switchRpc() {
  if (isSwitching) return;
  isSwitching = true;
  
  try {
    await performSwitch();
  } finally {
    isSwitching = false;
  }
}

async function performSwitch() {
  if (switchRetries >= RPC_NODES.length) {
    console.error("All RPC nodes are failing. Waiting before retry...");
    await new Promise(r => setTimeout(r, 10000));
    switchRetries = 0;
    return;
  }
  
  currentRpcIndex = (currentRpcIndex + 1) % RPC_NODES.length;
  switchRetries++;
  console.log(`Switching to RPC: ${RPC_NODES[currentRpcIndex]} (Attempt ${switchRetries})`);
  
  try {
    const newProvider = new ethers.JsonRpcProvider(RPC_NODES[currentRpcIndex], bscNetwork, { 
      staticNetwork: true,
      batchMaxCount: 1 
    });
    // Try to get network to verify it's working with timeout
    const networkPromise = newProvider.getNetwork();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
    
    await Promise.race([networkPromise, timeoutPromise]);
    
    provider = newProvider;
    // Re-initialize contracts with new provider
    pancakeContract = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, provider);
    biswapContract = new ethers.Contract(BISWAP_ROUTER, ROUTER_ABI, provider);
    apeswapContract = new ethers.Contract(APESWAP_ROUTER, ROUTER_ABI, provider);
    bakeryContract = new ethers.Contract(BAKERY_ROUTER, ROUTER_ABI, provider);
    console.log("Successfully switched to new RPC");
    switchRetries = 0; // Reset on success
  } catch (err: any) {
    console.error(`Failed to connect to RPC ${RPC_NODES[currentRpcIndex]}: ${err.message}`);
    await performSwitch();
  }
}

// DEX Router ABIs (Simplified for getAmountsOut)
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
console.log("BTCB ADDRESS:", BTCB);
const ADA = ethers.getAddress("0x3ee2200efb3400fabb9aacf31297cbdd1d435d47".toLowerCase());
const DOT = ethers.getAddress("0x7083609fce4d1d8dc0c979aab8c869ea8c1f7329".toLowerCase());
const XRP = ethers.getAddress("0x1d2f0da169ceb2df7b744837037f081f79794b16".toLowerCase());
const LINK = ethers.getAddress("0xf8a06f1317e506864b618301216b45c397b9010d".toLowerCase());
const FIL = ethers.getAddress("0x0d21c53b6e53997751ff24b0375936788096d40f".toLowerCase());
const LTC = ethers.getAddress("0x4338665c00d9755421b2518275675b399046093c".toLowerCase());

// Long-Tail & High Volatility Tokens
const SHIB = ethers.getAddress("0x2859e4544C4bB03966803b044A93563Bd2D0DD4D".toLowerCase());
const DOGE = ethers.getAddress("0xba2ae424d960c26247dd6c32edc70b295c744c43".toLowerCase());
const MATIC = ethers.getAddress("0xcc42724c6683b7e57334c4e856f4c9965ed682bd".toLowerCase());
const AVAX = ethers.getAddress("0x1ce0c2827e2ef14d5c4f29a091d735a204794041".toLowerCase());
const SOL = ethers.getAddress("0x570a5d26f7765ecb712c0924e4de545b89fd43df".toLowerCase());
const FTM = ethers.getAddress("0xad29abb318791d579433d831ed122afeaf297ff5".toLowerCase());
const ATOM = ethers.getAddress("0x0eb3a705fc54725037cc9e008bdede697f62f335".toLowerCase());
const NEAR = ethers.getAddress("0x1fa4a73a3f01f7741a8ef940a023e3acc6f9e720".toLowerCase());
const ALGO = ethers.getAddress("0xe79a6d4b9632b8d28641f42205049ce9997a3298".toLowerCase());

const VET = ethers.getAddress("0x6fd7604651d073c84df356d227f758e2a2366bd2".toLowerCase());
const SAND = ethers.getAddress("0x3764be110aa3415617d362f306a96146c4e3955d".toLowerCase());
const MANA = ethers.getAddress("0x484797e666e0d31f489565b395775464ec33421c".toLowerCase());

// Now that all addresses are defined, start listeners
setupMempoolListeners();

let pancakeContract = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, provider);
let biswapContract = new ethers.Contract(BISWAP_ROUTER, ROUTER_ABI, provider);
let apeswapContract = new ethers.Contract(APESWAP_ROUTER, ROUTER_ABI, provider);
let bakeryContract = new ethers.Contract(BAKERY_ROUTER, ROUTER_ABI, provider);
let babyswapContract = new ethers.Contract(BABYSWAP_ROUTER, ROUTER_ABI, provider);
let mdexContract = new ethers.Contract(MDEX_ROUTER, ROUTER_ABI, provider);

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

// Statistical Arbitrage (Mock CEX Prices)
let cexPrices: Record<string, string> = {
  "BNB": "600.00",
  "ETH": "3500.00",
  "BTC": "65000.00"
};

// Update CEX prices periodically (Mock)
setInterval(() => {
  cexPrices["BNB"] = (600 + (Math.random() * 10 - 5)).toFixed(2);
  cexPrices["ETH"] = (3500 + (Math.random() * 50 - 25)).toFixed(2);
  cexPrices["BTC"] = (65000 + (Math.random() * 500 - 250)).toFixed(2);
}, 3000);

async function checkTriangularArbitrage() {
  const routers = {
    "Pancake": pancakeContract,
    "Biswap": biswapContract,
    "Apeswap": apeswapContract
  };

  // Base tokens for triangular paths
  const bases = [WBNB, BUSD, USDT];
  // Intermediate tokens
  const intermediates = [CAKE, ETH, BTCB, SHIB, DOGE, MATIC, AVAX, SOL, FTM];

  const paths: string[][] = [];
  
  // Generate dynamic triangular paths
  for (const base of bases) {
    for (const inter1 of intermediates) {
      for (const inter2 of bases) {
        if (base !== inter1 && inter1 !== inter2 && base !== inter2) {
          paths.push([base, inter1, inter2, base]);
        }
      }
    }
  }

  // Add some specific high-volume paths
  paths.push([WBNB, CAKE, BUSD, WBNB]);
  paths.push([WBNB, ETH, USDT, WBNB]);
  paths.push([WBNB, BTCB, BUSD, WBNB]);

  for (const [name, contract] of Object.entries(routers)) {
    const readProvider = multicallProvider || provider;
    const routerWithMulticall = new ethers.Contract(contract.target, ROUTER_ABI, readProvider);
    
    // Process in batches to avoid RPC overload
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

          if (profitBps > 35n) { // Increased threshold to 35 bps as requested
            console.log(`💎 [TRIANGLE] Opportunity on ${name}: ${profitBps} bps | Path: ${path.map(a => a.slice(0,6)).join(" -> ")}`);
            // Trigger simulation or execution if needed
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
      
      // Simple imbalance check: if ratio deviates significantly from "normal"
      // This is a placeholder for more complex logic
      const ratio = Number(resOther) / Number(resWBNB);
      // console.log(`Liquidity Ratio for ${pair.name}: ${ratio}`);
    } catch (e) {}
  }
}

async function updatePrices() {
  // Run checks
  checkTriangularArbitrage();
  checkLiquidityImbalance();
  
  const amountIn = ethers.parseEther("1"); // 1 BNB
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
    "SHIB/BNB": ["0x2859e4544C4bB03966803b044A93563Bd2D0DD4D", WBNB],
    "DOGE/BNB": ["0xba2ae424d960c26247dd6c32edc70b295c744c43", WBNB],
    "MATIC/BNB": ["0xcc42724c6683b7e57334c4e856f4c9965ed682bd", WBNB],
    "AVAX/BNB": ["0x1ce0c2827e2ef14d5c4f29a091d735a204794041", WBNB],
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

  try {
    if (multicallProvider) {
      // Use Multicall for lightning fast updates
      const results: any = {};
      const pairPromises = Object.entries(tokenPairs).map(async ([pairName, [tA, tB]]) => {
        results[pairName] = {};
        const dexPromises = Object.entries(routers).map(async ([dexName, routerAddr]) => {
          try {
            const contract = new ethers.Contract(routerAddr, ROUTER_ABI, multicallProvider);
            const amounts = await contract.getAmountsOut(amountIn, [tA, tB]);
            // Use 18 as default but try to be safe
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
      // Fallback to sequential if Multicall not ready
      const results: any = {};
      const pairPromises = Object.entries(tokenPairs).map(async ([pairName, [tA, tB]]) => {
        results[pairName] = {};
        const dexPromises = Object.entries(routers).map(async ([dexName, routerAddr]) => {
          try {
            const contract = new ethers.Contract(routerAddr, ROUTER_ABI, provider);
            const amounts = await contract.getAmountsOut(amountIn, [tA, tB]);
            results[pairName][dexName] = ethers.formatUnits(amounts[1], 18);
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
    
    if (!success) {
      await switchRpc();
    }
  } catch (error: any) {
    console.error("Error updating prices:", error.message);
    await switchRpc();
  }
}

// MEV-Share Listener (Backrunning)
async function setupMevShare(signer: any) {
  try {
    // @ts-ignore
    mevShareClient = (MevShareClient as any).use(signer);
    console.log("MEV-Share Client initialized (Flashbots)");
    
    // Listen for hints (Backrunning)
    // @ts-ignore
    mevShareClient.on("bundle", (bundle: any) => {
      console.log("New MEV-Share bundle detected:", bundle.hash);
      // Logic to analyze bundle and potentially backrun
      // Trigger updatePrices to see if the bundle created an opportunity
      setTimeout(updatePrices, 10);
    });
  } catch (e: any) {
    console.error("Failed to setup MEV-Share:", e.message);
  }
}

// Update prices every 5 seconds
setInterval(updatePrices, 5000);
updatePrices();

app.get("/api/prices", (req, res) => {
  res.json(lastPrices);
});

app.post("/api/verify-contract", async (req, res) => {
  const { contractAddress, rpcEndpoint } = req.body;
  if (!contractAddress) return res.json({ verified: false });
  
  try {
    const checkProvider = rpcEndpoint ? new ethers.JsonRpcProvider(rpcEndpoint) : provider;
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
    const checkProvider = rpcEndpoint ? new ethers.JsonRpcProvider(rpcEndpoint) : provider;
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

app.post("/api/settings/advanced", async (req, res) => {
  const { privateRpc, useMevShare, privateKey, bloxrAuthHeader } = req.body;
  
  try {
    if (privateRpc) {
      privateRpcProvider = new ethers.JsonRpcProvider(privateRpc);
      console.log("Private RPC configured:", privateRpc);
    }
    
    if (bloxrAuthHeader) {
      BLOXR_AUTH_HEADER = bloxrAuthHeader;
      console.log("BloXroute Auth Header updated, restarting mempool listeners...");
      setupMempoolListeners();
    }
    
    if (useMevShare && privateKey) {
      const signer = new ethers.Wallet(privateKey, provider);
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
    cexPrices
  });
});

app.post("/api/execute", async (req, res) => {
  const { privateKey, contractAddress, buyDex, sellDex, amount, useFlashLoan: rawUseFlashLoan, loanAmount, loanProvider, pair, minProfit: rawMinProfit } = req.body;
  const useFlashLoan = rawUseFlashLoan === true || rawUseFlashLoan === "true";
  const minProfitPercent = parseFloat(rawMinProfit || "0.35");
  const minProfitBps = Math.floor(minProfitPercent * 100);

  console.log("--- New Execution Request ---");
  console.log(`Trade: ${buyDex} -> ${sellDex} | Pair: ${pair} | Amount: ${amount} | Flash: ${useFlashLoan}`);
  console.log("-----------------------------");
  if (!privateKey || !contractAddress) {
    return res.status(400).json({ error: "Missing private key or contract address" });
  }

  console.log(`Executing trade: ${buyDex} -> ${sellDex} | Pair: ${pair} | Amount: ${amount} | FlashLoan: ${useFlashLoan} | Loan: ${loanAmount} ${loanProvider}`);

  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Verify contract address has code
    const code = await provider.getCode(contractAddress);
    if (code === "0x") {
      return res.status(400).json({ error: `The address ${contractAddress} is not a contract. Please deploy the flash loan contract and provide its address.` });
    }

    const contract = new ethers.Contract(contractAddress, [
      "function executeArbitrage((address pair, address tokenBorrow, address tokenOut, uint256 loanAmount, address buyDex, address sellDex, uint256 minProfitBps, bytes buyCalldata, uint8 sellDexVersion, uint24 sellFee, uint256 deadline, bytes32 nonce, uint256 sellMinOut, address quoterAddress) p) external",
      "function owner() view returns (address)"
    ], wallet);

    const factories: Record<string, string> = {
      "pancake": PANCAKE_FACTORY,
      "pancakeswap": PANCAKE_FACTORY,
      "biswap": BISWAP_FACTORY,
      "apeswap": APESWAP_FACTORY,
      "bakery": BAKERY_FACTORY,
      "bakeryswap": BAKERY_FACTORY,
      "babyswap": BABYSWAP_FACTORY,
      "mdex": MDEX_FACTORY
    };

    const loanProviderKey = (loanProvider || "PancakeSwap").toLowerCase();
    const selectedFactory = factories[loanProviderKey] || factories[loanProviderKey.replace("swap", "")] || PANCAKE_FACTORY;
    const factoryContract = new ethers.Contract(selectedFactory, [
      "function getPair(address tokenA, address tokenB) external view returns (address pair)"
    ], provider);

    // Map DEX names to addresses (case-insensitive keys)
    const routers: Record<string, string> = {
      "pancake": PANCAKE_ROUTER,
      "pancakeswap": PANCAKE_ROUTER,
      "biswap": BISWAP_ROUTER,
      "apeswap": APESWAP_ROUTER,
      "bakeryswap": BAKERY_ROUTER,
      "bakery": BAKERY_ROUTER,
      "babyswap": BABYSWAP_ROUTER,
      "mdex": MDEX_ROUTER
    };

    const buyDexKey = buyDex.toLowerCase().replace("swap", "");
    const sellDexKey = sellDex.toLowerCase().replace("swap", "");
    
    const buyRouterAddr = routers[buyDexKey] || routers[buyDex.toLowerCase()];
    const sellRouterAddr = routers[sellDexKey] || routers[sellDex.toLowerCase()];

    if (!buyRouterAddr || !sellRouterAddr) {
      console.error(`Router not found for: ${buyDex} or ${sellDex}`);
      return res.status(400).json({ error: `Invalid DEX specified: ${buyDex} or ${sellDex}` });
    }

    // Map pairs to token addresses
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
      "SHIB/BNB": ["0x2859e4544C4bB03966803b044A93563Bd2D0DD4D", WBNB],
      "DOGE/BNB": ["0xba2ae424d960c26247dd6c32edc70b295c744c43", WBNB],
      "MATIC/BNB": ["0xcc42724c6683b7e57334c4e856f4c9965ed682bd", WBNB],
      "AVAX/BNB": ["0x1ce0c2827e2ef14d5c4f29a091d735a204794041", WBNB]
    };

    const [tokenA, tokenB] = tokenPairs[pair] || tokenPairs["WBNB/BUSD"];

    // Fetch decimals for both tokens
    let decimalsA = 18;
    let decimalsB = 18;
    try {
      const contractA = new ethers.Contract(tokenA, ["function decimals() view returns (uint8)"], provider);
      const contractB = new ethers.Contract(tokenB, ["function decimals() view returns (uint8)"], provider);
      const [dA, dB] = await Promise.all([
        contractA.decimals().catch(() => 18),
        contractB.decimals().catch(() => 18)
      ]);
      decimalsA = Number(dA);
      decimalsB = Number(dB);
    } catch (e) {
      console.log("Could not fetch decimals, defaulting to 18...");
    }

    // Determine the correct direction based on effective prices after fees
    let borrowToken = tokenA;
    let outToken = tokenB;
    let borrowDecimals = decimalsA;
    let outDecimals = decimalsB;
    
    // Use 1 unit of tokenA for effective price comparison
    const checkAmount = ethers.parseUnits("1", decimalsA);

    try {
      const readProvider = multicallProvider || provider;
      const buyContract = new ethers.Contract(buyRouterAddr, ["function getAmountsOut(uint256, address[]) view returns (uint256[])"], readProvider);
      const sellContract = new ethers.Contract(sellRouterAddr, ["function getAmountsOut(uint256, address[]) view returns (uint256[])"], readProvider);
      
      // Effective Price After Fees (Round Trip for 1 unit)
      // Path 1: Buy on BuyDex, Sell on SellDex
      const buyOnBuySellOnSell = await effectivePriceAfterFees(checkAmount, [tokenA, tokenB], buyContract)
        .then(out => effectivePriceAfterFees(out, [tokenB, tokenA], sellContract));

      // Path 2: Buy on SellDex, Sell on BuyDex
      const buyOnSellSellOnBuy = await effectivePriceAfterFees(checkAmount, [tokenA, tokenB], sellContract)
        .then(out => effectivePriceAfterFees(out, [tokenB, tokenA], buyContract));
      
      if (buyOnBuySellOnSell > 0n || buyOnSellSellOnBuy > 0n) {
        console.log(`Effective Price Check (Round Trip for 1 unit):
        - Buy ${buyDex} -> Sell ${sellDex}: ${ethers.formatUnits(buyOnBuySellOnSell, decimalsA)} ${pair.split('/')[0]}
        - Buy ${sellDex} -> Sell ${buyDex}: ${ethers.formatUnits(buyOnSellSellOnBuy, decimalsA)} ${pair.split('/')[0]}`);

        if (buyOnBuySellOnSell > buyOnSellSellOnBuy) {
          borrowToken = tokenA;
          outToken = tokenB;
          borrowDecimals = decimalsA;
          outDecimals = decimalsB;
        } else {
          // If the other direction is better, we should probably use that
          // but for now we stick to the user's chosen DEXes and just ensure token order
          borrowToken = tokenA;
          outToken = tokenB;
          borrowDecimals = decimalsA;
          outDecimals = decimalsB;
        }
      }
    } catch (e) {
      console.error("Effective price check failed:", e);
    }

    let loanAmt = useFlashLoan ? ethers.parseUnits((loanAmount || "0").toString(), borrowDecimals) : 0n;
    const tradeAmt = ethers.parseUnits((amount || "0").toString(), borrowDecimals);
    let buyAmountIn = useFlashLoan ? loanAmt : tradeAmt;
    let isAdjusted = false;
    let originalAmount = ethers.formatUnits(buyAmountIn, borrowDecimals);

    console.log(`Execution Details:
    - Borrow Token: ${borrowToken}
    - Out Token: ${outToken}
    - Buy Router: ${buyRouterAddr} (${buyDex})
    - Sell Router: ${sellRouterAddr} (${sellDex})
    - Loan Amount: ${loanAmount}
    - Min Profit Bps: ${minProfitBps}`);

    if (!buyRouterAddr || !sellRouterAddr) {
      return res.status(400).json({ error: "Invalid DEX selection" });
    }

    const gasBuffer = ethers.parseEther("0.007");

    const balance = await provider.getBalance(wallet.address);

    if (balance < gasBuffer) {
      return res.status(400).json({ 
        error: `Insufficient BNB for gas. You have ${ethers.formatEther(balance)} BNB but need at least ${ethers.formatEther(gasBuffer)} BNB for transaction fees.` 
      });
    }

    // If not using flash loan, check if contract has enough tokens
    if (!useFlashLoan) {
      try {
        const tokenContract = new ethers.Contract(borrowToken, ["function balanceOf(address) view returns (uint256)"], provider);
        const contractTokenBalance = await tokenContract.balanceOf(contractAddress);
        if (contractTokenBalance < buyAmountIn) {
          return res.status(400).json({ 
            error: `Contract ${contractAddress} has insufficient balance of ${borrowToken}. It has ${ethers.formatUnits(contractTokenBalance, borrowDecimals)} but needs ${ethers.formatUnits(buyAmountIn, borrowDecimals)} for this trade. Please send tokens to the contract or use a flash loan.` 
          });
        }
      } catch (e) {
        console.log("Could not verify contract token balance, proceeding...");
      }
    }

    // Get the pair address
    const pairAddress = await factoryContract.getPair(borrowToken, outToken);
    if (pairAddress === ethers.ZeroAddress) {
      return res.status(400).json({ error: `No pair found for ${borrowToken} and ${outToken} on ${loanProvider}` });
    }

    // Check pair liquidity
    try {
      const pairContract = new ethers.Contract(pairAddress, [
        "function getReserves() view returns (uint112, uint112, uint32)",
        "function token0() view returns (address)"
      ], provider);
      const [reserve0, reserve1] = await pairContract.getReserves();
      const token0 = await pairContract.token0();
      
      const borrowReserve = token0.toLowerCase() === borrowToken.toLowerCase() ? reserve0 : reserve1;
      
      if (borrowReserve < buyAmountIn) {
        return res.status(400).json({ 
          error: `Insufficient liquidity on ${loanProvider}. Pair has ${ethers.formatUnits(borrowReserve, borrowDecimals)} but you are trying to borrow ${ethers.formatUnits(buyAmountIn, borrowDecimals)}.` 
        });
      }
    } catch (e) {
      console.log("Could not verify pair liquidity, proceeding...");
    }

    // Theoretical Profit Check
    let currentProfitBps = 0n;
    try {
      const readProvider = multicallProvider || provider;
      const buyRouter = new ethers.Contract(buyRouterAddr, ROUTER_ABI, readProvider);
      const sellRouter = new ethers.Contract(sellRouterAddr, ROUTER_ABI, readProvider);
      
      const buyAmounts = await buyRouter.getAmountsOut(buyAmountIn, [borrowToken, outToken]);
      let amountOutFromBuy = buyAmounts[buyAmounts.length - 1];
      
      const sellAmounts = await sellRouter.getAmountsOut(amountOutFromBuy, [outToken, borrowToken]);
      let finalAmount = sellAmounts[sellAmounts.length - 1];
      
      let fee = (buyAmountIn * 3n) / 997n; // Approx 0.3% fee for flash loan
      let amountToRepay = buyAmountIn + fee;
      
      let isProfitable = finalAmount > amountToRepay;
      let netChange = finalAmount - amountToRepay;
      currentProfitBps = buyAmountIn > 0n ? (netChange * 10000n) / buyAmountIn : 0n;
      
      console.log(`Profit Calculation:
      - Buy In: ${ethers.formatUnits(buyAmountIn, borrowDecimals)}
      - Out from Buy: ${ethers.formatUnits(amountOutFromBuy, outDecimals)}
      - Final Back: ${ethers.formatUnits(finalAmount, borrowDecimals)}
      - Repay Needed: ${ethers.formatUnits(amountToRepay, borrowDecimals)}
      - Net Change: ${ethers.formatUnits(netChange, borrowDecimals)}`);
      
      const spotPriceA = ethers.parseUnits("1", borrowDecimals);
      const spotAmountsB = await buyRouter.getAmountsOut(spotPriceA, [borrowToken, outToken]);
      const spotAmountsFinal = await sellRouter.getAmountsOut(spotAmountsB[spotAmountsB.length - 1], [outToken, borrowToken]);
      const spotFinal = spotAmountsFinal[spotAmountsFinal.length - 1];
      const spotRepay = spotPriceA + (spotPriceA * 3n) / 997n;
      const maxPossibleBps = ((spotFinal - spotRepay) * 10000n) / spotPriceA;

      console.log(`📊 Market Analysis:
      - Spot Final: ${ethers.formatUnits(spotFinal, borrowDecimals)}
      - Spot Repay: ${ethers.formatUnits(spotRepay, borrowDecimals)}
      - Max Theoretical Spread: ${maxPossibleBps} bps (after fees)
      - Current Amount Spread: ${currentProfitBps} bps (after slippage)`);

      // CRITICAL: Early exit if theoretical spread is too low
      if (maxPossibleBps < 30n) {
        console.log(`🛑 Max Theoretical Spread (${maxPossibleBps} bps) is below 30 bps. Aborting to save CPU cycles.`);
        return res.status(400).json({ 
          error: `Trade is not profitable enough even theoretically. Theoretical profit: ${maxPossibleBps} bps, required: 30 bps.` 
        });
      }

      if (maxPossibleBps <= BigInt(minProfitBps)) {
        console.log(`🛑 Max Theoretical Spread (${maxPossibleBps} bps) is below required ${minProfitBps} bps. Aborting.`);
        return res.status(400).json({ 
          error: `Trade is not profitable enough even theoretically. Theoretical profit: ${maxPossibleBps} bps, required: ${minProfitBps} bps.` 
        });
      }

      if (currentProfitBps < BigInt(minProfitBps)) {
        console.log(`⚠️ Trade not profitable with ${ethers.formatUnits(buyAmountIn, borrowDecimals)}. Searching for a better amount...`);
        
        // Try to find a profitable amount if the current one is too large
        try {
          let low = ethers.parseUnits("0.1", borrowDecimals);
          let high = buyAmountIn;
          let bestAmount = 0n;
          
          // Binary search for 10 iterations to find a better amount
          for (let i = 0; i < 10; i++) {
            let mid = (low + high) / 2n;
            if (mid < ethers.parseUnits("0.1", borrowDecimals)) break;
            
            const bAmounts = await buyRouter.getAmountsOut(mid, [borrowToken, outToken]);
            const sAmounts = await sellRouter.getAmountsOut(bAmounts[bAmounts.length - 1], [outToken, borrowToken]);
            const fAmount = sAmounts[sAmounts.length - 1];
            const rNeeded = mid + (mid * 3n) / 997n;
            const pBps = (fAmount - rNeeded) * 10000n / mid;
            
            if (pBps >= BigInt(minProfitBps)) {
              bestAmount = mid;
              low = mid;
            } else {
              high = mid;
            }
          }
          
          if (bestAmount > 0n) {
            console.log(`✅ Found profitable amount: ${ethers.formatUnits(bestAmount, borrowDecimals)}. Adjusting trade...`);
            buyAmountIn = bestAmount;
            if (useFlashLoan) loanAmt = bestAmount;
            isAdjusted = true;
            
            // Re-calculate values for the adjusted amount
            const bAmounts = await buyRouter.getAmountsOut(buyAmountIn, [borrowToken, outToken]);
            amountOutFromBuy = bAmounts[bAmounts.length - 1];
            const sAmounts = await sellRouter.getAmountsOut(amountOutFromBuy, [outToken, borrowToken]);
            finalAmount = sAmounts[sAmounts.length - 1];
            fee = (buyAmountIn * 3n) / 997n;
            amountToRepay = buyAmountIn + fee;
            netChange = finalAmount - amountToRepay;
            currentProfitBps = (netChange * 10000n) / buyAmountIn;
          } else {
            const errorMsg = `Trade is not profitable enough even with smaller amounts. Theoretical profit: ${currentProfitBps} bps, required: ${minProfitBps} bps. (Final: ${ethers.formatUnits(finalAmount, borrowDecimals)}, Need: ${ethers.formatUnits(amountToRepay, borrowDecimals)})`;
            return res.status(400).json({ error: errorMsg });
          }
        } catch (e) {
          console.error("Auto-adjustment failed:", e);
          return res.status(400).json({ error: "Could not find a profitable trade amount." });
        }
      }

      // Calculate slippage impact for logging
      const spotPrice = ethers.parseUnits("1", borrowDecimals);
      
      // Buy side slippage
      const spotAmountsBuy = await buyRouter.getAmountsOut(spotPrice, [borrowToken, outToken]);
      const spotOutBuy = BigInt(spotAmountsBuy[spotAmountsBuy.length - 1]);
      const expectedOutNoSlippageBuy = (buyAmountIn * spotOutBuy) / spotPrice;
      const slippageBuy = expectedOutNoSlippageBuy > 0n ? 
        Number((expectedOutNoSlippageBuy - BigInt(amountOutFromBuy)) * 10000n / expectedOutNoSlippageBuy) / 100 : 0;

      // Sell side slippage
      const spotPriceOut = ethers.parseUnits("1", outDecimals);
      const spotAmountsSell = await sellRouter.getAmountsOut(spotPriceOut, [outToken, borrowToken]);
      const spotOutSell = BigInt(spotAmountsSell[spotAmountsSell.length - 1]);
      const expectedOutNoSlippageSell = (BigInt(amountOutFromBuy) * spotOutSell) / spotPriceOut;
      const slippageSell = expectedOutNoSlippageSell > 0n ? 
        Number((expectedOutNoSlippageSell - BigInt(finalAmount)) * 10000n / expectedOutNoSlippageSell) / 100 : 0;

      const effectiveBuyPrice = amountOutFromBuy > 0n ? Number(buyAmountIn * BigInt("1000000000000000000") / amountOutFromBuy) / 1e18 : 0;
      const effectiveSellPrice = amountOutFromBuy > 0n ? Number(finalAmount * BigInt("1000000000000000000") / amountOutFromBuy) / 1e18 : 0;

      console.log(`Profit Check Breakdown:
      - Amount In: ${ethers.formatUnits(buyAmountIn, borrowDecimals)} ${borrowToken}
      - Buy DEX (${buyDex}): 
          * Eff. Price: ${effectiveBuyPrice.toFixed(6)}
          * Slippage: ${slippageBuy.toFixed(2)}%
      - Sell DEX (${sellDex}): 
          * Eff. Price: ${effectiveSellPrice.toFixed(6)}
          * Slippage: ${slippageSell.toFixed(2)}%
      - Repayment Needed: ${ethers.formatUnits(amountToRepay, borrowDecimals)} ${borrowToken}
      - Net Profit: ${ethers.formatUnits(netChange, borrowDecimals)} ${borrowToken} (${currentProfitBps} bps)`);
      
      if (slippageBuy > 3 || slippageSell > 3) {
        console.log(`⚠️ WARNING: Significant slippage detected (Buy: ${slippageBuy.toFixed(2)}%, Sell: ${slippageSell.toFixed(2)}%).`);
      }
      
      console.log(`Theoretical Profit: ${ethers.formatUnits(netChange, borrowDecimals)} ${borrowToken} (${currentProfitBps} bps)`);
    } catch (e: any) {
      console.log("Theoretical profit check failed:", e.message);
      if (e.message && e.message.includes("INSUFFICIENT_OUTPUT_AMOUNT")) {
        return res.status(400).json({ error: "Theoretical profit check failed: Insufficient output amount on one of the DEXs. The trade is likely not profitable." });
      }
      if (e.message && e.message.includes("INSUFFICIENT_LIQUIDITY")) {
        return res.status(400).json({ error: "Theoretical profit check failed: Insufficient liquidity on one of the DEXs." });
      }
    }

    const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes
    const nonce = ethers.hexlify(ethers.randomBytes(32));

    // Encode buyCalldata
    const buyCalldata = v2RouterInterface.encodeFunctionData("swapExactTokensForTokens", [
      buyAmountIn,
      0, // amountOutMin
      [borrowToken, outToken],
      contractAddress, // recipient is the contract
      deadline
    ]);

    const params = {
      pair: pairAddress,
      tokenBorrow: borrowToken,
      tokenOut: outToken,
      loanAmount: loanAmt,
      buyDex: buyRouterAddr,
      sellDex: sellRouterAddr,
      minProfitBps: minProfitBps,
      buyCalldata: buyCalldata,
      sellDexVersion: 0, // 0 = V2
      sellFee: 0,
      deadline: deadline,
      nonce: nonce,
      sellMinOut: 0,
      quoterAddress: ethers.ZeroAddress
    };

    // Try a static call first
    try {
      // Check ownership
      try {
        const owner = await contract.owner();
        if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
          return res.status(400).json({ error: `Wallet ${wallet.address} is not the owner of contract ${contractAddress}. Owner is ${owner}.` });
        }
      } catch (e) {
        console.log("Could not verify ownership, proceeding...");
      }

      await contract.executeArbitrage.staticCall(params);
    } catch (staticError: any) {
      console.error("Static call failed:", staticError);
      let reason = "Transaction would revert. Possible causes: Not profitable, insufficient liquidity, or contract ownership issue.";
      if (staticError.reason) reason = staticError.reason;
      else if (staticError.data || (staticError.error && staticError.error.data)) {
        const revertData = staticError.data || staticError.error.data;
        if (revertData && revertData.length > 10) {
          try {
            // Standard Error(string) selector is 0x08c379a0
            if (revertData.startsWith("0x08c379a0")) {
              // Decode Error(string)
              const abiCoder = ethers.AbiCoder.defaultAbiCoder();
              const decoded = abiCoder.decode(["string"], "0x" + revertData.slice(10));
              reason = `Execution reverted: ${decoded[0]}`;
            } else if (revertData.startsWith("0x4e487b71")) {
              // Decode Panic(uint256)
              const abiCoder = ethers.AbiCoder.defaultAbiCoder();
              const decoded = abiCoder.decode(["uint256"], "0x" + revertData.slice(10));
              reason = `Execution reverted with Panic code: ${decoded[0]}`;
            } else {
              reason = "Execution reverted: The contract rejected the trade. This often means the profit was too low, slippage was too high, or the flash loan repayment failed.";
            }
          } catch (e) {
            reason = "Execution reverted: The arbitrage opportunity may have expired or slippage was too high.";
          }
        } else {
          reason = "Execution reverted: The contract rejected the trade (require failed). Possible causes: Not profitable, insufficient liquidity, or contract ownership issue.";
        }
      }
      return res.status(400).json({ error: reason });
    }

    // Dynamic Gas Price based on profit
    const feeData = await provider.getFeeData();
    const baseGasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
    let gasPrice = baseGasPrice;
    
    // Use currentProfitBps for dynamic gas
    if (currentProfitBps > 100n) { // > 1% profit
      gasPrice = (baseGasPrice * 150n) / 100n; // 50% more
    } else if (currentProfitBps > 50n) { // > 0.5% profit
      gasPrice = (baseGasPrice * 120n) / 100n; // 20% more
    } else {
      gasPrice = (baseGasPrice * 110n) / 100n; // 10% boost for speed
    }

    const tx = await contract.executeArbitrage(params, { 
      gasLimit: 1000000,
      gasPrice: gasPrice
    });

    // If private RPC is configured, also send there for faster inclusion
    if (privateRpcProvider) {
      try {
        const signedTx = await wallet.signTransaction({
          to: contractAddress,
          data: contract.interface.encodeFunctionData("executeArbitrage", [params]),
          gasLimit: 1000000,
          nonce: await wallet.getNonce()
        });
        await privateRpcProvider.broadcastTransaction(signedTx);
        console.log("Transaction broadcasted to Private RPC (BloXroute/Flashbots)");
      } catch (e) {
        console.log("Private RPC broadcast failed:", e);
      }
    }

    const receipt = await tx.wait();
    res.json({ 
      success: true, 
      txHash: receipt.hash,
      adjusted: isAdjusted,
      originalAmount: originalAmount,
      executedAmount: ethers.formatUnits(buyAmountIn, borrowDecimals)
    });
  } catch (error: any) {
    console.error("Execution error:", error);
    res.status(500).json({ error: error.message || "Transaction failed" });
  }
});

// JSON 404 handler for API routes
app.use("/api/*", (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.originalUrl}` });
});

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
    console.log(`BSC Arbitrage Engine running on http://localhost:${PORT}`);
    
    // Initial RPC check
    try {
      await provider.getNetwork();
      console.log("Initial RPC connection successful");
    } catch (err) {
      console.error("Initial RPC connection failed, switching...");
      await switchRpc();
    }
  });
}

startServer();
