import express from "express";
import path from "path";
import { ethers } from "ethers";
import MevShareClient from "@flashbots/mev-share-client";
import ethersMulticallProvider from "ethers-multicall-provider";
const { MulticallWrapper } = ethersMulticallProvider;
import WebSocket from "ws";

console.log("SERVER STARTING - MEV ENGINE v2.0 ACTIVATED");

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
  "https://bsc-dataseed1.defibit.io/",
  "https://bsc-dataseed1.ninicoin.io/",
  "https://1rpc.io/bnb"
];

const WS_NODES = [
  "wss://bsc-rpc.publicnode.com",
  "wss://bsc-ws-node.nariox.org"
];

// BloXroute & Flashbots Endpoints (BSC)
const BLOXR_BSC_WS = "wss://bsc.bloxroute.com/ws";
let BLOXR_AUTH_HEADER = process.env.BLOXR_AUTH_HEADER || "";

let currentWsIndex = 0;
let currentRpcIndex = 0;

// Initialize provider with static network to avoid "failed to detect network" errors
const bscNetwork = ethers.Network.from(56);

let provider = new ethers.JsonRpcProvider(RPC_NODES[currentRpcIndex], bscNetwork, { 
  staticNetwork: true,
  batchMaxCount: 1 
});

// Initial connection check
async function verifyInitialConnection() {
  try {
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

// ═══════════════════════════════════════════════════════════════════════════
//  DEX ROUTER ABIs
// ═══════════════════════════════════════════════════════════════════════════

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
];

const v2RouterInterface = new ethers.Interface([
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory)"
]);

const FACTORY_ABI = [
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
];

// ═══════════════════════════════════════════════════════════════════════════
//  MULTI-PATH FLASH ARBITRAGE v2.0 — CONTRACT ABI
// ═══════════════════════════════════════════════════════════════════════════

const MULTIPATH_ARB_ABI = [
  // executeArbitrage
  `function executeArbitrage(
    tuple(
      address flashPair,
      address loanToken,
      uint256 loanAmount,
      tuple(address dexRouter, address tokenIn, address tokenOut, uint256 amountOutMin, uint24 fee, uint8 dexVersion, address quoter)[] buyHops,
      tuple(address dexRouter, address tokenIn, address tokenOut, uint256 amountOutMin, uint24 fee, uint8 dexVersion, address quoter)[] sellHops,
      uint256 minProfitBps,
      uint256 deadline,
      bytes32 nonce
    ) p
  ) external`,
  // View functions
  "function owner() view returns (address)",
  "function PANCAKE_FACTORY() view returns (address)",
  "function usedNonces(bytes32) view returns (bool)",
  // Events
  "event ArbStarted(address indexed loanToken, uint256 loanAmount, uint256 minProfitBps, uint256 deadline, uint256 buySteps, uint256 sellSteps, bytes32 nonce)",
  "event ArbFinished(uint256 timestamp)",
  "event FlashLoanReceived(address indexed pair, address indexed token, uint256 amount, uint256 availableLiquidity)",
  "event SwapExecuted(uint8 indexed leg, uint256 indexed stepIndex, address dexRouter, uint8 dexVersion, address tokenIn, address tokenOut, uint256 amountIn, uint256 estimatedOut, uint256 actualOut, int256 slippageWei)",
  "event Approved(address indexed token, address indexed spender, uint256 amount)",
  "event Settlement(address indexed token, uint256 loanAmount, uint256 fee, uint256 totalRepay, uint256 finalBalance, uint256 netProfit, uint256 profitBps)",
  "event ProfitSent(address indexed token, uint256 amount, address indexed recipient)",
  "event ExecutionFailed(string reason, string step)",
  "event Debug(string message, uint256 value)",
  "event DebugAddr(string message, address value)",
  "event DebugBalance(address indexed token, uint256 balance, string stage)",
  "event DebugStep(string stepName, uint256 timestamp)"
];

// ═══════════════════════════════════════════════════════════════════════════
//  ADDRESSES
// ═══════════════════════════════════════════════════════════════════════════

// DEX Routers
const PANCAKE_ROUTER     = ethers.getAddress("0x10ed43c718714eb63d5aa57b78b54704e256024e");
const PANCAKE_ROUTER_V3  = ethers.getAddress("0x13f4EA83D0bd40E75C8222255bc855a974568Dd4");
const BISWAP_ROUTER      = ethers.getAddress("0x3a6d8ca21d1cf76f653a67577fa0d27453350dce");
const APESWAP_ROUTER     = ethers.getAddress("0xcf0febd3f17cef5b47b0cd257acf6025c5bff3b7");
const BAKERY_ROUTER      = ethers.getAddress("0xcde540d7eafe93ac5fe6233bee57e1270d3e330f");
const BABYSWAP_ROUTER    = ethers.getAddress("0x325e343f1de2356f596938ac336224c33554444b");
const MDEX_ROUTER        = ethers.getAddress("0x7dae51bd3df1541f4846fb9452375937d8357336");
const UNISWAP_V3_ROUTER  = ethers.getAddress("0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2");

// DEX Factories
const PANCAKE_FACTORY  = ethers.getAddress("0xca143ce32fe78f1f7019d7d551a6402fc5350c73");
const BISWAP_FACTORY   = ethers.getAddress("0x858e3312ed3a8762e0101bb5c46a8c1ed44dc160");
const APESWAP_FACTORY  = ethers.getAddress("0x0841bd0b734e4f5853f0dd8d7ea041c241fb0da6");
const BAKERY_FACTORY   = ethers.getAddress("0x01bf708e59d7723694d64c332696db0000000000");
const BABYSWAP_FACTORY = ethers.getAddress("0x85e0e343f1de2356f596938ac336224c3554444b");
const MDEX_FACTORY     = ethers.getAddress("0x3cd1c46068da20007d54dc21199710521547612c");

