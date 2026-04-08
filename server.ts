import express from "express";
  import path from "path";
  import { fileURLToPath } from "url";
  import { ethers } from "ethers";

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  import MevShareClient from "@flashbots/mev-share-client";
  import ethersMulticallProvider from "ethers-multicall-provider";
  import OpportunityScanner, { ScannerConfig, DEXPool } from "./src/lib/opportunityScanner";
  const { MulticallWrapper } = ethersMulticallProvider;
  import WebSocket from "ws";

  console.log("SERVER STARTING - MEV ENGINE PRO v2.0");

  const app = express();
  const PORT = parseInt(process.env.PORT || "3000");

  app.use(express.json());

  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      console.log(`[API] ${req.method} ${req.path}`);
    }
    next();
  });

  // ─────────────────────────────────────────
  // RPC Configuration
  // ─────────────────────────────────────────
  const RPC_NODES = [
    "https://bsc-rpc.publicnode.com",
    "https://bsc-dataseed1.defibit.io/",
    "https://bsc-dataseed1.ninicoin.io/",
    "https://bsc-dataseed2.defibit.io/",
    "https://bsc-dataseed2.ninicoin.io/",
    "https://bsc-dataseed3.binance.org/",
    "https://bsc-dataseed4.binance.org/",
    "https://bsc-dataseed.binance.org/"
  ];

  const WS_NODES = [
    "wss://bsc-rpc.publicnode.com",
    "wss://bsc.publicnode.com"
  ];

  const BLOXR_BSC_WS = "wss://bsc.bloxroute.com/ws";
  let BLOXR_AUTH_HEADER = process.env.BLOXR_AUTH_HEADER || "";

  let currentRpcIndex = 0;
  let switchRetries = 0;
  let isSwitching = false;
  let provider = new ethers.JsonRpcProvider(RPC_NODES[currentRpcIndex]);
  let privateRpcProvider: ethers.JsonRpcProvider | null = null;
  let multicallProvider: any = null;
  let mevShareClient: MevShareClient | null = null;
  let wsProviders: WebSocket[] = [];

  // ─────────────────────────────────────────
  // Multicall3 (BSC) - batch RPC calls
  // ─────────────────────────────────────────
  const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
  const MULTICALL3_ABI = [
    "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)"
  ];

  // ─────────────────────────────────────────
  // DEX Addresses
  // ─────────────────────────────────────────
  const PANCAKE_ROUTER  = ethers.getAddress("0x10ed43c718714eb63d5aa57b78b54704e256024e");
  const BISWAP_ROUTER   = ethers.getAddress("0x3a6d8ca21d1cf76f653a67577fa0d27453350dce");
  const APESWAP_ROUTER  = ethers.getAddress("0xcf0febd3f17cef5b47b0cd257acf6025c5bff3b7");
  const BAKERY_ROUTER   = ethers.getAddress("0xcde540d7eafe93ac5fe6233bee57e1270d3e330f");
  const BABYSWAP_ROUTER = ethers.getAddress("0x325e343f1de2356f596938ac336224c33554444b");
  const MDEX_ROUTER     = ethers.getAddress("0x7dae51bd3df1541f4846fb9452375937d8357336");

  const PANCAKE_FACTORY  = ethers.getAddress("0xca143ce32fe78f1f7019d7d551a6402fc5350c73");
  const BISWAP_FACTORY   = ethers.getAddress("0x858e3312ed3a8762e0101bb5c46a8c1ed44dc160");
  const APESWAP_FACTORY  = ethers.getAddress("0x0841bd0b734e4f5853f0dd8d7ea041c241fb0da6");
  const BAKERY_FACTORY   = ethers.getAddress("0x01bf708e59d7723694d64c332696db0000000000");
  const BABYSWAP_FACTORY = ethers.getAddress("0x85e0e343f1de2356f596938ac336224c3554444b");
  const MDEX_FACTORY     = ethers.getAddress("0x3cd1c46068da20007d54dc21199710521547612c");

  // ─────────────────────────────────────────
  // Token Addresses
  // ─────────────────────────────────────────
  const WBNB  = ethers.getAddress("0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c");
  const BUSD  = ethers.getAddress("0xe9e7cea3dedca5984780bafc599bd69add087d56");
  const USDT  = ethers.getAddress("0x55d398326f99059ff775485246999027b3197955");
  const USDC  = ethers.getAddress("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d");
  const ETH   = ethers.getAddress("0x2170ed0880ac9a755fd29b2688956bd959f933f8");
  const CAKE  = ethers.getAddress("0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82");
  const BTCB  = ethers.getAddress("0x7130d2a12b9bcbae4f2634d864a1ee1ce3ead9c3");
  const ADA   = ethers.getAddress("0x3ee2200efb3400fabb9aacf31297cbdd1d435d47");
  const DOT   = ethers.getAddress("0x7083609fce4d1d8dc0c979aab8c869ea8c1f7329");
  const XRP   = ethers.getAddress("0x1d2f0da169ceb2df7b744837037f081f79794b16");
  const LINK  = ethers.getAddress("0xf8a06f1317e506864b618301216b45c397b9010d");
  const LTC   = ethers.getAddress("0x4338665c00d9755421b2518275675b399046093c");
  const DOGE  = ethers.getAddress("0xba2ae424d960c26247dd6c32edc70b295c744c43");
  const MATIC = ethers.getAddress("0xcc42724c6683b7e57334c4e856f4c9965ed682bd");
  const AVAX  = ethers.getAddress("0x1ce0c2827e2ef14d5c4f29a091d735a204794041");
  const FIL   = ethers.getAddress("0x0d21c53b6e53997751ff24b0375936788096d40f");
  const ATOM  = ethers.getAddress("0x0eb3a705fc54725037cc9e008bdede697f62f335");
  const UNI   = ethers.getAddress("0xbf5140a22578168fd562dccf235e5d43a02ce9b1");
  const AAVE  = ethers.getAddress("0xfb6115445bff7b52feb98650c87f44907e58f802");
  const ALPACA = ethers.getAddress("0x8f0528ce5ef7b51152a59745befdd91d97091d2f");
  const XVS   = ethers.getAddress("0xcf6bb5389c92bdda8a3747ddb454cb7a64626c63");
  const BAKE  = ethers.getAddress("0xe02df9e3e622debdd69fb838bb799e3f168902c5");
  const BAND  = ethers.getAddress("0xad6caeb32cd2c308980a548bd0bc5aa4306c6c18");
  const SXP   = ethers.getAddress("0x47bead2563dcbf3bf2c9407fea4dc236faba485a");
  const INJ   = ethers.getAddress("0xa2b726b1145a4773f68593cf171187d8ebe4d495");
  const SAND  = ethers.getAddress("0x67b725d7e342d7b611fa85e859df9697d9378b2e");
  const AXS   = ethers.getAddress("0x715d400f88c167884bbcc41c5fea407ed4d2f8a0");

  // ─────────────────────────────────────────
  // Extended Pair List — Mid-Cap Focus
  // These have less efficient markets → better arb opportunities
  // ─────────────────────────────────────────
  const TOKEN_PAIRS: Record<string, [string, string]> = {
    // Large pairs (low chance, but fast to check)
    "WBNB/BUSD":  [WBNB, BUSD],
    "BNB/USDT":   [WBNB, USDT],
    "BNB/USDC":   [WBNB, USDC],
    "ETH/BNB":    [ETH, WBNB],
    "BTCB/BNB":   [BTCB, WBNB],
    "BTCB/USDT":  [BTCB, USDT],

    // Mid-cap — HIGH arbitrage opportunity zone
    "CAKE/BNB":   [CAKE, WBNB],
    "CAKE/USDT":  [CAKE, USDT],
    "CAKE/BUSD":  [CAKE, BUSD],
    "ADA/BNB":    [ADA, WBNB],
    "DOT/BNB":    [DOT, WBNB],
    "XRP/BNB":    [XRP, WBNB],
    "LINK/BNB":   [LINK, WBNB],
    "LTC/BNB":    [LTC, WBNB],
    "DOGE/BNB":   [DOGE, WBNB],
    "MATIC/BNB":  [MATIC, WBNB],
    "AVAX/BNB":   [AVAX, WBNB],
    "FIL/BNB":    [FIL, WBNB],
    "ATOM/BNB":   [ATOM, WBNB],
    "UNI/BNB":    [UNI, WBNB],
    "AAVE/BNB":   [AAVE, WBNB],
    "INJ/BNB":    [INJ, WBNB],
    "AXS/BNB":    [AXS, WBNB],
    "SAND/BNB":   [SAND, WBNB],

    // DeFi-native BSC tokens — best arb opportunities
    "ALPACA/BNB": [ALPACA, WBNB],
    "XVS/BNB":    [XVS, WBNB],
    "XVS/BUSD":   [XVS, BUSD],
    "BAKE/BNB":   [BAKE, WBNB],
    "BAND/BNB":   [BAND, WBNB],
    "SXP/BNB":    [SXP, WBNB]
  };

  const ROUTER_ABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
  ];

  const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
    "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
  ];

  const PAIR_ABI = [
    "function getReserves() external view returns (uint112, uint112, uint32)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
  ];

  const v2RouterInterface = new ethers.Interface([
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory)"
  ]);

  const scannerConfig: ScannerConfig = {
    updateInterval: 15000,
    minProfitBps: 30,
    maxPathLength: 3,
    gasEstimate: ethers.parseUnits("0.007", "ether")
  };

  let pancakeContract: ethers.Contract;
  let biswapContract: ethers.Contract;
  let apeswapContract: ethers.Contract;
  let bakeryContract: ethers.Contract;
  let babyswapContract: ethers.Contract;
  let mdexContract: ethers.Contract;
  let opportunityScanner: OpportunityScanner;

  // Cache pair addresses (avoids repeated getPair calls)
  let pairAddressCache: Record<string, string> = {};
  let pairAddressCacheTime = 0;
  const PAIR_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Guard against concurrent updatePrices
  let isUpdatingPrices = false;

  // ─────────────────────────────────────────
  // BigInt Square Root (Newton's method)
  // Used in optimal amount formula
  // ─────────────────────────────────────────
  function bigIntSqrt(value: bigint): bigint {
    if (value < 0n) return 0n;
    if (value === 0n) return 0n;
    let x = value;
    let y = (x + 1n) / 2n;
    while (y < x) {
      x = y;
      y = (x + value / x) / 2n;
    }
    return x;
  }

  // ─────────────────────────────────────────
  // Optimal Arbitrage Amount Formula
  // Mathematical derivation from Uniswap V2 arbitrage analysis
  // Finds the exact input that MAXIMIZES profit without binary search
  //
  // Scenario: Buy tokenB from pool1 (cheaper), sell on pool2 (expensive)
  //   pool1: (ra, rb) = reserves of (tokenA, tokenB)
  //   pool2: (rc, rd) = reserves of (tokenB, tokenA)
  //   fee = 997/1000
  //
  // Δ_opt = (√(997² × ra × rb × rc × rd) − 1000 × ra × rd) / (1000 × rd + 997 × rc)
  // ─────────────────────────────────────────
  function calcOptimalAmount(
    ra: bigint, rb: bigint,  // pool1: reserveIn, reserveOut
    rc: bigint, rd: bigint   // pool2: reserveIn(=out of pool1), reserveOut
  ): bigint {
    try {
      // Scale up by 1e6 to maintain precision under sqrt
      const scale = 1_000_000n;
      const underSqrt = (997n * 997n * ra * rb * rc * rd * scale * scale) / 1n;
      const sqrtVal = bigIntSqrt(underSqrt) / scale;
      const numerator = sqrtVal - 1000n * ra * rd / 1000n;
      const denominator = 1000n * rd + 997n * rc;
      if (numerator <= 0n || denominator <= 0n) return 0n;
      return numerator / denominator;
    } catch {
      return 0n;
    }
  }

  // ─────────────────────────────────────────
  // Multicall3 batch reserves fetcher
  // Fetches reserves for N pairs in ONE RPC call
  // ─────────────────────────────────────────
  async function batchGetReserves(pairAddresses: string[]): Promise<Map<string, { r0: bigint; r1: bigint; token0: string }>> {
    const result = new Map<string, { r0: bigint; r1: bigint; token0: string }>();
    if (pairAddresses.length === 0) return result;

    try {
      const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
      const iface = new ethers.Interface(PAIR_ABI);

      const calls = pairAddresses.flatMap(addr => [
        { target: addr, allowFailure: true, callData: iface.encodeFunctionData("getReserves", []) },
        { target: addr, allowFailure: true, callData: iface.encodeFunctionData("token0", []) }
      ]);

      const raw = await mc.aggregate3(calls);

      for (let i = 0; i < pairAddresses.length; i++) {
        const reservesRaw = raw[i * 2];
        const token0Raw = raw[i * 2 + 1];
        if (!reservesRaw.success || !token0Raw.success) continue;

        const [r0, r1] = iface.decodeFunctionResult("getReserves", reservesRaw.returnData);
        const [token0] = iface.decodeFunctionResult("token0", token0Raw.returnData);
        result.set(pairAddresses[i].toLowerCase(), { r0: BigInt(r0), r1: BigInt(r1), token0 });
      }
    } catch (e: any) {
      console.error("batchGetReserves error:", e.message);
    }
    return result;
  }

  // ─────────────────────────────────────────
  // Scan all DEX pairs for every token pair
  // and look for profitable spreads
  // ─────────────────────────────────────────
  const DEXES = [
    { name: "pancake",  router: PANCAKE_ROUTER,  factory: PANCAKE_FACTORY },
    { name: "biswap",   router: BISWAP_ROUTER,   factory: BISWAP_FACTORY },
    { name: "apeswap",  router: APESWAP_ROUTER,  factory: APESWAP_FACTORY },
    { name: "bakery",   router: BAKERY_ROUTER,   factory: BAKERY_FACTORY },
    { name: "babyswap", router: BABYSWAP_ROUTER, factory: BABYSWAP_FACTORY },
    { name: "mdex",     router: MDEX_ROUTER,     factory: MDEX_FACTORY }
  ];

  interface MultiPairOpportunity {
    pair: string;
    buyDex: string;
    sellDex: string;
    buyRouter: string;
    sellRouter: string;
    tokenA: string;
    tokenB: string;
    optimalAmount: bigint;
    profitBps: number;
    reservesBuy: { r0: bigint; r1: bigint };
    reservesSell: { r0: bigint; r1: bigint };
  }

  let currentOpportunities: MultiPairOpportunity[] = [];

  async function scanAllPairsForOpportunities(): Promise<void> {
    try {
      // Step 1: Refresh pair address cache if stale
      const now = Date.now();
      if (now - pairAddressCacheTime > PAIR_CACHE_TTL) {
        console.log("🔄 Refreshing pair address cache for all pairs...");
        const factoryIface = new ethers.Interface(FACTORY_ABI);
        const mc = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);

        const calls = [];
        const callIndex: { pairName: string; dexName: string }[] = [];

        for (const [pairName, [tA, tB]] of Object.entries(TOKEN_PAIRS)) {
          for (const dex of DEXES) {
            calls.push({
              target: dex.factory,
              allowFailure: true,
              callData: factoryIface.encodeFunctionData("getPair", [tA, tB])
            });
            callIndex.push({ pairName, dexName: dex.name });
          }
        }

        // Split into chunks of 100 to avoid hitting gas limit
        const chunkSize = 100;
        let newCache: Record<string, string> = {};
        for (let start = 0; start < calls.length; start += chunkSize) {
          const chunk = calls.slice(start, start + chunkSize);
          const raw = await mc.aggregate3(chunk).catch(() => null);
          if (!raw) continue;
          raw.forEach((r: any, i: number) => {
            if (!r.success) return;
            const [addr] = factoryIface.decodeFunctionResult("getPair", r.returnData);
            if (addr !== ethers.ZeroAddress) {
              const { pairName, dexName } = callIndex[start + i];
              newCache[`${pairName}::${dexName}`] = addr;
            }
          });
        }
        pairAddressCache = newCache;
        pairAddressCacheTime = now;
        console.log(`✅ Pair cache refreshed: ${Object.keys(pairAddressCache).length} pairs found`);
      }

      // Step 2: Batch fetch all reserves in one call
      const allPairAddresses = [...new Set(Object.values(pairAddressCache))];
      const reservesMap = await batchGetReserves(allPairAddresses);

      // Step 3: For each token pair, compare reserves across DEXes
      const opportunities: MultiPairOpportunity[] = [];

      for (const [pairName, [tokenA, tokenB]] of Object.entries(TOKEN_PAIRS)) {
        const dexReserves: { dex: typeof DEXES[0]; r0: bigint; r1: bigint; token0: string; addr: string }[] = [];

        for (const dex of DEXES) {
          const addr = pairAddressCache[`${pairName}::${dex.name}`];
          if (!addr) continue;
          const res = reservesMap.get(addr.toLowerCase());
          if (!res || res.r0 === 0n || res.r1 === 0n) continue;
          dexReserves.push({ dex, r0: res.r0, r1: res.r1, token0: res.token0, addr });
        }

        if (dexReserves.length < 2) continue;

        // Compare every pair of DEXes
        for (let i = 0; i < dexReserves.length; i++) {
          for (let j = i + 1; j < dexReserves.length; j++) {
            const d1 = dexReserves[i];
            const d2 = dexReserves[j];

            // Normalize reserves: ra = reserveA, rb = reserveB in each pool
            const isTokenA0_d1 = d1.token0.toLowerCase() === tokenA.toLowerCase();
            const ra1 = isTokenA0_d1 ? d1.r0 : d1.r1;
            const rb1 = isTokenA0_d1 ? d1.r1 : d1.r0;

            const isTokenA0_d2 = d2.token0.toLowerCase() === tokenA.toLowerCase();
            const ra2 = isTokenA0_d2 ? d2.r0 : d2.r1;
            const rb2 = isTokenA0_d2 ? d2.r1 : d2.r0;

            if (ra1 === 0n || rb1 === 0n || ra2 === 0n || rb2 === 0n) continue;

            // Price in each pool (scaled by 1e18 to avoid decimals)
            const price1 = (rb1 * 1_000_000_000_000_000_000n) / ra1;
            const price2 = (rb2 * 1_000_000_000_000_000_000n) / ra2;

            if (price1 === price2) continue;

            // Determine which pool is cheaper (buy tokenB here)
            let buyPool = price1 < price2 ? d1 : d2; // cheaper tokenB (lower price)
            let sellPool = price1 < price2 ? d2 : d1; // expensive tokenB
            let buyRa = price1 < price2 ? ra1 : ra2;
            let buyRb = price1 < price2 ? rb1 : rb2;
            let sellRb = price1 < price2 ? rb2 : rb1;
            let sellRa = price1 < price2 ? ra2 : ra1;

            // Calculate optimal amount using mathematical formula
            const optAmt = calcOptimalAmount(buyRa, buyRb, sellRb, sellRa);
            if (optAmt <= 0n || optAmt > buyRa / 2n) continue; // Safety: don't use >50% of reserve

            // Simulate the trade using AMM formula
            const FEE = 997n;
            const buyInWithFee = optAmt * FEE;
            const buyOut = (buyInWithFee * buyRb) / (buyRa * 1000n + buyInWithFee);

            const sellInWithFee = buyOut * FEE;
            const sellOut = (sellInWithFee * sellRa) / (sellRb * 1000n + sellInWithFee);

            if (sellOut <= optAmt) continue;

            const profitBps = Number(((sellOut - optAmt) * 10000n) / optAmt);
            if (profitBps < 25) continue; // Need at least 25 bps to cover flash loan fee + gas

            opportunities.push({
              pair: pairName,
              buyDex: buyPool.dex.name,
              sellDex: sellPool.dex.name,
              buyRouter: buyPool.dex.router,
              sellRouter: sellPool.dex.router,
              tokenA, tokenB,
              optimalAmount: optAmt,
              profitBps,
              reservesBuy: { r0: buyPool.r0, r1: buyPool.r1 },
              reservesSell: { r0: sellPool.r0, r1: sellPool.r1 }
            });
          }
        }
      }

      opportunities.sort((a, b) => b.profitBps - a.profitBps);
      currentOpportunities = opportunities;

      if (opportunities.length > 0) {
        console.log(`🎯 Found ${opportunities.length} opportunities. Best: ${opportunities[0].pair} ${opportunities[0].buyDex}->${opportunities[0].sellDex} @ ${opportunities[0].profitBps} bps`);
      }
    } catch (e: any) {
      console.error("scanAllPairs error:", e.message);
    }
  }

  // ─────────────────────────────────────────
  // PairCreated Listener
  // When a NEW pair is listed, we're first to arb it
  // ─────────────────────────────────────────
  function setupPairCreatedListeners() {
    for (const dex of DEXES) {
      try {
        const factory = new ethers.Contract(dex.factory, FACTORY_ABI, provider);
        factory.on("PairCreated", async (token0: string, token1: string, pairAddr: string) => {
          console.log(`🆕 New pair on ${dex.name}: ${token0} / ${token1} @ ${pairAddr}`);
          // Invalidate cache to pick up new pair
          pairAddressCacheTime = 0;
          // Trigger immediate scan
          setTimeout(scanAllPairsForOpportunities, 2000);
        });
        console.log(`📡 Listening for PairCreated on ${dex.name}`);
      } catch (e: any) {
        console.error(`Failed to setup PairCreated listener for ${dex.name}:`, e.message);
      }
    }
  }

  // ─────────────────────────────────────────
  // Price tracking for frontend display
  // ─────────────────────────────────────────
  let lastPrices: any = {
    pancake: "0", biswap: "0", apeswap: "0",
    bakeryswap: "0", babyswap: "0", mdex: "0",
    pairs: {}, timestamp: Date.now()
  };

  async function updatePrices() {
    if (isUpdatingPrices) return;
    isUpdatingPrices = true;
    try {
      const amountIn = ethers.parseEther("1");
      const path = [WBNB, BUSD];

      const [pOut, bOut, aOut, bakOut, babyOut, mOut] = await Promise.all([
        pancakeContract.getAmountsOut(amountIn, path).catch(() => [0n, 0n]),
        biswapContract.getAmountsOut(amountIn, path).catch(() => [0n, 0n]),
        apeswapContract.getAmountsOut(amountIn, path).catch(() => [0n, 0n]),
        bakeryContract.getAmountsOut(amountIn, path).catch(() => [0n, 0n]),
        babyswapContract.getAmountsOut(amountIn, path).catch(() => [0n, 0n]),
        mdexContract.getAmountsOut(amountIn, path).catch(() => [0n, 0n])
      ]);

      lastPrices = {
        pancake: ethers.formatUnits(pOut[1], 18),
        biswap: ethers.formatUnits(bOut[1], 18),
        apeswap: ethers.formatUnits(aOut[1], 18),
        bakeryswap: ethers.formatUnits(bakOut[1], 18),
        babyswap: ethers.formatUnits(babyOut[1], 18),
        mdex: ethers.formatUnits(mOut[1], 18),
        pairs: {
          "WBNB/BUSD": {
            pancake: ethers.formatUnits(pOut[1], 18),
            biswap: ethers.formatUnits(bOut[1], 18),
            apeswap: ethers.formatUnits(aOut[1], 18)
          }
        },
        timestamp: Date.now(),
        opportunities: currentOpportunities.slice(0, 10).map(o => ({
          pair: o.pair,
          buyDex: o.buyDex,
          sellDex: o.sellDex,
          profitBps: o.profitBps,
          optimalAmountBNB: ethers.formatEther(o.optimalAmount)
        }))
      };

      // Update scanner pools using multicall reserves
      const pairAddrs = DEXES.map(d => pairAddressCache[`WBNB/BUSD::${d.name}`]).filter(Boolean);
      const reservesMap = pairAddrs.length > 0 ? await batchGetReserves(pairAddrs) : new Map();

      opportunityScanner.clear();
      for (const dex of DEXES) {
        const addr = pairAddressCache[`WBNB/BUSD::${dex.name}`];
        if (!addr) continue;
        const res = reservesMap.get(addr.toLowerCase());
        if (!res) continue;

        opportunityScanner.addPool({
          dexName: dex.name,
          routerAddress: dex.router,
          factoryAddress: dex.factory,
          token0: res.token0,
          token1: res.token0.toLowerCase() === WBNB.toLowerCase() ? BUSD : WBNB,
          reserve0: res.r0,
          reserve1: res.r1,
          fee: 25
        });
      }
    } catch (e: any) {
      console.error("Price update failed:", e.message);
      if (e.message.includes("429") || e.message.includes("-32005") || e.message.includes("403") ||
          e.message.includes("rate limit") || e.message.includes("Forbidden") ||
          e.message.includes("timeout") || e.message.includes("SERVER_ERROR")) {
        console.log("Rate limit/RPC error detected, switching RPC...");
        switchRpc();
      }
    } finally {
      isUpdatingPrices = false;
    }
  }

  // ─────────────────────────────────────────
  // RPC Rotation
  // ─────────────────────────────────────────
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
      console.error("All RPC nodes failing. Waiting 30s...");
      await new Promise(r => setTimeout(r, 30000));
      switchRetries = 0;
      return;
    }
    currentRpcIndex = (currentRpcIndex + 1) % RPC_NODES.length;
    switchRetries++;
    console.log(`Switching to RPC: ${RPC_NODES[currentRpcIndex]} (attempt ${switchRetries})`);
    try {
      const newProvider = new ethers.JsonRpcProvider(RPC_NODES[currentRpcIndex]);
      await newProvider.getNetwork();
      provider = newProvider;
      await initContracts();
      console.log("✅ RPC switched successfully");
      switchRetries = 0;
    } catch {
      await performSwitch();
    }
  }

  async function initContracts() {
    multicallProvider = MulticallWrapper.wrap(provider);
    pancakeContract  = new ethers.Contract(PANCAKE_ROUTER,  ROUTER_ABI, multicallProvider);
    biswapContract   = new ethers.Contract(BISWAP_ROUTER,   ROUTER_ABI, multicallProvider);
    apeswapContract  = new ethers.Contract(APESWAP_ROUTER,  ROUTER_ABI, multicallProvider);
    bakeryContract   = new ethers.Contract(BAKERY_ROUTER,   ROUTER_ABI, multicallProvider);
    babyswapContract = new ethers.Contract(BABYSWAP_ROUTER, ROUTER_ABI, multicallProvider);
    mdexContract     = new ethers.Contract(MDEX_ROUTER,     ROUTER_ABI, multicallProvider);
  }

  async function init() {
    try {
      await initContracts();
      opportunityScanner = new OpportunityScanner(provider, scannerConfig);
      opportunityScanner.startScanning();
      setupPairCreatedListeners();
      console.log("✅ Contracts initialized, scanner started");
    } catch (e: any) {
      console.error("Init failed:", e.message);
    }
  }
  init();

  // ─────────────────────────────────────────
  // Mempool with dedup + throttle
  // ─────────────────────────────────────────
  const recentTxHashes = new Set<string>();
  let lastMempoolAnalysis = 0;
  const MEMPOOL_THROTTLE_MS = 5000;

  async function analyzePendingTx(txHash: string) {
    if (recentTxHashes.has(txHash)) return;
    recentTxHashes.add(txHash);
    if (recentTxHashes.size > 200) {
      const first = recentTxHashes.values().next().value;
      if (first) recentTxHashes.delete(first);
    }
    const nowMs = Date.now();
    if (nowMs - lastMempoolAnalysis < MEMPOOL_THROTTLE_MS) return;
    lastMempoolAnalysis = nowMs;

    try {
      const tx = await provider.getTransaction(txHash);
      if (!tx || !tx.to || !tx.data) return;
      const routers = [PANCAKE_ROUTER, BISWAP_ROUTER, APESWAP_ROUTER, BAKERY_ROUTER];
      const targetRouter = routers.find(r => tx.to?.toLowerCase() === r.toLowerCase());
      if (targetRouter && (tx.data.startsWith("0x38ed1739") || tx.data.startsWith("0x7ff362d5"))) {
        console.log(`🎯 Mempool swap detected on ${targetRouter.slice(0,10)}...`);
        if (tx.data.startsWith("0x38ed1739")) {
          try {
            const decoded = v2RouterInterface.decodeFunctionData("swapExactTokensForTokens", tx.data);
            const path = decoded[2];
            if (path?.length >= 2) console.log(`🔍 Path: ${path[0]} -> ${path[path.length-1]}`);
          } catch {}
        }
      }
    } catch {}
  }

  function setupMempoolListeners() {
    wsProviders.forEach(ws => { try { ws.removeAllListeners(); ws.close(); } catch {} });
    wsProviders = [];
    WS_NODES.slice(0, 2).forEach((url, idx) => connectToWs(url, `BSC-${idx}`));
    if (BLOXR_AUTH_HEADER) connectToWs(BLOXR_BSC_WS, "BloXroute", { "Authorization": BLOXR_AUTH_HEADER });
  }

  function connectToWs(url: string, name: string, headers: any = {}) {
    try {
      const ws = new WebSocket(url, { headers, handshakeTimeout: 10000 });
      ws.on("open", () => {
        console.log(`[WS:${name}] Connected`);
        ws.send(JSON.stringify({ jsonrpc:"2.0", id:1, method:"eth_subscribe", params:["newPendingTransactions"] }));
      });
      ws.on("message", async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.params?.result) analyzePendingTx(msg.params.result);
        } catch {}
      });
      ws.on("error", (err) => console.error(`[WS:${name}] Error: ${err.message}`));
      ws.on("close", () => {
        console.log(`[WS:${name}] Closed, reconnecting in 10s...`);
        setTimeout(() => connectToWs(url, name, headers), 10000);
      });
      wsProviders.push(ws);
    } catch (e: any) { console.error(`WS connect failed ${name}:`, e.message); }
  }

  setupMempoolListeners();

  // ─────────────────────────────────────────
  // Scheduled tasks
  // ─────────────────────────────────────────
  setInterval(updatePrices, 15000); // Display prices every 15s
  setInterval(scanAllPairsForOpportunities, 20000); // Deep multi-pair scan every 20s

  // CEX mock prices
  let cexPrices: Record<string, string> = { "BNB": "600.00", "ETH": "3500.00", "BTC": "65000.00" };
  setInterval(() => {
    cexPrices["BNB"] = (600 + (Math.random() * 10 - 5)).toFixed(2);
    cexPrices["ETH"] = (3500 + (Math.random() * 50 - 25)).toFixed(2);
    cexPrices["BTC"] = (65000 + (Math.random() * 500 - 250)).toFixed(2);
  }, 60000);

  // MEV Share Setup
  async function setupMevShare(signer: ethers.Wallet) {
    try {
      mevShareClient = MevShareClient.useDefaultNetwork(signer);
      console.log("MEV-Share Client initialized");
    } catch (e: any) { console.error("MEV-Share init failed:", e.message); }
  }

  // ─────────────────────────────────────────
  // Helper: effective price after fees
  // ─────────────────────────────────────────
  async function effectivePriceAfterFees(amountIn: bigint, path: string[], router: any): Promise<bigint> {
    try {
      const amounts = await router.getAmountsOut(amountIn, path);
      return amounts[amounts.length - 1];
    } catch { return 0n; }
  }

  // ─────────────────────────────────────────
  // API Endpoints
  // ─────────────────────────────────────────
  app.get("/api/prices", (req, res) => res.json(lastPrices));

  app.get("/api/opportunities", (req, res) => {
    res.json(currentOpportunities.slice(0, 20).map(o => ({
      pair: o.pair,
      buyDex: o.buyDex,
      sellDex: o.sellDex,
      profitBps: o.profitBps,
      optimalAmountBNB: ethers.formatEther(o.optimalAmount),
      tokenA: o.tokenA,
      tokenB: o.tokenB
    })));
  });

  app.get("/api/opportunities/top", (req, res) => {
    const best = currentOpportunities[0];
    if (!best) return res.json({ message: "No opportunities found yet" });
    res.json({
      pair: best.pair,
      buyDex: best.buyDex,
      sellDex: best.sellDex,
      profitBps: best.profitBps,
      optimalAmountBNB: ethers.formatEther(best.optimalAmount),
      readyToExecute: best.profitBps >= 50
    });
  });

  app.get("/api/scanner/stats", (req, res) => res.json(opportunityScanner.getStats()));

  app.get("/api/mev/status", (req, res) => res.json({
    mevShareActive: !!mevShareClient,
    privateRpcActive: !!privateRpcProvider,
    cexPrices,
    activeRpc: RPC_NODES[currentRpcIndex],
    opportunitiesFound: currentOpportunities.length
  }));

  app.post("/api/settings/advanced", async (req, res) => {
    const { privateRpc, useMevShare, privateKey, bloxrAuthHeader } = req.body;
    try {
      if (privateRpc) {
        privateRpcProvider = new ethers.JsonRpcProvider(privateRpc);
        provider = privateRpcProvider;
        await initContracts();
        console.log("Switched to Private RPC:", privateRpc);
      }
      if (bloxrAuthHeader) {
        BLOXR_AUTH_HEADER = bloxrAuthHeader;
        setupMempoolListeners();
      }
      if (useMevShare && privateKey) {
        const signer = new ethers.Wallet(privateKey, provider);
        await setupMevShare(signer);
      }
      res.json({ status: "ok", message: "Advanced settings applied" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/wallet-balance", async (req, res) => {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: "Missing address" });
    try {
      const balance = await provider.getBalance(address);
      res.json({ bnb: ethers.formatEther(balance), address });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/verify-contract", async (req, res) => {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: "Missing address" });
    try {
      const code = await provider.getCode(address);
      res.json({ isContract: code !== "0x", address });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/execute", async (req, res) => {
    let { privateKey, contractAddress, buyDex, sellDex, amount, useFlashLoan: rawUseFlashLoan,
          loanAmount, loanProvider, pair, minProfit: rawMinProfit } = req.body;
    const useFlashLoan = rawUseFlashLoan === true || rawUseFlashLoan === "true";
    const minProfitPercent = parseFloat(rawMinProfit || "0.35");
    const minProfitBps = Math.floor(minProfitPercent * 100);

    console.log("--- New Execution Request ---");
    console.log(`Trade: ${buyDex} -> ${sellDex} | Pair: ${pair} | Amount: ${amount} | Flash: ${useFlashLoan}`);
    console.log("-----------------------------");

    if (!privateKey || !contractAddress) return res.status(400).json({ error: "Missing private key or contract address" });

    try {
      const wallet = new ethers.Wallet(privateKey, provider);

      const code = await provider.getCode(contractAddress);
      if (code === "0x") return res.status(400).json({ error: `${contractAddress} is not a contract.` });

      const contract = new ethers.Contract(contractAddress, [
        "function executeArbitrage((address pair, address tokenBorrow, address tokenOut, uint256 loanAmount, address buyDex, address sellDex, uint256 minProfitBps, bytes buyCalldata, uint8 sellDexVersion, uint24 sellFee, uint256 deadline, bytes32 nonce, uint256 sellMinOut, address quoterAddress) p) external",
        "function owner() view returns (address)"
      ], wallet);

      const factories: Record<string, string> = {
        "pancake": PANCAKE_FACTORY, "pancakeswap": PANCAKE_FACTORY,
        "biswap": BISWAP_FACTORY, "apeswap": APESWAP_FACTORY,
        "bakery": BAKERY_FACTORY, "bakeryswap": BAKERY_FACTORY,
        "babyswap": BABYSWAP_FACTORY, "mdex": MDEX_FACTORY
      };
      const routers: Record<string, string> = {
        "pancake": PANCAKE_ROUTER, "pancakeswap": PANCAKE_ROUTER,
        "biswap": BISWAP_ROUTER, "apeswap": APESWAP_ROUTER,
        "bakeryswap": BAKERY_ROUTER, "bakery": BAKERY_ROUTER,
        "babyswap": BABYSWAP_ROUTER, "mdex": MDEX_ROUTER
      };

      const buyDexKey = buyDex.toLowerCase().replace("swap", "");
      const sellDexKey = sellDex.toLowerCase().replace("swap", "");
      let buyRouterAddr = routers[buyDexKey] || routers[buyDex.toLowerCase()];
      let sellRouterAddr = routers[sellDexKey] || routers[sellDex.toLowerCase()];
      let currentBuyDex = buyDex;
      let currentSellDex = sellDex;

      if (!buyRouterAddr || !sellRouterAddr)
        return res.status(400).json({ error: `Invalid DEX: ${buyDex} or ${sellDex}` });

      const [tokenA, tokenB] = TOKEN_PAIRS[pair] || TOKEN_PAIRS["WBNB/BUSD"];

      let decimalsA = 18, decimalsB = 18;
      try {
        const [dA, dB] = await Promise.all([
          new ethers.Contract(tokenA, ["function decimals() view returns (uint8)"], provider).decimals().catch(() => 18),
          new ethers.Contract(tokenB, ["function decimals() view returns (uint8)"], provider).decimals().catch(() => 18)
        ]);
        decimalsA = Number(dA); decimalsB = Number(dB);
      } catch {}

      let borrowToken = tokenA, outToken = tokenB;
      let borrowDecimals = decimalsA, outDecimals = decimalsB;
      const checkAmount = ethers.parseUnits("1", decimalsA);

      try {
        const readProvider = multicallProvider || provider;
        const buyC = new ethers.Contract(buyRouterAddr, ["function getAmountsOut(uint256, address[]) view returns (uint256[])"], readProvider);
        const sellC = new ethers.Contract(sellRouterAddr, ["function getAmountsOut(uint256, address[]) view returns (uint256[])"], readProvider);

        const [fwd, rev] = await Promise.all([
          effectivePriceAfterFees(checkAmount, [tokenA, tokenB], buyC).then(o => effectivePriceAfterFees(o, [tokenB, tokenA], sellC)),
          effectivePriceAfterFees(checkAmount, [tokenA, tokenB], sellC).then(o => effectivePriceAfterFees(o, [tokenB, tokenA], buyC))
        ]);

        console.log(`Effective Price Check (Round Trip):
          - Buy ${currentBuyDex} -> Sell ${currentSellDex}: ${ethers.formatUnits(fwd, decimalsA)}
          - Buy ${currentSellDex} -> Sell ${currentBuyDex}: ${ethers.formatUnits(rev, decimalsA)}`);

        if (rev > fwd) {
          console.log(`🔄 Reversing: Buy ${currentSellDex}, Sell ${currentBuyDex}`);
          [buyRouterAddr, sellRouterAddr] = [sellRouterAddr, buyRouterAddr];
          [currentBuyDex, currentSellDex] = [currentSellDex, currentBuyDex];
        }
      } catch {}

      const loanProviderKey = (loanProvider || "PancakeSwap").toLowerCase().replace("swap","");
      const selectedFactory = factories[loanProviderKey] || PANCAKE_FACTORY;
      const factoryContract = new ethers.Contract(selectedFactory, ["function getPair(address,address) external view returns (address)"], provider);
      const pairAddress = await factoryContract.getPair(borrowToken, outToken);
      if (pairAddress === ethers.ZeroAddress)
        return res.status(400).json({ error: `No pair for ${pair} on ${loanProvider}` });

      let buyAmountIn = useFlashLoan
        ? ethers.parseUnits((loanAmount || "0").toString(), borrowDecimals)
        : ethers.parseUnits((amount || "0").toString(), borrowDecimals);

      // ── Use optimal amount formula if user amount is suboptimal ──
      try {
        const pairContract = new ethers.Contract(pairAddress, PAIR_ABI, provider);
        const [[res0, res1], token0] = await Promise.all([pairContract.getReserves(), pairContract.token0()]);
        const isBorrowToken0 = token0.toLowerCase() === borrowToken.toLowerCase();
        const ra = isBorrowToken0 ? BigInt(res0) : BigInt(res1);
        const rb = isBorrowToken0 ? BigInt(res1) : BigInt(res0);

        // Get sell pool reserves
        const sellFactoryKey = Object.entries(factories).find(([, v]) => v.toLowerCase() === selectedFactory.toLowerCase())?.[0];
        const sellDexFactoryAddr = factories[sellDexKey] || PANCAKE_FACTORY;
        const sellFactory = new ethers.Contract(sellDexFactoryAddr, ["function getPair(address,address) external view returns (address)"], provider);
        const sellPairAddr = await sellFactory.getPair(outToken, borrowToken);
        if (sellPairAddr && sellPairAddr !== ethers.ZeroAddress) {
          const sellPairC = new ethers.Contract(sellPairAddr, PAIR_ABI, provider);
          const [[sr0, sr1], st0] = await Promise.all([sellPairC.getReserves(), sellPairC.token0()]);
          const isOutToken0 = st0.toLowerCase() === outToken.toLowerCase();
          const rc = isOutToken0 ? BigInt(sr0) : BigInt(sr1);
          const rd = isOutToken0 ? BigInt(sr1) : BigInt(sr0);
          const formulaAmt = calcOptimalAmount(ra, rb, rc, rd);
          if (formulaAmt > 0n) {
            console.log(`📐 Formula optimal amount: ${ethers.formatUnits(formulaAmt, borrowDecimals)} (user requested: ${ethers.formatUnits(buyAmountIn, borrowDecimals)})`);
            buyAmountIn = formulaAmt; // Use formula amount
          }
        }
      } catch (e: any) { console.log("Could not calculate formula amount:", e.message); }

      const gasBuffer = ethers.parseEther("0.007");
      const balance = await provider.getBalance(wallet.address);
      if (balance < gasBuffer) return res.status(400).json({
        error: `Insufficient BNB for gas: ${ethers.formatEther(balance)} BNB`
      });

      // Theoretical profit check
      const readProv = multicallProvider || provider;
      const buyRouter  = new ethers.Contract(buyRouterAddr,  ROUTER_ABI, readProv);
      const sellRouter = new ethers.Contract(sellRouterAddr, ROUTER_ABI, readProv);

      const [buyAmounts, ] = await Promise.all([
        buyRouter.getAmountsOut(buyAmountIn, [borrowToken, outToken])
      ]);
      const amountOutFromBuy = buyAmounts[buyAmounts.length - 1];
      const [sellAmounts] = await Promise.all([
        sellRouter.getAmountsOut(amountOutFromBuy, [outToken, borrowToken])
      ]);
      const finalAmount = sellAmounts[sellAmounts.length - 1];
      const amountToRepay = ((buyAmountIn * 10000n) / 9975n) + 10n;

      const netChange = finalAmount - amountToRepay;
      const profitBps = buyAmountIn > 0n ? (netChange * 10000n) / buyAmountIn : 0n;

      const spotPriceA = ethers.parseUnits("1", borrowDecimals);
      const spotB = await buyRouter.getAmountsOut(spotPriceA, [borrowToken, outToken]);
      const spotFinal = await sellRouter.getAmountsOut(spotB[spotB.length - 1], [outToken, borrowToken]);
      const spotRepay = ((spotPriceA * 10000n) / 9975n) + 10n;
      const maxBps = ((spotFinal[spotFinal.length - 1] - spotRepay) * 10000n) / spotPriceA;

      console.log(`📊 Market Analysis:
        - Spot Final: ${ethers.formatUnits(spotFinal[spotFinal.length-1], borrowDecimals)}
        - Max Theoretical: ${maxBps} bps
        - Amount Spread: ${profitBps} bps`);

      if (maxBps < 30n) {
        return res.status(400).json({
          error: `Not profitable. Theoretical: ${maxBps} bps, required: 30 bps.`
        });
      }
      if (profitBps < BigInt(minProfitBps)) {
        return res.status(400).json({
          error: `Profit ${profitBps} bps < required ${minProfitBps} bps.`
        });
      }

      console.log("🚀 Sending transaction to contract...");
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      const tx = await contract.executeArbitrage({
        pair: pairAddress,
        tokenBorrow: borrowToken,
        tokenOut: outToken,
        loanAmount: buyAmountIn,
        buyDex: buyRouterAddr,
        sellDex: sellRouterAddr,
        minProfitBps,
        buyCalldata: v2RouterInterface.encodeFunctionData("swapExactTokensForTokens", [
          buyAmountIn, 0, [borrowToken, outToken], contractAddress, deadline
        ]),
        sellDexVersion: 0,
        sellFee: 0,
        deadline,
        nonce,
        sellMinOut: 0,
        quoterAddress: ethers.ZeroAddress
      }, { gasLimit: 1000000 });

      console.log(`✅ TX sent: ${tx.hash}`);
      res.json({ success: true, txHash: tx.hash, executedAmount: ethers.formatUnits(buyAmountIn, borrowDecimals) });
    } catch (e: any) {
      console.error("Execution error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/settings/save", (req, res) => {
    res.json({ status: "ok" });
  });

  // Serve Frontend
  app.use(express.static(path.join(__dirname, "dist")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "dist", "index.html"));
  });

  app.listen(PORT, () => {
    console.log(`BSC Arbitrage Engine Pro v2 running on port ${PORT}`);
  });
  