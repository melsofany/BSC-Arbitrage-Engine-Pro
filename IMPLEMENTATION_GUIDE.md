# دليل تطبيق الإصلاحات - Implementation Guide

## 📋 جدول المحتويات
1. [الخطوات السريعة](#الخطوات-السريعة)
2. [التطبيق التفصيلي](#التطبيق-التفصيلي)
3. [الاختبار والتحقق](#الاختبار-والتحقق)
4. [استكشاف الأخطاء](#استكشاف-الأخطاء)
5. [الأسئلة الشائعة](#الأسئلة-الشائعة)

---

## الخطوات السريعة

### الطريقة الأسرع (5 دقائق)

```bash
# 1. انتقل إلى مجلد المشروع
cd /path/to/BSC-Arbitrage-Engine-Pro

# 2. احفظ النسخة القديمة
cp server.ts server.ts.backup

# 3. استخدم النسخة المُصححة
cp server-fixed.ts server.ts

# 4. شغّل المشروع
npm run dev
```

**النتيجة:**
```
✅ RPC Manager initialized successfully
✅ BSC Arbitrage Engine running on http://localhost:3000
```

---

## التطبيق التفصيلي

### الطريقة الثانية: التحديث اليدوي (للتحكم الكامل)

#### الخطوة 1: إضافة RpcManager Class

أضف هذا الكود في بداية `server.ts` (بعد الـ imports):

```typescript
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
```

#### الخطوة 2: استبدال متغيرات RPC

**ابحث عن:**
```typescript
const RPC_NODES = [
  "https://bsc-dataseed.binance.org/",
  "https://bsc-rpc.publicnode.com",
  "https://rpc.ankr.com/bsc",
  "https://bsc-dataseed1.defibit.io/"
];
```

**استبدل بـ:**
```typescript
const RPC_NODES = [
  "https://bsc-rpc.publicnode.com",      // ✅ أولاً
  "https://rpc.ankr.com/bsc",            // ✅ ثانياً
  "https://bsc-dataseed1.defibit.io/",   // ✅ ثالثاً
  "https://bsc-dataseed.binance.org/"    // ❌ آخر محاولة
];
```

#### الخطوة 3: إضافة RpcManager Initialization

**ابحث عن:**
```typescript
let provider = new ethers.JsonRpcProvider(RPC_NODES[currentRpcIndex], bscNetwork, { 
  staticNetwork: true,
  batchMaxCount: 1 
});
```

**استبدل بـ:**
```typescript
const rpcManager = RpcManager.getInstance();

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
```

#### الخطوة 4: استبدال استدعاءات Provider

**ابحث عن جميع:**
```typescript
provider.getTransaction(...)
provider.getBalance(...)
provider.getCode(...)
```

**استبدل بـ:**
```typescript
rpcManager.getHttpProvider().getTransaction(...)
rpcManager.getHttpProvider().getBalance(...)
rpcManager.getHttpProvider().getCode(...)
```

#### الخطوة 5: تحديث updatePrices

**ابحث عن:**
```typescript
setInterval(updatePrices, 5000);
```

**استبدل بـ:**
```typescript
setInterval(updatePrices, 10000); // 10 seconds instead of 5
```

**وفي داخل updatePrices، استبدل:**
```typescript
if (!success) {
  await switchRpc();
}
```

**بـ:**
```typescript
if (success) {
  rpcManager.reportSuccess();
} else {
  await rpcManager.reportFailure("updatePrices: No successful calls");
}
```

#### الخطوة 6: تحديث setupMempoolListeners

**ابحث عن:**
```typescript
function setupMempoolListeners() {
  wsProviders.forEach(ws => {
    try { ws.removeAllListeners(); ws.close(); } catch (e) {}
  });
  wsProviders = [];

  WS_NODES.slice(0, 2).forEach((url, idx) => {
    connectToWs(url, `Standard-${idx}`);
  });
```

**استبدل بـ:**
```typescript
function setupMempoolListeners() {
  wsProviders.forEach(ws => {
    try { ws.removeAllListeners(); ws.close(); } catch (e) {}
  });
  wsProviders = [];

  // Only connect to ONE reliable WS
  connectToWs(WS_NODES[0], "Standard-Primary");
```

#### الخطوة 7: تحديث WS reconnection timeout

**ابحث عن:**
```typescript
ws.on("close", () => {
  console.log(`[${sourceName}] WS Closed, reconnecting in 5s...`);
  setTimeout(() => connectToWs(url, sourceName, headers), 5000);
});
```

**استبدل بـ:**
```typescript
ws.on("close", () => {
  console.log(`[${sourceName}] WS Closed, reconnecting in 10s...`);
  setTimeout(() => connectToWs(url, sourceName, headers), 10000);
});
```

#### الخطوة 8: تحديث Contracts Initialization

**ابحث عن:**
```typescript
let pancakeContract = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, provider);
```

**استبدل بـ:**
```typescript
let pancakeContract = new ethers.Contract(PANCAKE_ROUTER, ROUTER_ABI, rpcManager.getHttpProvider());
```

#### الخطوة 9: تحديث API Endpoints

في `/api/wallet-balance` و `/api/verify-contract`:

**ابحث عن:**
```typescript
const checkProvider = rpcEndpoint ? new ethers.JsonRpcProvider(rpcEndpoint) : provider;
```

**استبدل بـ:**
```typescript
const checkProvider = rpcEndpoint 
  ? new ethers.JsonRpcProvider(rpcEndpoint) 
  : rpcManager.getHttpProvider();
```

#### الخطوة 10: إضافة Graceful Shutdown

في نهاية الملف، أضف:

```typescript
process.on("SIGINT", async () => {
  console.log("\nShutting down gracefully...");
  await rpcManager.cleanup();
  process.exit(0);
});
```

---

## الاختبار والتحقق

### اختبار 1: تحقق من البدء

```bash
npm run dev
```

**النتيجة المتوقعة:**
```
[RpcManager] Initializing with 4 HTTP RPCs
[RpcManager] Attempting to switch to HTTP RPC: https://bsc-rpc.publicnode.com
[RpcManager] ✅ Successfully switched to: https://bsc-rpc.publicnode.com
[RpcManager] Multicall provider initialized
✅ RPC Manager initialized successfully
✅ BSC Arbitrage Engine running on http://localhost:3000
```

### اختبار 2: تحقق من الـ Health Check

```bash
# في terminal آخر
curl http://localhost:3000/api/mev/status
```

**النتيجة المتوقعة:**
```json
{
  "mevShareActive": false,
  "privateRpcActive": false,
  "cexPrices": {...},
  "rpcManager": {
    "failureCount": 0,
    "successCount": 15,
    "isHealthy": true,
    "lastError": "",
    "lastErrorTime": 0,
    "lastHealthCheck": 1712681234567
  }
}
```

### اختبار 3: تحقق من الـ Prices API

```bash
curl http://localhost:3000/api/prices
```

**يجب أن ترى:**
```json
{
  "pancake": "600.25",
  "biswap": "600.23",
  "apeswap": "600.26",
  "bakeryswap": "600.24",
  "babyswap": "600.25",
  "mdex": "600.24",
  "pairs": {...},
  "timestamp": 1712681234567
}
```

### اختبار 4: محاكاة فشل RPC

لاختبار آلية الـ failover:

```bash
# في terminal آخر، راقب الـ logs
npm run dev 2>&1 | grep -i "rpcmanager\|error"

# في terminal ثالث، قطّع الـ internet أو استخدم:
# sudo iptables -A OUTPUT -d 1.1.1.1 -j DROP (لـ Cloudflare)
# ثم:
# sudo iptables -D OUTPUT -d 1.1.1.1 -j DROP (لإعادة الاتصال)
```

**يجب أن ترى:**
```
[RpcManager] Failure (1/5): Timeout
[RpcManager] Failure (2/5): Timeout
[RpcManager] Failure (3/5): Timeout
[RpcManager] Failure (4/5): Timeout
[RpcManager] Failure (5/5): Timeout
[RpcManager] Threshold reached. Switching RPC...
[RpcManager] Attempting to switch to HTTP RPC: https://rpc.ankr.com/bsc
[RpcManager] ✅ Successfully switched to: https://rpc.ankr.com/bsc
```

---

## استكشاف الأخطاء

### المشكلة: "RpcManager not initialized"

**السبب:** لم يتم استدعاء `rpcManager.initialize()`

**الحل:**
```typescript
// تأكد من وجود هذا الكود في البداية
const rpcManager = RpcManager.getInstance();

async function initializeServer() {
  await rpcManager.initialize(RPC_NODES, WS_NODES);
}

initializeServer();
```

### المشكلة: "Multicall provider not available"

**السبب:** فشل تهيئة Multicall

**الحل:**
```typescript
// الكود يتعامل مع هذا تلقائياً
const multicall = rpcManager.getMulticallProvider();
const provider = multicall || rpcManager.getHttpProvider(); // Fallback to HTTP
```

### المشكلة: "WS connection timeout"

**السبب:** الـ WS endpoint مشغول أو معطل

**الحل:**
```typescript
// الكود يحاول إعادة الاتصال كل 10 ثوانٍ
// إذا استمرت المشكلة، جرّب WS endpoint آخر:

const WS_NODES = [
  "wss://bsc-rpc.publicnode.com",
  "wss://bsc-ws-node.nariox.org",  // Try this
  "wss://binance.ankr.com"
];
```

### المشكلة: "All RPC nodes failing"

**السبب:** جميع الـ RPCs معطلة أو محجوبة

**الحل:**
```typescript
// 1. تحقق من الاتصال بالإنترنت
ping google.com

// 2. اختبر الـ RPC endpoints يدويًا
curl -X POST https://bsc-rpc.publicnode.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

// 3. إذا فشلت جميعها، استخدم RPC مدفوع:
const RPC_NODES = [
  "https://bsc.getblock.io/YOUR_API_KEY/",
  "https://rpc.ankr.com/bsc/YOUR_API_KEY",
];
```

---

## الأسئلة الشائعة

### س: هل يجب أن أستخدم `server-fixed.ts` أم أحدث الملف الحالي؟

**ج:** 
- إذا كنت في مرحلة مبكرة: استخدم `server-fixed.ts` مباشرة
- إذا كان لديك تعديلات مخصصة: حدّث الملف الحالي يدويًا باتباع الخطوات أعلاه

### س: هل سأفقد أي وظائف بتطبيق هذه الإصلاحات؟

**ج:** لا، جميع الوظائف محفوظة. فقط تم تحسين إدارة الـ Provider.

### س: كم مرة سيتم تبديل الـ RPC؟

**ج:** فقط عند 5 أخطاء متتالية، مع تأخير 30 ثانية بين المحاولات. هذا يقلل من الضغط بشكل كبير.

### س: هل يمكن تخصيص `failureThreshold` و `minSwitchInterval`؟

**ج:** نعم، عدّل هذه الأسطر في `RpcManager`:

```typescript
private failureThreshold = 5;        // غيّر إلى 3 أو 10
private minSwitchInterval = 30000;   // غيّر إلى 60000 (دقيقة واحدة)
```

### س: هل يؤثر هذا على الأداء؟

**ج:** بالعكس! الأداء سيتحسن:
- استقرار أفضل
- أخطاء أقل
- استهلاك موارد أقل

### س: ماذا لو كنت أستخدم Render؟

**ج:** هذه الإصلاحات مثالية لـ Render:
- تقليل استهلاك الموارد (مهم على Render)
- تقليل عدد الاتصالات المتزامنة
- استقرار أفضل

### س: هل يمكن استخدام RPC مدفوع؟

**ج:** نعم، فقط عدّل `RPC_NODES`:

```typescript
const RPC_NODES = [
  "https://bsc.getblock.io/YOUR_API_KEY/",
  "https://rpc.ankr.com/bsc/YOUR_API_KEY",
  // ... backup RPCs
];
```

---

## الخطوات التالية

بعد تطبيق الإصلاحات:

1. ✅ اختبر المشروع محليًا
2. ✅ راقب الـ logs لمدة 24 ساعة
3. ✅ انشر على Render أو VPS
4. ✅ راقب الأداء لمدة أسبوع
5. ✅ (اختياري) ترقية إلى RPC مدفوع

---

**تم آخر تحديث:** 2026-04-09  
**الحالة:** جاهز للإنتاج ✅