// V3 Quoters
const PANCAKE_V3_QUOTER = ethers.getAddress("0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997");
const UNISWAP_V3_QUOTER = ethers.getAddress("0x78D78E420Da98ad378D7799bE8f4AF69033EB077");

// Tokens
const WBNB = ethers.getAddress("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c");
const BUSD = ethers.getAddress("0xe9e7cea3dedca5984780bafc599bd69add087d56");
const USDT = ethers.getAddress("0x55d398326f99059ff775485246999027b3197955");
const ETH  = ethers.getAddress("0x2170ed0880ac9a755fd29b2688956bd959f933f8");
const CAKE = ethers.getAddress("0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82");
const BTCB = ethers.getAddress("0x7130d2a12b9bcbae4f2634d864a1ee1ce3ead9c3");
const ADA  = ethers.getAddress("0x3ee2200efb3400fabb9aacf31297cbdd1d435d47");
const DOT  = ethers.getAddress("0x7083609fce4d1d8dc0c979aab8c869ea8c1f7329");
const XRP  = ethers.getAddress("0x1d2f0da169ceb2df7b744837037f081f79794b16");
const LINK = ethers.getAddress("0xf8a06f1317e506864b618301216b45c397b9010d");
const FIL  = ethers.getAddress("0x0d21c53b6e53997751ff24b0375936788096d40f");
const LTC  = ethers.getAddress("0x4338665c00d9755421b2518275675b399046093c");
const SHIB = ethers.getAddress("0x2859e4544C4bB03966803b044A93563Bd2D0DD4D");
const DOGE = ethers.getAddress("0xba2ae424d960c26247dd6c32edc70b295c744c43");
const MATIC = ethers.getAddress("0xcc42724c6683b7e57334c4e856f4c9965ed682bd");
const AVAX = ethers.getAddress("0x1ce0c2827e2ef14d5c4f29a091d735a204794041");
const SOL  = ethers.getAddress("0x570a5d26f7765ecb712c0924e4de545b89fd43df");
const FTM  = ethers.getAddress("0xad29abb318791d579433d831ed122afeaf297ff5");
const ATOM = ethers.getAddress("0x0eb3a705fc54725037cc9e008bdede697f62f335");
const NEAR = ethers.getAddress("0x1fa4a73a3f01f7741a8ef940a023e3acc6f9e720");
const ALGO = ethers.getAddress("0xe79a6d4b9632b8d28641f42205049ce9997a3298");
const VET  = ethers.getAddress("0x6fd7604651d073c84df356d227f758e2a2366bd2");
const SAND = ethers.getAddress("0x3764be110aa3415617d362f306a96146c4e3955d");
const MANA = ethers.getAddress("0x484797e666e0d31f489565b395775464ec33421c");
const USDC = ethers.getAddress("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");

// ═══════════════════════════════════════════════════════════════════════════
//  DEX VERSION CONSTANTS (match Solidity constants)
// ═══════════════════════════════════════════════════════════════════════════
const DEX_V2         = 0;
const DEX_UNI_V3     = 1;
const DEX_PANCAKE_V3 = 2;

// ═══════════════════════════════════════════════════════════════════════════
//  DEX REGISTRY — maps human-readable names to router info
// ═══════════════════════════════════════════════════════════════════════════

interface DexInfo {
  router: string;
  version: number;    // DEX_V2 | DEX_UNI_V3 | DEX_PANCAKE_V3
  fee: number;        // default pool fee (for V3; 0 for V2)
  quoter: string;     // quoter address (for V3; ZeroAddress for V2)
  factory: string;
  name: string;
}

const DEX_REGISTRY: Record<string, DexInfo> = {
  "pancake":      { router: PANCAKE_ROUTER,    version: DEX_V2,         fee: 0,    quoter: ethers.ZeroAddress, factory: PANCAKE_FACTORY,  name: "PancakeSwap V2" },
  "pancakeswap":  { router: PANCAKE_ROUTER,    version: DEX_V2,         fee: 0,    quoter: ethers.ZeroAddress, factory: PANCAKE_FACTORY,  name: "PancakeSwap V2" },
  "pancakev3":    { router: PANCAKE_ROUTER_V3, version: DEX_PANCAKE_V3, fee: 2500, quoter: PANCAKE_V3_QUOTER,  factory: PANCAKE_FACTORY,  name: "PancakeSwap V3" },
  "biswap":       { router: BISWAP_ROUTER,     version: DEX_V2,         fee: 0,    quoter: ethers.ZeroAddress, factory: BISWAP_FACTORY,   name: "BiSwap" },
  "apeswap":      { router: APESWAP_ROUTER,    version: DEX_V2,         fee: 0,    quoter: ethers.ZeroAddress, factory: APESWAP_FACTORY,  name: "ApeSwap" },
  "bakeryswap":   { router: BAKERY_ROUTER,     version: DEX_V2,         fee: 0,    quoter: ethers.ZeroAddress, factory: BAKERY_FACTORY,   name: "BakerySwap" },
  "bakery":       { router: BAKERY_ROUTER,     version: DEX_V2,         fee: 0,    quoter: ethers.ZeroAddress, factory: BAKERY_FACTORY,   name: "BakerySwap" },
  "babyswap":     { router: BABYSWAP_ROUTER,   version: DEX_V2,         fee: 0,    quoter: ethers.ZeroAddress, factory: BABYSWAP_FACTORY, name: "BabySwap" },
  "mdex":         { router: MDEX_ROUTER,       version: DEX_V2,         fee: 0,    quoter: ethers.ZeroAddress, factory: MDEX_FACTORY,     name: "MDEX" },
  "uniswapv3":    { router: UNISWAP_V3_ROUTER, version: DEX_UNI_V3,    fee: 3000, quoter: UNISWAP_V3_QUOTER,  factory: PANCAKE_FACTORY,  name: "Uniswap V3" },
};

