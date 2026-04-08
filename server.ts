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
  "https://bsc-dataseed1.defibit.io/",
  "https://bsc-dataseed1.ninicoin.io/",
  "https://bsc-rpc.publicnode.com"
];

const WS_NODES = [
  "wss://bsc-rpc.publicnode.com",
  "wss://bsc.publicnode.com",
  "wss://bsc-dataseed.binance.org"
];

// BloXroute & Flashbots Endpoints (BSC)
const BLOXR_BSC_WS = "wss://bsc.bloxroute.com/ws";
let BLOXR_AUTH_HEADER = process.env.BLOXR_AUTH_HEADER || ""; // User should provide this in settings

let currentWsIndex = 0;
let currentRpcIndex = 0;
let provider = new ethers.JsonRpcProvider(RPC_NODES[currentRpcIndex]);
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
              console.log(`🔍 Path detected: ${path[0]} -> ${path[path.length-1]}`);
              // We could trigger a targeted price check here
            }
          } catch (e) {}
        }
        
        // Trigger immediate price check for the involved tokens
        setTimeout(updatePrices, 50); 
      }
    }
  } catch (e) {}
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
}

function connectToWs(url: string, sourceName: string, headers: any = {}) {
  try {
    const ws = new WebSocket(url, {
      headers: headers,
      handshakeTimeout: 10000
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

setupMempoolListeners();

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
    const newProvider = new ethers.JsonRpcProvider(RPC_NODES[currentRpcIndex]);
    // Try to get network to verify it's working
    await newProvider.getNetwork();
    
    provider = newProvider;
    // Re-initialize contracts with new provider
    pancakeContract = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, provider);
    biswapContract = new ethers.Contract(BISWAP_ROUTER, ROUTER_ABI, provider);
    apeswapContract = new ethers.Contract(APESWAP_ROUTER, ROUTER_ABI, provider);
    bakeryContract = new ethers.Contract(BAKERY_ROUTER, ROUTER_ABI, provider);
    console.log("Successfully switched to new RPC");
    switchRetries = 0; // Reset on success
  } catch (err) {
    console.error(`Failed to connect to RPC ${RPC_NODES[currentRpcIndex]}, trying next...`);
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

  const paths = [
    [WBNB, BUSD, USDT, WBNB],
    [WBNB, CAKE, BUSD, WBNB],
    [WBNB, ETH, BUSD, WBNB],
    [WBNB, BTCB, BUSD, WBNB]
  ];

  for (const [name, contract] of Object.entries(routers)) {
    for (const path of paths) {
      try {
        const amountIn = ethers.parseEther("1");
        const amounts = await contract.getAmountsOut(amountIn, path);
        const amountOut = amounts[amounts.length - 1];
        
        const profit = amountOut - amountIn;
        const profitBps = (profit * 10000n) / amountIn;

        if (profitBps > 15n) { // 0.15% profit threshold for triangle (after fees)
          console.log(`💎 Triangular Opportunity on ${name}: ${profitBps} bps | Path: ${path.join(" -> ")}`);
          // In a real scenario, we would trigger execution here if automated
        }
      } catch (e) {}
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
  
  const tokenPairs: Record<string, {path: [string, string], decimals: [number, number]}> = {
    "WBNB/BUSD": { path: [WBNB, BUSD], decimals: [18, 18] },
    "BNB/USDT": { path: [WBNB, USDT], decimals: [18, 18] },
    "ETH/BNB": { path: [ETH, WBNB], decimals: [18, 18] },
    "CAKE/BNB": { path: [CAKE, WBNB], decimals: [18, 18] },
    "BTCB/BNB": { path: [BTCB, WBNB], decimals: [18, 18] }, // BTCB is 18 decimals on BSC
    "ADA/BNB": { path: [ADA, WBNB], decimals: [18, 18] },
    "DOT/BNB": { path: [DOT, WBNB], decimals: [18, 18] },
    "XRP/BNB": { path: [XRP, WBNB], decimals: [18, 18] },
    "LINK/BNB": { path: [LINK, WBNB], decimals: [18, 18] },
    "FIL/BNB": { path: [FIL, WBNB], decimals: [18, 18] },
    "LTC/BNB": { path: [LTC, WBNB], decimals: [18, 18] },
    "SHIB/BNB": { path: ["0x2859e4544C4bB03966803b044A93563Bd2D0DD4D", WBNB], decimals: [18, 18] },
    "DOGE/BNB": { path: ["0xba2ae424d960c26247dd6c32edc70b295c744c43", WBNB], decimals: [8, 18] },
    "MATIC/BNB": { path: ["0xcc42724c6683b7e57334c4e856f4c9965ed682bd", WBNB], decimals: [18, 18] },
    "AVAX/BNB": { path: ["0x1ce0c2827e2ef14d5c4f29a091d735a204794041", WBNB], decimals: [18, 18] }
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
      const pairPromises = Object.entries(tokenPairs).map(async ([pairName, {path: [tA, tB], decimals: [dA, dB]}]) => {
        results[pairName] = {};
        const amountInLocal = ethers.parseUnits("1", dA);
        const dexPromises = Object.entries(routers).map(async ([dexName, routerAddr]) => {
          try {
            const contract = new ethers.Contract(routerAddr, ROUTER_ABI, multicallProvider);
            const amounts = await contract.getAmountsOut(amountInLocal, [tA, tB]);
            results[pairName][dexName] = ethers.formatUnits(amounts[amounts.length - 1], dB);
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
      const pairPromises = Object.entries(tokenPairs).map(async ([pairName, {path: [tA, tB], decimals: [dA, dB]}]) => {
        results[pairName] = {};
        const amountInLocal = ethers.parseUnits("1", dA);
        const dexPromises = Object.entries(routers).map(async ([dexName, routerAddr]) => {
          try {
            const contract = new ethers.Contract(routerAddr, ROUTER_ABI, provider);
            const amounts = await contract.getAmountsOut(amountInLocal, [tA, tB]);
            results[pairName][dexName] = ethers.formatUnits(amounts[amounts.length - 1], dB);
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
  let { privateKey, contractAddress, buyDex, sellDex, amount, useFlashLoan: rawUseFlashLoan, loanAmount, loanProvider, pair, minProfit: rawMinProfit } = req.body;
  const useFlashLoan = rawUseFlashLoan === true || rawUseFlashLoan === "true";
  const minProfitPercent = parseFloat(rawMinProfit || "0.35");
  const minProfitBps = Math.floor(minProfitPercent * 100);

  console.log("--- New Execution Request ---");
  console.log(`Trade: ${buyDex} -> ${sellDex} | Pair: ${pair} | Amount: ${amount} | Flash: ${useFlashLoan}`);
  console.log("-----------------------------");
  if (!privateKey || !contractAddress) {
    return res.status(400).json({ error: "Missing private key or contract address" });
  }

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
    
    let buyRouterAddr = routers[buyDexKey] || routers[buyDex.toLowerCase()];
    let sellRouterAddr = routers[sellDexKey] || routers[sellDex.toLowerCase()];
    let currentBuyDex = buyDex;
    let currentSellDex = sellDex;

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
        - Buy ${currentBuyDex} -> Sell ${currentSellDex}: ${ethers.formatUnits(buyOnBuySellOnSell, decimalsA)} ${pair.split('/')[0]}
        - Buy ${currentSellDex} -> Sell ${currentBuyDex}: ${ethers.formatUnits(buyOnSellSellOnBuy, decimalsA)} ${pair.split('/')[0]}`);

        // If the other direction is better, we should swap the DEXes and tokens
        if (buyOnSellSellOnBuy > buyOnBuySellOnSell) {
          console.log(`🔄 Reversing direction: Buy on ${currentSellDex}, Sell on ${currentBuyDex} is more profitable.`);
          // Swap routers
          const tempRouter = buyRouterAddr;
          buyRouterAddr = sellRouterAddr;
          sellRouterAddr = tempRouter;
          
          const tempDex = currentBuyDex;
          currentBuyDex = currentSellDex;
          currentSellDex = tempDex;
        }
        
        borrowToken = tokenA;
        outToken = tokenB;
        borrowDecimals = decimalsA;
        outDecimals = decimalsB;
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
    - Buy Router: ${buyRouterAddr} (${currentBuyDex})
    - Sell Router: ${sellRouterAddr} (${currentSellDex})
    - Loan Amount: ${loanAmount}
    - Min Profit Bps: ${minProfitBps}`);

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
    try {
      const readProvider = multicallProvider || provider;
      const buyRouter = new ethers.Contract(buyRouterAddr, ROUTER_ABI, readProvider);
      const sellRouter = new ethers.Contract(sellRouterAddr, ROUTER_ABI, readProvider);
      
      const buyAmounts = await buyRouter.getAmountsOut(buyAmountIn, [borrowToken, outToken]);
      let amountOutFromBuy = buyAmounts[buyAmounts.length - 1];
      
      const sellAmounts = await sellRouter.getAmountsOut(amountOutFromBuy, [outToken, borrowToken]);
      let finalAmount = sellAmounts[sellAmounts.length - 1];
      
      // Match contract fee calculation: repay = ((loanAmount * 10000) / 9975) + 10
      let amountToRepay = ((buyAmountIn * 10000n) / 9975n) + 10n;
      let fee = amountToRepay - buyAmountIn;
      
      let isProfitable = finalAmount > amountToRepay;
      let netChange = finalAmount - amountToRepay;
      let profitBps = buyAmountIn > 0n ? (netChange * 10000n) / buyAmountIn : 0n;
      
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
      const spotRepay = ((spotPriceA * 10000n) / 9975n) + 10n;
      const maxPossibleBps = ((spotFinal - spotRepay) * 10000n) / spotPriceA;

      console.log(`📊 Market Analysis:
      - Spot Final: ${ethers.formatUnits(spotFinal, borrowDecimals)}
      - Spot Repay: ${ethers.formatUnits(spotRepay, borrowDecimals)}
      - Max Theoretical Spread: ${maxPossibleBps} bps (after fees)
      - Current Amount Spread: ${profitBps} bps (after slippage)`);

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

      if (profitBps < BigInt(minProfitBps)) {
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
            const rNeeded = ((mid * 10000n) / 9975n) + 10n;
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
            amountToRepay = ((buyAmountIn * 10000n) / 9975n) + 10n;
            netChange = finalAmount - amountToRepay;
            profitBps = (netChange * 10000n) / buyAmountIn;
          } else {
            const errorMsg = `Trade is not profitable enough even with smaller amounts. Theoretical profit: ${profitBps} bps, required: ${minProfitBps} bps. (Final: ${ethers.formatUnits(finalAmount, borrowDecimals)}, Need: ${ethers.formatUnits(amountToRepay, borrowDecimals)})`;
            return res.status(400).json({ error: errorMsg });
          }
        } catch (e) {
          return res.status(400).json({ error: "Profit search failed" });
        }
      }
    } catch (e: any) {
      console.error("Profit check failed:", e.message);
      return res.status(400).json({ error: `Profit calculation failed: ${e.message}` });
    }

    // Final execution logic...
    const buyPath = [borrowToken, outToken];
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const nonce = ethers.hexlify(ethers.randomBytes(32));

    const params = {
      pair: pairAddress,
      tokenBorrow: borrowToken,
      tokenOut: outToken,
      loanAmount: buyAmountIn,
      buyDex: buyRouterAddr,
      sellDex: sellRouterAddr,
      minProfitBps: minProfitBps,
      buyCalldata: v2RouterInterface.encodeFunctionData("swapExactTokensForTokens", [
        buyAmountIn,
        0, // minOut calculated in contract
        buyPath,
        contractAddress,
        deadline
      ]),
      sellDexVersion: 0, // V2
      sellFee: 0,
      deadline: deadline,
      nonce: nonce,
      sellMinOut: 0,
      quoterAddress: ethers.ZeroAddress
    };

    console.log("🚀 Sending transaction to contract...");
    const tx = await contract.executeArbitrage(params, {
      gasLimit: 1000000
    });

    console.log(`✅ Transaction sent: ${tx.hash}`);
    res.json({ 
      success: true, 
      txHash: tx.hash,
      adjusted: isAdjusted,
      originalAmount: originalAmount,
      executedAmount: ethers.formatUnits(buyAmountIn, borrowDecimals)
    });

  } catch (e: any) {
    console.error("Execution error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/settings/save", (req, res) => {
  // Client handles localStorage, but we can log it
  console.log("Settings saved by client");
  res.json({ status: "ok" });
});

// Serve Frontend
app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`BSC Arbitrage Engine running on http://localhost:${PORT}`);
});