// Helper to resolve DEX info from name
function resolveDex(name: string): DexInfo | null {
  const key = name.toLowerCase().replace(/[\s_-]/g, "").replace("swap", "");
  return DEX_REGISTRY[key] || DEX_REGISTRY[name.toLowerCase()] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOKEN REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

const TOKEN_MAP: Record<string, string> = {
  "WBNB": WBNB, "BNB": WBNB, "BUSD": BUSD, "USDT": USDT, "USDC": USDC,
  "ETH": ETH, "CAKE": CAKE, "BTCB": BTCB, "ADA": ADA, "DOT": DOT,
  "XRP": XRP, "LINK": LINK, "FIL": FIL, "LTC": LTC, "SHIB": SHIB,
  "DOGE": DOGE, "MATIC": MATIC, "AVAX": AVAX, "SOL": SOL, "FTM": FTM,
  "ATOM": ATOM, "NEAR": NEAR, "ALGO": ALGO, "VET": VET, "SAND": SAND,
  "MANA": MANA
};

const TOKEN_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(TOKEN_MAP).map(([name, addr]) => [addr.toLowerCase(), name])
);

function tokenName(addr: string): string {
  return TOKEN_NAMES[addr.toLowerCase()] || addr.slice(0, 10) + "...";
}

// ═══════════════════════════════════════════════════════════════════════════
//  CONTRACT INSTANCES
// ═══════════════════════════════════════════════════════════════════════════

let pancakeContract  = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, provider);
let biswapContract   = new ethers.Contract(BISWAP_ROUTER, ROUTER_ABI, provider);
let apeswapContract  = new ethers.Contract(APESWAP_ROUTER, ROUTER_ABI, provider);
let bakeryContract   = new ethers.Contract(BAKERY_ROUTER, ROUTER_ABI, provider);
let babyswapContract = new ethers.Contract(BABYSWAP_ROUTER, ROUTER_ABI, provider);
let mdexContract     = new ethers.Contract(MDEX_ROUTER, ROUTER_ABI, provider);

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

setInterval(() => {
  cexPrices["BNB"] = (600 + (Math.random() * 10 - 5)).toFixed(2);
  cexPrices["ETH"] = (3500 + (Math.random() * 50 - 25)).toFixed(2);
  cexPrices["BTC"] = (65000 + (Math.random() * 500 - 250)).toFixed(2);
}, 3000);

// ═══════════════════════════════════════════════════════════════════════════
//  MEMPOOL & PRICE MONITORING (kept from v1)
// ═══════════════════════════════════════════════════════════════════════════

async function analyzePendingTx(txHash: string) {
  try {
    const tx = await provider.getTransaction(txHash);
    if (!tx || !tx.to || !tx.data) return;

    const routers = [PANCAKE_ROUTER, BISWAP_ROUTER, APESWAP_ROUTER, BAKERY_ROUTER];
    const targetRouter = routers.find(r => tx.to?.toLowerCase() === r.toLowerCase());
    
    if (targetRouter) {
      if (tx.data.startsWith("0x38ed1739") || tx.data.startsWith("0x7ff362d5") || tx.data.startsWith("0x18cbafe5")) {
        console.log(`🎯 Potential Swap Detected in Mempool: ${txHash} on ${targetRouter.slice(0,10)}`);
        
        if (tx.data.startsWith("0x38ed1739")) {
          try {
            const decoded = v2RouterInterface.decodeFunctionData("swapExactTokensForTokens", tx.data);
            const path = decoded[2];
            if (path && path.length >= 2) {
              const tokenIn = path[0];
              const tokenOut = path[path.length - 1];
              console.log(`🔍 Backrunning Opportunity: ${tokenName(tokenIn)} -> ${tokenName(tokenOut)}`);
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

function setupMempoolListeners() {
  wsProviders.forEach(ws => {
    try { ws.removeAllListeners(); ws.close(); } catch (e) {}
  });
  wsProviders = [];

  WS_NODES.forEach((url, idx) => {
    setTimeout(() => {
      connectToWs(url, `Standard-${idx}`);
    }, idx * 2000);
  });

  if (BLOXR_AUTH_HEADER) {
    connectToWs(BLOXR_BSC_WS, "BloXroute", { "Authorization": BLOXR_AUTH_HEADER });
  } else {
    console.log("BloXroute Auth Header missing, skipping BloXroute mempool...");
  }

  setupNewPairListener();
}

function setupNewPairListener() {
  try {
    const pancakeFactory = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, provider);
    pancakeFactory.on("PairCreated", (token0: string, token1: string, pair: string) => {
      console.log(`✨ [NEW PAIR] PancakeSwap: ${tokenName(token0)} / ${tokenName(token1)} at ${pair.slice(0,10)}`);
    });
  } catch (e: any) {
    console.error("Failed to setup New Pair Listener:", e.message);
  }
}

function connectToWs(url: string, sourceName: string, headers: any = {}) {
  try {
    const ws = new WebSocket(url, {
      headers: headers,
      handshakeTimeout: 30000,
      followRedirects: true
    });

    ws.on("open", () => {
      console.log(`[${sourceName}] Mempool WebSocket connected to ${url}`);
      
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingInterval);
        }
      }, 30000);

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
          analyzePendingTx(message.params.result);
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

// ═══════════════════════════════════════════════════════════════════════════
//  RPC SWITCHING
// ═══════════════════════════════════════════════════════════════════════════

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
    const networkPromise = newProvider.getNetwork();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000));
    await Promise.race([networkPromise, timeoutPromise]);
    
    provider = newProvider;
    pancakeContract  = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, provider);
    biswapContract   = new ethers.Contract(BISWAP_ROUTER, ROUTER_ABI, provider);
    apeswapContract  = new ethers.Contract(APESWAP_ROUTER, ROUTER_ABI, provider);
    bakeryContract   = new ethers.Contract(BAKERY_ROUTER, ROUTER_ABI, provider);
    babyswapContract = new ethers.Contract(BABYSWAP_ROUTER, ROUTER_ABI, provider);
    mdexContract     = new ethers.Contract(MDEX_ROUTER, ROUTER_ABI, provider);
    console.log("Successfully switched to new RPC");
  } catch (err: any) {
    console.error(`Failed to connect to RPC ${RPC_NODES[currentRpcIndex]}: ${err.message}`);
    await performSwitch();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PRICE MONITORING & TRIANGULAR ARBITRAGE
// ═══════════════════════════════════════════════════════════════════════════

async function effectivePriceAfterFees(amountIn: bigint, path: string[], router: any): Promise<bigint> {
  try {
    const amounts = await router.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch (e) {
    return 0n;
  }
}

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

  for (const [name, contract] of Object.entries(routers)) {
    const readProvider = multicallProvider || provider;
    const routerWithMulticall = new ethers.Contract(contract.target as string, ROUTER_ABI, readProvider);
    
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
            console.log(`💎 [TRIANGLE] Opportunity on ${name}: ${profitBps} bps | Path: ${path.map(a => tokenName(a)).join(" -> ")}`);
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
      
      const ratio = Number(resOther) / Number(resWBNB);
    } catch (e) {}
  }
}

const tokenPairsMap: Record<string, [string, string]> = {
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

const routersMap: Record<string, string> = {
  pancake: PANCAKE_ROUTER,
  biswap: BISWAP_ROUTER,
  apeswap: APESWAP_ROUTER,
  bakeryswap: BAKERY_ROUTER,
  babyswap: BABYSWAP_ROUTER,
  mdex: MDEX_ROUTER
};

async function updatePrices() {
  checkTriangularArbitrage();
  checkLiquidityImbalance();
  
  const amountIn = ethers.parseEther("1");
  let success = false;

  try {
    const readProvider = multicallProvider || provider;
    const results: any = {};
    
    const pairPromises = Object.entries(tokenPairsMap).map(async ([pairName, [tA, tB]]) => {
      results[pairName] = {};
      const dexPromises = Object.entries(routersMap).map(async ([dexName, routerAddr]) => {
        try {
          const contract = new ethers.Contract(routerAddr, ROUTER_ABI, readProvider);
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
    
    if (!success) {
      await switchRpc();
    }
  } catch (error: any) {
    console.error("Error updating prices:", error.message);
    await switchRpc();
  }
}

// MEV-Share Listener
async function setupMevShare(signer: any) {
  try {
    // @ts-ignore
    mevShareClient = (MevShareClient as any).use(signer);
    console.log("MEV-Share Client initialized (Flashbots)");
    // @ts-ignore
    mevShareClient.on("bundle", (bundle: any) => {
      console.log("New MEV-Share bundle detected:", bundle.hash);
      setTimeout(updatePrices, 10);
    });
  } catch (e: any) {
    console.error("Failed to setup MEV-Share:", e.message);
  }
}

// Update prices every 5 seconds
setInterval(updatePrices, 5000);
updatePrices();

// ═══════════════════════════════════════════════════════════════════════════
//  API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/prices", (req, res) => {
  res.json(lastPrices);
});

app.post("/api/verify-contract", async (req, res) => {
  const { contractAddress, rpcEndpoint } = req.body;
  if (!contractAddress) return res.json({ verified: false });
  
  try {
    const checkProvider = rpcEndpoint ? new ethers.JsonRpcProvider(rpcEndpoint, bscNetwork, { staticNetwork: true }) : provider;
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
    const checkProvider = rpcEndpoint ? new ethers.JsonRpcProvider(rpcEndpoint, bscNetwork, { staticNetwork: true }) : provider;
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
      privateRpcProvider = new ethers.JsonRpcProvider(privateRpc, bscNetwork, { staticNetwork: true });
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

// ═══════════════════════════════════════════════════════════════════════════
//  /api/execute — MULTI-PATH FLASH ARBITRAGE v2.0
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/execute", async (req, res) => {
  const { 
    privateKey, contractAddress, buyDex, sellDex, amount, 
    useFlashLoan: rawUseFlashLoan, loanAmount, loanProvider, 
    pair, minProfit: rawMinProfit,
    // v2.0 optional: multi-hop paths
    buyPath, sellPath
  } = req.body;

  const useFlashLoan = rawUseFlashLoan === true || rawUseFlashLoan === "true";
  const minProfitPercent = parseFloat(rawMinProfit || "0.35");
  const minProfitBps = Math.floor(minProfitPercent * 100);

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🚀 NEW EXECUTION REQUEST (v2.0 Multi-Path)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Buy DEX:  ${buyDex}`);
  console.log(`  Sell DEX: ${sellDex}`);
  console.log(`  Pair:     ${pair}`);
  console.log(`  Amount:   ${amount}`);
  console.log(`  Flash:    ${useFlashLoan}`);
  console.log(`  Loan:     ${loanAmount} via ${loanProvider}`);
  console.log(`  Min Profit: ${minProfitBps} bps (${minProfitPercent}%)`);
  console.log("═══════════════════════════════════════════════════════════");

  if (!privateKey || !contractAddress) {
    return res.status(400).json({ error: "Missing private key or contract address" });
  }

  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Contract address - Use the newly deployed one
    const contractAddressToUse = "0x2F2e832A6D0cdb06E170E1fc60e4ad1Dcf7bb88B";
    
    // Verify contract address has code
    const code = await provider.getCode(contractAddressToUse);
    if (code === "0x") {
      return res.status(400).json({ error: `The address ${contractAddress} is not a contract. Please deploy the MultiPathFlashArbitrage contract and provide its address.` });
    }

    // Use the new v2.0 ABI
    const contract = new ethers.Contract(contractAddressToUse, MULTIPATH_ARB_ABI, wallet);

    // ── Resolve DEXs ─────────────────────────────────────────────────
    const buyDexInfo = resolveDex(buyDex);
    const sellDexInfo = resolveDex(sellDex);

    if (!buyDexInfo || !sellDexInfo) {
      return res.status(400).json({ error: `Invalid DEX specified: ${buyDex} or ${sellDex}. Available: ${Object.keys(DEX_REGISTRY).join(", ")}` });
    }

    // ── Resolve tokens ───────────────────────────────────────────────
    const [tokenA, tokenB] = tokenPairsMap[pair] || tokenPairsMap["WBNB/BUSD"];

    // Fetch decimals
    let decimalsA = 18, decimalsB = 18;
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

    let borrowToken = tokenA;
    let outToken = tokenB;
    let borrowDecimals = decimalsA;

    // ── Calculate loan amount ────────────────────────────────────────
    let loanAmt = useFlashLoan ? ethers.parseUnits((loanAmount || "0").toString(), borrowDecimals) : 0n;
    const tradeAmt = ethers.parseUnits((amount || "0").toString(), borrowDecimals);
    let buyAmountIn = useFlashLoan ? loanAmt : tradeAmt;

    // ── Resolve flash pair ───────────────────────────────────────────
    const loanProviderKey = (loanProvider || "PancakeSwap").toLowerCase();
    const loanDexInfo = resolveDex(loanProviderKey);
    const selectedFactory = loanDexInfo?.factory || PANCAKE_FACTORY;
    
    const factoryContract = new ethers.Contract(selectedFactory, [
      "function getPair(address tokenA, address tokenB) external view returns (address pair)"
    ], provider);

    const pairAddress = await factoryContract.getPair(borrowToken, outToken);
    if (pairAddress === ethers.ZeroAddress) {
      return res.status(400).json({ error: `No pair found for ${tokenName(borrowToken)}/${tokenName(outToken)} on ${loanDexInfo?.name || loanProvider}` });
    }

    // ── Check gas balance ────────────────────────────────────────────
    const gasBuffer = ethers.parseEther("0.007");
    const balance = await provider.getBalance(wallet.address);
    if (balance < gasBuffer) {
      return res.status(400).json({ 
        error: `Insufficient BNB for gas. You have ${ethers.formatEther(balance)} BNB but need at least ${ethers.formatEther(gasBuffer)} BNB.` 
      });
    }

    // ── Check pair liquidity ─────────────────────────────────────────
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
          error: `Insufficient liquidity on ${loanDexInfo?.name || loanProvider}. Pair has ${ethers.formatUnits(borrowReserve, borrowDecimals)} but you need ${ethers.formatUnits(buyAmountIn, borrowDecimals)}.` 
        });
      }
    } catch (e) {
      console.log("Could not verify pair liquidity, proceeding...");
    }

    // ── Theoretical profit check ─────────────────────────────────────
    let currentProfitBps = 0n;
    let isAdjusted = false;
    let originalAmount = ethers.formatUnits(buyAmountIn, borrowDecimals);

    try {
      const readProvider = multicallProvider || provider;
      const buyRouter = new ethers.Contract(buyDexInfo.router, ROUTER_ABI, readProvider);
      const sellRouter = new ethers.Contract(sellDexInfo.router, ROUTER_ABI, readProvider);
      
      const buyAmounts = await buyRouter.getAmountsOut(buyAmountIn, [borrowToken, outToken]);
      let amountOutFromBuy = buyAmounts[buyAmounts.length - 1];
      
      const sellAmounts = await sellRouter.getAmountsOut(amountOutFromBuy, [outToken, borrowToken]);
      let finalAmount = sellAmounts[sellAmounts.length - 1];
      
      let fee = (buyAmountIn * 3n) / 997n;
      let amountToRepay = buyAmountIn + fee;
      let netChange = finalAmount - amountToRepay;
      currentProfitBps = buyAmountIn > 0n ? (netChange * 10000n) / buyAmountIn : 0n;

      console.log(`📊 Profit Analysis:`);
      console.log(`   Buy In:     ${ethers.formatUnits(buyAmountIn, borrowDecimals)} ${tokenName(borrowToken)}`);
      console.log(`   Buy Out:    ${ethers.formatUnits(amountOutFromBuy, decimalsB)} ${tokenName(outToken)}`);
      console.log(`   Sell Back:  ${ethers.formatUnits(finalAmount, borrowDecimals)} ${tokenName(borrowToken)}`);
      console.log(`   Repay:      ${ethers.formatUnits(amountToRepay, borrowDecimals)}`);
      console.log(`   Net Profit: ${ethers.formatUnits(netChange, borrowDecimals)} (${currentProfitBps} bps)`);

      // Check spot price for max theoretical spread
      const spotPrice = ethers.parseUnits("1", borrowDecimals);
      const spotAmountsB = await buyRouter.getAmountsOut(spotPrice, [borrowToken, outToken]);
      const spotAmountsFinal = await sellRouter.getAmountsOut(spotAmountsB[spotAmountsB.length - 1], [outToken, borrowToken]);
      const spotFinal = spotAmountsFinal[spotAmountsFinal.length - 1];
      const spotRepay = spotPrice + (spotPrice * 3n) / 997n;
      const maxPossibleBps = ((spotFinal - spotRepay) * 10000n) / spotPrice;

      console.log(`   Max Theoretical Spread: ${maxPossibleBps} bps`);

      if (maxPossibleBps < 30n) {
        return res.status(400).json({ 
          error: `Trade is not profitable enough. Theoretical profit: ${maxPossibleBps} bps, required: 30 bps.` 
        });
      }

      if (maxPossibleBps <= BigInt(minProfitBps)) {
        return res.status(400).json({ 
          error: `Trade is not profitable enough. Theoretical profit: ${maxPossibleBps} bps, required: ${minProfitBps} bps.` 
        });
      }

      // Binary search for optimal amount if current is not profitable enough
      if (currentProfitBps < BigInt(minProfitBps)) {
        console.log(`⚠️ Current amount not profitable (${currentProfitBps} bps). Searching for optimal amount...`);
        
        let low = ethers.parseUnits("0.1", borrowDecimals);
        let high = buyAmountIn;
        let bestAmount = 0n;
        
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
          console.log(`✅ Found profitable amount: ${ethers.formatUnits(bestAmount, borrowDecimals)}`);
          buyAmountIn = bestAmount;
          if (useFlashLoan) loanAmt = bestAmount;
          isAdjusted = true;
          
          const bAmounts = await buyRouter.getAmountsOut(buyAmountIn, [borrowToken, outToken]);
          amountOutFromBuy = bAmounts[bAmounts.length - 1];
          const sAmounts = await sellRouter.getAmountsOut(amountOutFromBuy, [outToken, borrowToken]);
          finalAmount = sAmounts[sAmounts.length - 1];
          const adjFee = (buyAmountIn * 3n) / 997n;
          amountToRepay = buyAmountIn + adjFee;
          netChange = finalAmount - amountToRepay;
          currentProfitBps = (netChange * 10000n) / buyAmountIn;
        } else {
          return res.status(400).json({ error: `Trade is not profitable at any amount. Current: ${currentProfitBps} bps, required: ${minProfitBps} bps.` });
        }
      }
    } catch (e: any) {
      console.log("Theoretical profit check failed:", e.message);
      if (e.message?.includes("INSUFFICIENT_OUTPUT_AMOUNT")) {
        return res.status(400).json({ error: "Trade not profitable: Insufficient output amount on one of the DEXs." });
      }
      if (e.message?.includes("INSUFFICIENT_LIQUIDITY")) {
        return res.status(400).json({ error: "Insufficient liquidity on one of the DEXs." });
      }
    }

    // ═════════════════════════════════════════════════════════════════
    //  BUILD v2.0 ArbParams (Multi-path SwapHops)
    // ═════════════════════════════════════════════════════════════════

    const deadline = Math.floor(Date.now() / 1000) + 600;
    const nonce = ethers.hexlify(ethers.randomBytes(32));

    // Build buy hops (single hop or multi-hop if buyPath provided)
    const buyHops = [];
    const sellHops = [];

    if (buyPath && Array.isArray(buyPath) && buyPath.length > 0) {
      // Multi-hop buy path from frontend
      for (const hop of buyPath) {
        const hopDex = resolveDex(hop.dex || buyDex);
        if (!hopDex) continue;
        buyHops.push({
          dexRouter: hopDex.router,
          tokenIn: hop.tokenIn,
          tokenOut: hop.tokenOut,
          amountOutMin: 0,
          fee: hopDex.fee,
          dexVersion: hopDex.version,
          quoter: hopDex.quoter
        });
      }
    } else {
      // Default: single hop buy
      buyHops.push({
        dexRouter: buyDexInfo.router,
        tokenIn: borrowToken,
        tokenOut: outToken,
        amountOutMin: 0,
        fee: buyDexInfo.fee,
        dexVersion: buyDexInfo.version,
        quoter: buyDexInfo.quoter
      });
    }

    if (sellPath && Array.isArray(sellPath) && sellPath.length > 0) {
      // Multi-hop sell path from frontend
      for (const hop of sellPath) {
        const hopDex = resolveDex(hop.dex || sellDex);
        if (!hopDex) continue;
        sellHops.push({
          dexRouter: hopDex.router,
          tokenIn: hop.tokenIn,
          tokenOut: hop.tokenOut,
          amountOutMin: 0,
          fee: hopDex.fee,
          dexVersion: hopDex.version,
          quoter: hopDex.quoter
        });
      }
    } else {
      // Default: single hop sell
      sellHops.push({
        dexRouter: sellDexInfo.router,
        tokenIn: outToken,
        tokenOut: borrowToken,
        amountOutMin: 0,
        fee: sellDexInfo.fee,
        dexVersion: sellDexInfo.version,
        quoter: sellDexInfo.quoter
      });
    }

    const arbParams = {
      flashPair: pairAddress,
      loanToken: borrowToken,
      loanAmount: loanAmt,
      buyHops: buyHops,
      sellHops: sellHops,
      minProfitBps: minProfitBps,
      deadline: deadline,
      nonce: nonce
    };

    console.log(`\n📦 ArbParams (v2.0):`);
    console.log(`   Flash Pair:  ${pairAddress}`);
    console.log(`   Loan Token:  ${tokenName(borrowToken)}`);
    console.log(`   Loan Amount: ${ethers.formatUnits(loanAmt, borrowDecimals)}`);
    console.log(`   Buy Hops:    ${buyHops.length}`);
    buyHops.forEach((h, i) => {
      const dexN = Object.values(DEX_REGISTRY).find(d => d.router.toLowerCase() === h.dexRouter.toLowerCase())?.name || h.dexRouter.slice(0,10);
      console.log(`     [${i}] ${tokenName(h.tokenIn)} -> ${tokenName(h.tokenOut)} via ${dexN} (v${h.dexVersion})`);
    });
    console.log(`   Sell Hops:   ${sellHops.length}`);
    sellHops.forEach((h, i) => {
      const dexN = Object.values(DEX_REGISTRY).find(d => d.router.toLowerCase() === h.dexRouter.toLowerCase())?.name || h.dexRouter.slice(0,10);
      console.log(`     [${i}] ${tokenName(h.tokenIn)} -> ${tokenName(h.tokenOut)} via ${dexN} (v${h.dexVersion})`);
    });
    console.log(`   Min Profit:  ${minProfitBps} bps`);
    console.log(`   Deadline:    ${deadline}`);
    console.log(`   Nonce:       ${nonce}\n`);

    // ── Ownership & factory check ────────────────────────────────────
    try {
      const [owner, contractFactory] = await Promise.all([
        contract.owner(),
        contract.PANCAKE_FACTORY().catch(() => ethers.ZeroAddress)
      ]);
      
      if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
        return res.status(400).json({ error: `Wallet ${wallet.address} is not the owner of contract ${contractAddress}. Owner is ${owner}.` });
      }
      
      if (contractFactory !== ethers.ZeroAddress && contractFactory.toLowerCase() !== PANCAKE_FACTORY.toLowerCase()) {
        console.warn(`⚠️ Contract factory mismatch: ${contractFactory} vs ${PANCAKE_FACTORY}`);
      }
    } catch (e) {
      console.log("Could not verify contract state, proceeding...");
    }

    // ── Static call simulation ───────────────────────────────────────
    try {
      console.log("⏳ Simulating transaction (staticCall)...");
      await contract.executeArbitrage.staticCall(arbParams);
      console.log("✅ Simulation PASSED — executing real transaction...");
    } catch (staticError: any) {
      console.error("❌ Static call failed:", staticError);
      let reason = "Transaction would revert.";
      if (staticError.reason) {
        reason = staticError.reason;
      } else if (staticError.data || (staticError.error && staticError.error.data)) {
        const revertData = staticError.data || staticError.error.data;
        if (revertData && revertData.length > 10) {
          try {
            if (revertData.startsWith("0x08c379a0")) {
              const abiCoder = ethers.AbiCoder.defaultAbiCoder();
              const decoded = abiCoder.decode(["string"], "0x" + revertData.slice(10));
              reason = `Execution reverted: ${decoded[0]}`;
            } else if (revertData.startsWith("0x4e487b71")) {
              const abiCoder = ethers.AbiCoder.defaultAbiCoder();
              const decoded = abiCoder.decode(["uint256"], "0x" + revertData.slice(10));
              reason = `Panic code: ${decoded[0]}`;
            } else {
              reason = "Contract rejected the trade. Profit too low, slippage too high, or flash loan repayment failed.";
            }
          } catch (e) {
            reason = "Arbitrage opportunity expired or slippage too high.";
          }
        }
      }
      return res.status(400).json({ error: reason });
    }

    // ── Dynamic gas price ────────────────────────────────────────────
    const feeData = await provider.getFeeData();
    const baseGasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
    let gasPrice = baseGasPrice;
    
    if (currentProfitBps > 100n) {
      gasPrice = (baseGasPrice * 150n) / 100n;
    } else if (currentProfitBps > 50n) {
      gasPrice = (baseGasPrice * 120n) / 100n;
    } else {
      gasPrice = (baseGasPrice * 110n) / 100n;
    }

    // ── Execute real transaction ─────────────────────────────────────
    console.log("📤 Sending transaction...");
    const tx = await contract.executeArbitrage(arbParams, { 
      gasLimit: 1_500_000,
      gasPrice: gasPrice
    });

    // Also broadcast to private RPC if configured
    if (privateRpcProvider) {
      try {
        const signedTx = await wallet.signTransaction({
          to: contractAddress,
          data: contract.interface.encodeFunctionData("executeArbitrage", [arbParams]),
          gasLimit: 1_500_000,
          nonce: await wallet.getNonce()
        });
        await privateRpcProvider.broadcastTransaction(signedTx);
        console.log("📡 Transaction broadcasted to Private RPC");
      } catch (e) {
        console.log("Private RPC broadcast failed:", e);
      }
    }

    const receipt = await tx.wait();
    
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  ✅ TRANSACTION CONFIRMED`);
    console.log(`  TX Hash:   ${receipt.hash}`);
    console.log(`  Block:     ${receipt.blockNumber}`);
    console.log(`  Gas Used:  ${receipt.gasUsed.toString()}`);
    console.log("═══════════════════════════════════════════════════════════");

    // ── Parse events from receipt ────────────────────────────────────
    const parsedEvents: any[] = [];
    for (const log of receipt.logs || []) {
      try {
        const parsed = contract.interface.parseLog({
          topics: log.topics as string[],
          data: log.data,
        });
        if (parsed) {
          const eventData: any = { name: parsed.name };
          for (const [key, value] of Object.entries(parsed.args)) {
            if (isNaN(Number(key))) {
              eventData[key] = typeof value === 'bigint' ? value.toString() : value;
            }
          }
          parsedEvents.push(eventData);
          console.log(`  📊 Event [${parsed.name}]:`, JSON.stringify(eventData, null, 2));
        }
      } catch {
        // Skip non-contract events
      }
    }

    // Extract profit from Settlement event
    const settlementEvent = parsedEvents.find(e => e.name === "Settlement");
    const profitInfo = settlementEvent ? {
      netProfit: settlementEvent.netProfit,
      profitBps: settlementEvent.profitBps,
      loanAmount: settlementEvent.loanAmount,
      fee: settlementEvent.fee
    } : null;

    res.json({ 
      success: true, 
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      adjusted: isAdjusted,
      originalAmount: originalAmount,
      executedAmount: ethers.formatUnits(buyAmountIn, borrowDecimals),
      events: parsedEvents,
      profit: profitInfo
    });

  } catch (error: any) {
    console.error("❌ Execution error:", error);
    res.status(500).json({ error: error.message || "Transaction failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  /api/execute-multipath — ADVANCED MULTI-HOP EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/execute-multipath", async (req, res) => {
  const { 
    privateKey, contractAddress, 
    flashPair, loanToken, loanAmount,
    buyHops: rawBuyHops, sellHops: rawSellHops,
    minProfitBps, deadline: rawDeadline
  } = req.body;

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🚀 MULTI-PATH EXECUTION (Advanced API)");
  console.log("═══════════════════════════════════════════════════════════");

  if (!privateKey || !contractAddress) {
    return res.status(400).json({ error: "Missing privateKey or contractAddress" });
  }
  if (!rawBuyHops || !rawSellHops || !flashPair || !loanToken || !loanAmount) {
    return res.status(400).json({ error: "Missing required params: flashPair, loanToken, loanAmount, buyHops, sellHops" });
  }

  try {
    const contractAddressToUse = "0x2F2e832A6D0cdb06E170E1fc60e4ad1Dcf7bb88B";
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(contractAddressToUse, MULTIPATH_ARB_ABI, wallet);

    // Build hops
    const buyHops = rawBuyHops.map((h: any) => {
      const dex = resolveDex(h.dex || "pancake");
      return {
        dexRouter: h.dexRouter || dex?.router || PANCAKE_ROUTER,
        tokenIn: h.tokenIn,
        tokenOut: h.tokenOut,
        amountOutMin: h.amountOutMin || 0,
        fee: h.fee || dex?.fee || 0,
        dexVersion: h.dexVersion ?? dex?.version ?? DEX_V2,
        quoter: h.quoter || dex?.quoter || ethers.ZeroAddress
      };
    });

    const sellHops = rawSellHops.map((h: any) => {
      const dex = resolveDex(h.dex || "pancake");
      return {
        dexRouter: h.dexRouter || dex?.router || PANCAKE_ROUTER,
        tokenIn: h.tokenIn,
        tokenOut: h.tokenOut,
        amountOutMin: h.amountOutMin || 0,
        fee: h.fee || dex?.fee || 0,
        dexVersion: h.dexVersion ?? dex?.version ?? DEX_V2,
        quoter: h.quoter || dex?.quoter || ethers.ZeroAddress
      };
    });

    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const deadline = rawDeadline || Math.floor(Date.now() / 1000) + 600;

    const arbParams = {
      flashPair,
      loanToken,
      loanAmount: ethers.parseUnits(loanAmount.toString(), 18),
      buyHops,
      sellHops,
      minProfitBps: minProfitBps || 35,
      deadline,
      nonce
    };

    console.log(`📦 Multi-Path ArbParams:`, JSON.stringify(arbParams, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));

    // Static call
    try {
      await contract.executeArbitrage.staticCall(arbParams);
      console.log("✅ Simulation PASSED");
    } catch (e: any) {
      return res.status(400).json({ error: `Simulation failed: ${e.reason || e.message}` });
    }

    // Execute
    const feeData = await provider.getFeeData();
    const gasPrice = ((feeData.gasPrice || ethers.parseUnits("3", "gwei")) * 120n) / 100n;

    const tx = await contract.executeArbitrage(arbParams, { 
      gasLimit: 2_000_000,
      gasPrice 
    });

    const receipt = await tx.wait();

    // Parse events
    const parsedEvents: any[] = [];
    for (const log of receipt.logs || []) {
      try {
        const parsed = contract.interface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed) {
          const eventData: any = { name: parsed.name };
          for (const [key, value] of Object.entries(parsed.args)) {
            if (isNaN(Number(key))) {
              eventData[key] = typeof value === 'bigint' ? value.toString() : value;
            }
          }
          parsedEvents.push(eventData);
        }
      } catch {}
    }

    res.json({
      success: true,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      events: parsedEvents
    });

  } catch (error: any) {
    console.error("❌ Multi-path execution error:", error);
    res.status(500).json({ error: error.message || "Transaction failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  HEALTH CHECK & DEX INFO
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/dex-registry", (req, res) => {
  const registry = Object.entries(DEX_REGISTRY).map(([key, info]) => ({
    key,
    name: info.name,
    router: info.router,
    version: info.version === 0 ? "V2" : info.version === 1 ? "UniV3" : "PcV3",
    fee: info.fee
  }));
  res.json(registry);
});

app.get("/api/health", async (req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    res.json({ 
      status: "ok", 
      version: "2.0.0",
      engine: "MultiPathFlashArbitrage",
      blockNumber,
      rpc: RPC_NODES[currentRpcIndex],
      mevShareActive: !!mevShareClient,
      privateRpcActive: !!privateRpcProvider,
      supportedDexes: Object.keys(DEX_REGISTRY).length,
      timestamp: Date.now()
    });
  } catch (e) {
    res.status(500).json({ status: "error", message: "RPC connection failed" });
  }
});

// JSON 404 handler for API routes
app.use("/api/*", (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.originalUrl}` });
});

// ═══════════════════════════════════════════════════════════════════════════
//  SERVER STARTUP
// ═══════════════════════════════════════════════════════════════════════════

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
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  BSC Arbitrage Engine v2.0 running on port ${PORT}`);
    console.log("  Engine: MultiPathFlashArbitrage (Multi-DEX, Multi-hop)");
    console.log("═══════════════════════════════════════════════════════════");
    
    try {
      await provider.getNetwork();
      console.log("✅ Initial RPC connection successful");
    } catch (err) {
      console.error("Initial RPC connection failed, switching...");
      await switchRpc();
    }

    setupMempoolListeners();
  });
}

startServer();
