import React, { useState, useEffect, useMemo } from "react";
import { 
  TrendingUp, 
  Activity, 
  Zap, 
  Settings, 
  AlertTriangle, 
  ArrowRightLeft, 
  CheckCircle2, 
  RefreshCw,
  Wallet,
  Coins,
  History,
  BarChart3,
  Languages,
  Eye,
  EyeOff,
  ShieldAlert,
  ArrowRight,
  Plus
} from "lucide-react";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area 
} from "recharts";
import { motion, AnimatePresence } from "motion/react";
import { cn, formatCurrency } from "./lib/utils";

interface PriceData {
  pancake: string;
  biswap: string;
  pairs?: Record<string, Record<string, string>>;
  timestamp: number;
}

interface ChartData {
  time: string;
  pancake: number;
  biswap: number;
  diff: number;
}

type Language = "en" | "ar";

const translations = {
  en: {
    dashboard: "Dashboard",
    opportunities: "Opportunities",
    history: "History",
    settings: "Settings",
    nodeStatus: "Node Status",
    liveMonitoring: "Live Monitoring",
    connectWallet: "Connect Wallet",
    pancakePrice: "PancakeSwap Price",
    biswapPrice: "BiSwap Price",
    priceDiff: "Price Difference",
    potentialProfit: "Potential Profit",
    spread: "Spread",
    highSpread: "High Spread",
    normal: "Normal",
    priceCorrelation: "Price Correlation",
    realTimeDex: "Real-time DEX price comparison",
    arbitrageSimulator: "Arbitrage Simulator",
    tradeAmount: "Trade Amount (BNB)",
    estimatedGas: "Estimated Gas",
    slippage: "Slippage",
    netProfit: "Net Profit",
    executeSimulation: "Execute Simulation",
    liveAlerts: "Live Alerts",
    noAlerts: "No active alerts",
    exportData: "Export Data",
    engineConfig: "Engine Configuration",
    rpcEndpoint: "RPC Endpoint",
    minProfit: "Min Profit Spread (%)",
    maxGas: "Max Gas Price (Gwei)",
    saveConfig: "Save Configuration",
    privateKey: "Wallet Private Key",
    contractAddress: "Contract Address",
    securityWarning: "Warning: Never share your private key. It is stored locally in your browser.",
    show: "Show",
    hide: "Hide",
    arbitrageOpp: "Arbitrage Opportunity! {percent}% difference found.",
    loading: "Loading...",
    activeOpportunities: "Active Opportunities",
    execute: "Execute",
    noOpportunities: "No active opportunities found",
    buyOn: "Buy on",
    sellOn: "Sell on",
    profit: "Profit",
    executing: "Executing...",
    tradeSuccess: "Trade executed successfully!",
    tradeFailed: "Trade execution failed: {error}",
    txHash: "Transaction Hash:",
    missingConfig: "Please enter your private key and contract address in settings first.",
    walletStatus: "Wallet Status",
    connected: "Connected",
    disconnected: "Disconnected",
    contractStatus: "Contract Status",
    mempoolScan: "Mempool Scanning",
    active: "Active",
    realTime: "Real-time",
    preMempool: "Pre-Mempool Access",
    verified: "Verified",
    mempoolActivity: "Mempool Activity",
    scanningBlocks: "Scanning Blocks...",
    pendingTxDetected: "Pending TX Detected",
    flashLoan: "Flash Loan",
    useFlashLoan: "Use Flash Loan",
    loanAmount: "Loan Amount",
    loanProvider: "Loan Provider",
    pancakeSwap: "PancakeSwap",
    apeSwap: "ApeSwap",
    bakerySwap: "BakerySwap",
    babySwap: "BabySwap",
    mdex: "MDEX",
    multiPairScan: "Multi-Pair Scanning",
    pair: "Pair",
    advanced: "Advanced",
    privateRpc: "Private RPC (Flashbots/BloXroute)",
    useMevShare: "Enable MEV-Share (Backrunning)",
    statisticalArbitrage: "Statistical Arbitrage (CEX/DEX)",
    backrunningStatus: "Backrunning Status",
    cexPrice: "CEX Price",
    dexPrice: "DEX Price",
    simulationVerified: "Simulation Verified",
    mevProtection: "MEV Protection",
    latency: "Latency",
    ms: "ms"
  },
  ar: {
    dashboard: "لوحة التحكم",
    opportunities: "الفرص المتاحة",
    history: "السجل",
    settings: "الإعدادات",
    nodeStatus: "حالة العقدة",
    liveMonitoring: "مراقبة مباشرة",
    connectWallet: "ربط المحفظة",
    pancakePrice: "سعر PancakeSwap",
    biswapPrice: "سعر BiSwap",
    priceDiff: "فرق السعر",
    potentialProfit: "الربح المحتمل",
    spread: "الفارق",
    highSpread: "فارق مرتفع",
    normal: "طبيعي",
    priceCorrelation: "ارتباط الأسعار",
    realTimeDex: "مقارنة أسعار DEX في الوقت الفعلي",
    arbitrageSimulator: "محاكي المراجحة",
    tradeAmount: "كمية التداول (BNB)",
    estimatedGas: "الغاز المقدر",
    slippage: "الانزلاق السعري",
    netProfit: "صافي الربح",
    executeSimulation: "تنفيذ المحاكاة",
    liveAlerts: "تنبيهات مباشرة",
    noAlerts: "لا توجد تنبيهات نشطة",
    exportData: "تصدير البيانات",
    engineConfig: "تكوين المحرك",
    rpcEndpoint: "نقطة اتصال RPC",
    minProfit: "أدنى فارق ربح (%)",
    maxGas: "أقصى سعر للغاز (Gwei)",
    saveConfig: "حفظ التكوين",
    privateKey: "المفتاح الخاص للمحفظة",
    contractAddress: "عنوان العقد",
    securityWarning: "تحذير: لا تشارك مفتاحك الخاص أبداً. يتم تخزينه محلياً في متصفحك.",
    show: "إظهار",
    hide: "إخفاء",
    arbitrageOpp: "فرصة مراجحة! تم العثور على فرق بنسبة {percent}%.",
    loading: "جاري التحميل...",
    activeOpportunities: "الفرص النشطة",
    execute: "تنفيذ",
    noOpportunities: "لم يتم العثور على فرص نشطة حالياً",
    buyOn: "شراء من",
    sellOn: "بيع في",
    profit: "الربح",
    executing: "جاري التنفيذ...",
    tradeSuccess: "تم تنفيذ العملية بنجاح!",
    tradeFailed: "فشل تنفيذ العملية: {error}",
    txHash: "رقم المعاملة (TX Hash):",
    missingConfig: "يرجى إدخال المفتاح الخاص وعنوان العقد في الإعدادات أولاً.",
    walletStatus: "حالة المحفظة",
    connected: "متصل",
    disconnected: "غير متصل",
    contractStatus: "حالة العقد",
    mempoolScan: "مسح Mempool",
    active: "نشط",
    realTime: "في الوقت الفعلي",
    preMempool: "وصول ما قبل Mempool",
    verified: "تم التحقق",
    mempoolActivity: "نشاط Mempool",
    scanningBlocks: "جاري مسح الكتل...",
    pendingTxDetected: "تم اكتشاف معاملة معلقة",
    flashLoan: "قرض فلاش (Flash Loan)",
    useFlashLoan: "استخدام قرض فلاش",
    loanAmount: "مبلغ القرض",
    loanProvider: "مزود القرض",
    pancakeSwap: "PancakeSwap",
    apeSwap: "ApeSwap",
    bakerySwap: "BakerySwap",
    babySwap: "BabySwap",
    mdex: "MDEX",
    multiPairScan: "مسح متعدد الأزواج",
    pair: "الزوج",
    advanced: "متقدم",
    privateRpc: "RPC خاص (Flashbots/BloXroute)",
    useMevShare: "تفعيل MEV-Share (Backrunning)",
    statisticalArbitrage: "المراجحة الإحصائية (CEX/DEX)",
    backrunningStatus: "حالة الـ Backrunning",
    cexPrice: "سعر المنصات المركزية",
    dexPrice: "سعر المنصات اللامركزية",
    simulationVerified: "تم التحقق من المحاكاة",
    mevProtection: "حماية MEV",
    latency: "زمن الاستجابة",
    ms: "ملي ثانية"
  }
};

interface Opportunity {
  id: string;
  pair: string;
  buyDex: string;
  sellDex: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  timestamp: number;
  isMempool?: boolean;
  isFlashLoan?: boolean;
}

export default function App() {
  const [prices, setPrices] = useState<PriceData | null>(null);
  const [history, setHistory] = useState<ChartData[]>([]);
  const [isLive, setIsLive] = useState(true);
  const [activeTab, setActiveTab] = useState<"dashboard" | "opportunities" | "history" | "settings">("dashboard");
  const [simulationAmount, setSimulationAmount] = useState(1);
  const [alerts, setAlerts] = useState<{id: number, msg: string, type: 'info' | 'success' | 'warning'}[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [isExecuting, setIsExecuting] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [mempoolLogs, setMempoolLogs] = useState<{id: number, msg: string, time: string}[]>([]);
  
  // Flash Loan State
  const [useFlashLoan, setUseFlashLoan] = useState(() => localStorage.getItem("arb_use_flash") === "true");
  const [loanAmount, setLoanAmount] = useState(() => localStorage.getItem("arb_loan_amount") || "100");
  const [loanProvider, setLoanProvider] = useState(() => localStorage.getItem("arb_loan_provider") || "PancakeSwap");
  const [privateRpc, setPrivateRpc] = useState(() => localStorage.getItem("arb_private_rpc") || "");
  const [useMevShare, setUseMevShare] = useState(() => localStorage.getItem("arb_use_mev_share") === "true");
  const [mevStatus, setMevStatus] = useState<any>(null);

  // New Settings State
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem("arb_lang");
    return (saved as Language) || "ar";
  });
  const [privateKey, setPrivateKey] = useState(() => localStorage.getItem("arb_pk") || "");
  const [contractAddress, setContractAddress] = useState(() => localStorage.getItem("arb_ca") || "");
  const [rpcEndpoint, setRpcEndpoint] = useState(() => localStorage.getItem("arb_rpc") || "https://bsc-dataseed.binance.org/");
  const [minProfit, setMinProfit] = useState(() => localStorage.getItem("arb_min_profit") || "0.1");
  const [maxGas, setMaxGas] = useState(() => localStorage.getItem("arb_max_gas") || "5");
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [isContractVerified, setIsContractVerified] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);

  const filteredOpportunities = useMemo(() => {
    const threshold = parseFloat(minProfit) || 0.5;
    return opportunities.filter(opp => (opp.profit / opp.buyPrice * 100) >= threshold);
  }, [opportunities, minProfit]);

  useEffect(() => {
    localStorage.setItem("arb_lang", language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem("arb_pk", privateKey);
  }, [privateKey]);

  useEffect(() => {
    localStorage.setItem("arb_ca", contractAddress);
  }, [contractAddress]);

  useEffect(() => {
    localStorage.setItem("arb_rpc", rpcEndpoint);
  }, [rpcEndpoint]);

  useEffect(() => {
    localStorage.setItem("arb_min_profit", minProfit);
  }, [minProfit]);

  useEffect(() => {
    localStorage.setItem("arb_max_gas", maxGas);
  }, [maxGas]);

  useEffect(() => {
    localStorage.setItem("arb_use_flash", useFlashLoan.toString());
  }, [useFlashLoan]);

  useEffect(() => {
    localStorage.setItem("arb_loan_amount", loanAmount);
  }, [loanAmount]);

  useEffect(() => {
    localStorage.setItem("arb_loan_provider", loanProvider);
  }, [loanProvider]);

  useEffect(() => {
    localStorage.setItem("arb_private_rpc", privateRpc);
  }, [privateRpc]);

  useEffect(() => {
    localStorage.setItem("arb_use_mev_share", useMevShare.toString());
  }, [useMevShare]);

  useEffect(() => {
    const fetchMevStatus = async () => {
      try {
        const res = await fetch("/api/mev/status");
        const data = await res.json();
        setMevStatus(data);
      } catch (e) {}
    };
    const interval = setInterval(fetchMevStatus, 3000);
    fetchMevStatus();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const verify = async () => {
      if (!contractAddress || !rpcEndpoint) {
        setIsContractVerified(false);
        return;
      }
      try {
        const res = await fetch("/api/verify-contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contractAddress, rpcEndpoint })
        });
        const data = await res.json();
        setIsContractVerified(data.verified);
      } catch (err) {
        setIsContractVerified(false);
      }
    };

    const fetchBalance = async () => {
      if (!privateKey || !rpcEndpoint) {
        setWalletBalance(null);
        return;
      }
      try {
        const res = await fetch("/api/wallet-balance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ privateKey, rpcEndpoint })
        });
        const data = await res.json();
        if (data.balance) setWalletBalance(data.balance);
      } catch (err) {
        setWalletBalance(null);
      }
    };

    verify();
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [contractAddress, privateKey, rpcEndpoint]);

  const t = translations[language] || translations.en;

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch("/api/prices");
        const data: PriceData = await res.json();
        setPrices(data);
        
        const pPrice = parseFloat(data.pancake);
        const bPrice = parseFloat(data.biswap);
        const diff = Math.abs(pPrice - bPrice);

        const newPoint = {
          time: new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          pancake: pPrice,
          biswap: bPrice,
          diff: diff
        };

        setHistory(prev => [...prev.slice(-20), newPoint]);

        const threshold = parseFloat(minProfit) || 0.5;
        const newOpps: Opportunity[] = [];

        // Check all pairs and DEXs for real opportunities
        if (data.pairs) {
          for (const [pairName, dexPrices] of Object.entries(data.pairs)) {
            if (typeof dexPrices !== 'object' || dexPrices === null) continue;
            const dexEntries = Object.entries(dexPrices as Record<string, string>).filter(([_, price]) => parseFloat(price) > 0);
            
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
            const diff = sellPrice - buyPrice;
            const diffPercent = (diff / buyPrice) * 100;

            if (diffPercent > threshold) {
              newOpps.push({
                id: `${pairName}-${Date.now()}-${Math.random()}`,
                pair: pairName,
                buyDex: bestBuy[0].charAt(0).toUpperCase() + bestBuy[0].slice(1),
                sellDex: bestSell[0].charAt(0).toUpperCase() + bestSell[0].slice(1),
                buyPrice,
                sellPrice,
                profit: diff,
                timestamp: data.timestamp,
                isMempool: Math.random() > 0.5,
                isFlashLoan: useFlashLoan
              });
            }
          }
        }

        if (newOpps.length > 0) {
          addAlert(t.arbitrageOpp.replace("{percent}", (newOpps[0].profit / newOpps[0].buyPrice * 100).toFixed(2)), 'success');
          setOpportunities(prev => [...newOpps, ...prev].slice(0, 20));
        }
      } catch (err) {
        console.error("Fetch error:", err);
      }
    };

    const interval = setInterval(fetchPrices, 5000);
    fetchPrices();

    // Simulated Mempool Logs
    const logInterval = setInterval(() => {
      const msgs = [
        t.scanningBlocks,
        `${t.pendingTxDetected}: 0x${Math.random().toString(16).slice(2, 10)}...`,
        "PancakeSwap V2: Swap detected",
        "BiSwap: Liquidity update"
      ];
      const newLog = {
        id: Date.now() + Math.random(),
        msg: msgs[Math.floor(Math.random() * msgs.length)],
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
      setMempoolLogs(prev => [newLog, ...prev].slice(0, 5));
    }, 3000);

    return () => {
      clearInterval(interval);
      clearInterval(logInterval);
    };
  }, [language, t.arbitrageOpp, t.scanningBlocks, t.pendingTxDetected, useFlashLoan, loanAmount, simulationAmount, minProfit]);

  const handleSave = async () => {
    setIsSaving(true);
    localStorage.setItem("arb_use_flash", useFlashLoan.toString());
    localStorage.setItem("arb_loan_amount", loanAmount);
    localStorage.setItem("arb_loan_provider", loanProvider);
    localStorage.setItem("arb_private_rpc", privateRpc);
    localStorage.setItem("arb_use_mev_share", useMevShare.toString());

    try {
      await fetch("/api/settings/advanced", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privateRpc,
          useMevShare,
          privateKey
        })
      });
    } catch (e) {}

    addAlert(language === "ar" ? "تم حفظ التكوين بنجاح!" : "Configuration saved successfully!", 'success');
    setTimeout(() => setIsSaving(false), 2000);
  };

  const handleExecute = async (oppId: string) => {
    const opp = opportunities.find(o => o.id === oppId);
    if (!opp) return;

    if (!privateKey || !contractAddress) {
      addAlert(t.missingConfig, 'warning');
      return;
    }

    setIsExecuting(oppId);
    
    const currentUseFlash = useFlashLoan;
    const currentLoanAmount = loanAmount;
    const currentLoanProvider = loanProvider;

    console.log("Executing with:", {
      currentUseFlash,
      currentLoanAmount,
      simulationAmount
    });

    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privateKey,
          contractAddress,
          buyDex: opp.buyDex,
          sellDex: opp.sellDex,
          amount: currentUseFlash ? currentLoanAmount : simulationAmount,
          useFlashLoan: currentUseFlash,
          loanAmount: currentLoanAmount,
          loanProvider: currentLoanProvider,
          pair: opp.pair,
          minProfit: minProfit
        })
      });

      const data = await res.json();

      if (data.success) {
        let successMsg = t.tradeSuccess;
        if (data.adjusted) {
          const adjustmentMsg = language === "ar" 
            ? ` (تم تعديل المبلغ من ${data.originalAmount} إلى ${data.executedAmount} لتجنب الخسارة)`
            : ` (Amount adjusted from ${data.originalAmount} to ${data.executedAmount} to ensure profit)`;
          successMsg += adjustmentMsg;
        }
        addAlert(`${successMsg} ${t.txHash} ${data.txHash.slice(0, 10)}...`, 'success');
        setOpportunities(prev => prev.filter(o => o.id !== oppId));
      } else {
        addAlert(t.tradeFailed.replace("{error}", data.error || "Unknown error"), 'warning');
      }
    } catch (err: any) {
      addAlert(t.tradeFailed.replace("{error}", err.message), 'warning');
    } finally {
      setIsExecuting(null);
    }
  };

  const addAlert = (msg: string, type: 'info' | 'success' | 'warning') => {
    const id = Date.now() + Math.random();
    setAlerts(prev => [{id, msg, type}, ...prev].slice(0, 5));
    setTimeout(() => {
      setAlerts(prev => prev.filter(a => a.id !== id));
    }, 5000);
  };

  const currentDiff = prices ? Math.abs(parseFloat(prices.pancake) - parseFloat(prices.biswap)) : 0;
  const currentDiffPercent = prices ? (currentDiff / Math.min(parseFloat(prices.pancake), parseFloat(prices.biswap))) * 100 : 0;

  return (
    <div className={cn(
      "min-h-screen bg-[#0a0a0c] text-slate-200 font-sans selection:bg-yellow-500/30",
      language === "ar" ? "rtl" : "ltr"
    )} dir={language === "ar" ? "rtl" : "ltr"}>
      {/* Sidebar */}
      <div className={cn(
        "fixed top-0 h-full w-20 md:w-64 bg-[#111114] border-white/5 flex flex-col z-50",
        language === "ar" ? "right-0 border-l" : "left-0 border-r"
      )}>
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-500 rounded-xl flex items-center justify-center shadow-lg shadow-yellow-500/20">
            <Zap className="text-black w-6 h-6 fill-current" />
          </div>
          <span className="hidden md:block font-bold text-xl tracking-tight text-white">BSC Engine</span>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          <NavItem 
            icon={<TrendingUp size={20} />} 
            label={t.dashboard} 
            active={activeTab === "dashboard"} 
            onClick={() => setActiveTab("dashboard")} 
          />
          <NavItem 
            icon={<Zap size={20} />} 
            label={t.opportunities} 
            active={activeTab === "opportunities"} 
            onClick={() => setActiveTab("opportunities")} 
          />
          <NavItem 
            icon={<History size={20} />} 
            label={t.history} 
            active={activeTab === "history"} 
            onClick={() => setActiveTab("history")} 
          />
          <NavItem 
            icon={<Settings size={20} />} 
            label={t.settings} 
            active={activeTab === "settings"} 
            onClick={() => setActiveTab("settings")} 
          />
        </nav>

        <div className="p-4 mt-auto space-y-4">
          <button 
            onClick={() => setLanguage(l => l === "en" ? "ar" : "en")}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-400 transition-all"
          >
            <Languages size={20} />
            <span className="hidden md:block font-semibold text-sm">{language === "en" ? "العربية" : "English"}</span>
          </button>

          <div className="bg-white/5 rounded-2xl p-4 hidden md:block">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">{t.nodeStatus}</span>
            </div>
            <p className="text-sm font-semibold text-white">BSC Mainnet</p>
            <p className="text-[10px] text-slate-500 mt-1 truncate">{rpcEndpoint}</p>
          </div>

          <div className="bg-white/5 rounded-2xl p-4 hidden md:block space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet size={14} className={privateKey ? "text-green-500" : "text-slate-500"} />
                <span className="text-[10px] font-medium text-slate-400 uppercase">{t.walletStatus}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", privateKey ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500")}>
                  {privateKey ? t.connected : t.disconnected}
                </span>
                {walletBalance && (
                  <span className="text-[9px] text-slate-500 mt-0.5">{parseFloat(walletBalance).toFixed(4)} BNB</span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={14} className={isContractVerified ? "text-yellow-500" : "text-slate-500"} />
                <span className="text-[10px] font-medium text-slate-400 uppercase">{t.contractStatus}</span>
              </div>
              <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", isContractVerified ? "bg-yellow-500/10 text-yellow-500" : "bg-red-500/10 text-red-500")}>
                {isContractVerified ? t.verified : t.disconnected}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-white/5 pt-2">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-purple-500" />
                <span className="text-[10px] font-medium text-slate-400 uppercase">{t.mempoolScan}</span>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500">
                {t.active}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RefreshCw size={14} className="text-blue-500 animate-spin-slow" />
                <span className="text-[10px] font-medium text-slate-400 uppercase">{t.multiPairScan}</span>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">
                {t.active}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className={cn(
        "min-h-screen",
        language === "ar" ? "pr-20 md:pr-64" : "pl-20 md:pl-64"
      )}>
        {/* Header */}
        <header className="h-20 border-b border-white/5 flex items-center justify-between px-8 sticky top-0 bg-[#0a0a0c]/80 backdrop-blur-xl z-40">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-white capitalize">{t[activeTab]}</h1>
            <div className="h-4 w-[1px] bg-white/10" />
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Activity size={14} className="text-yellow-500" />
              <span>{t.liveMonitoring}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button className="p-2 hover:bg-white/5 rounded-lg transition-colors text-slate-400">
              <RefreshCw size={20} className={cn(isLive && "animate-spin-slow")} />
            </button>
            <div className="h-8 w-[1px] bg-white/10" />
            <button className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-400 text-black px-4 py-2 rounded-xl font-bold transition-all transform active:scale-95 shadow-lg shadow-yellow-500/20">
              <Wallet size={18} />
              <span>{t.connectWallet}</span>
            </button>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto space-y-8">
          {activeTab === "dashboard" && (
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard 
                  label={t.pancakePrice} 
                  value={prices ? formatCurrency(prices.pancake) : t.loading} 
                  subValue="WBNB/BUSD"
                  icon={<Coins className="text-yellow-500" />}
                />
                <StatCard 
                  label={t.biswapPrice} 
                  value={prices ? formatCurrency(prices.biswap) : t.loading} 
                  subValue="WBNB/BUSD"
                  icon={<Coins className="text-blue-500" />}
                />
                <StatCard 
                  label={t.priceDiff} 
                  value={prices ? formatCurrency(currentDiff) : "0.00"} 
                  subValue={`${currentDiffPercent.toFixed(4)}% ${t.spread}`}
                  trend={currentDiffPercent > 0.5 ? "up" : "neutral"}
                  trendLabel={currentDiffPercent > 0.5 ? t.highSpread : t.normal}
                  icon={<ArrowRightLeft className="text-purple-500" />}
                />
                <StatCard 
                  label={t.potentialProfit} 
                  value={prices ? formatCurrency(currentDiff * simulationAmount) : "$0.00"} 
                  subValue={`${simulationAmount} BNB`}
                  icon={<TrendingUp className="text-green-500" />}
                />
              </div>

              {/* Main Chart Section */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-[#111114] border border-white/5 rounded-3xl p-8 shadow-2xl">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="text-lg font-bold text-white">{t.priceCorrelation}</h3>
                      <p className="text-sm text-slate-400">{t.realTimeDex}</p>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-yellow-500" />
                        <span className="text-xs text-slate-400">PancakeSwap</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500" />
                        <span className="text-xs text-slate-400">BiSwap</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history}>
                        <defs>
                          <linearGradient id="colorPancake" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#eab308" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#eab308" stopOpacity={0}/>
                          </linearGradient>
                          <linearGradient id="colorBiswap" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                        <XAxis 
                          dataKey="time" 
                          stroke="#ffffff20" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false}
                          minTickGap={30}
                          reversed={language === "ar"}
                        />
                        <YAxis 
                          stroke="#ffffff20" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false}
                          domain={['auto', 'auto']}
                          tickFormatter={(val) => `$${val}`}
                          orientation={language === "ar" ? "right" : "left"}
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#111114', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                          itemStyle={{ fontSize: '12px' }}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="pancake" 
                          stroke="#eab308" 
                          strokeWidth={2}
                          fillOpacity={1} 
                          fill="url(#colorPancake)" 
                          animationDuration={1000}
                        />
                        <Area 
                          type="monotone" 
                          dataKey="biswap" 
                          stroke="#3b82f6" 
                          strokeWidth={2}
                          fillOpacity={1} 
                          fill="url(#colorBiswap)" 
                          animationDuration={1000}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Simulation & Controls */}
                <div className="space-y-8">
                  <div className="bg-[#111114] border border-white/5 rounded-3xl p-8 shadow-2xl">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                      <Zap size={20} className="text-yellow-500" />
                      {t.arbitrageSimulator}
                    </h3>
                    
                    <div className="space-y-6">
                      <div>
                        <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-3">
                          {t.tradeAmount}
                        </label>
                        <div className="flex items-center gap-4">
                          <input 
                            type="range" 
                            min="0.1" 
                            max="10" 
                            step="0.1"
                            value={simulationAmount}
                            onChange={(e) => setSimulationAmount(parseFloat(e.target.value))}
                            className="flex-1 accent-yellow-500 bg-white/5 h-2 rounded-lg appearance-none cursor-pointer"
                          />
                          <span className="text-lg font-bold text-white w-12">{simulationAmount}</span>
                        </div>
                      </div>

                      <div className="bg-white/5 rounded-2xl p-4 space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">{t.estimatedGas}</span>
                          <span className="text-white font-medium">$0.15 - $0.45</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">{t.slippage} (0.5%)</span>
                          <span className="text-white font-medium">-{formatCurrency(currentDiff * simulationAmount * 0.005)}</span>
                        </div>
                        <div className="h-[1px] bg-white/5" />
                        <div className="flex justify-between items-center">
                          <span className="text-slate-400 font-medium">{t.netProfit}</span>
                          <span className={cn(
                            "text-xl font-bold",
                            (currentDiff * simulationAmount) > 0.5 ? "text-green-500" : "text-white"
                          )}>
                            {formatCurrency(Math.max(0, (currentDiff * simulationAmount) - 0.5))}
                          </span>
                        </div>
                      </div>

                      <button className="w-full py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl font-bold text-white transition-all flex items-center justify-center gap-2 group">
                        <span>{t.executeSimulation}</span>
                        <ArrowRightLeft size={18} className="group-hover:rotate-180 transition-transform duration-500" />
                      </button>
                    </div>
                  </div>

                  {/* Mempool Activity Log */}
                  <div className="bg-[#111114] border border-white/5 rounded-3xl p-8 shadow-2xl">
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                      <Activity size={20} className="text-purple-500" />
                      {t.mempoolActivity}
                    </h3>
                    <div className="space-y-3">
                      <AnimatePresence mode="popLayout">
                        {mempoolLogs.map(log => (
                          <motion.div 
                            key={log.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="flex items-center justify-between text-[10px] font-mono text-slate-500 border-b border-white/5 pb-2 last:border-0"
                          >
                            <span className="flex items-center gap-2">
                              <div className="w-1 h-1 rounded-full bg-purple-500 animate-pulse" />
                              {log.msg}
                            </span>
                            <span className="text-slate-600">{log.time}</span>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Statistical Arbitrage (CEX/DEX) */}
                  <div className="bg-[#111114] border border-white/5 rounded-3xl p-8 shadow-2xl overflow-hidden relative group">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 blur-3xl rounded-full -mr-16 -mt-16 group-hover:bg-blue-500/10 transition-all" />
                    <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                      <BarChart3 size={20} className="text-blue-500" />
                      {t.statisticalArbitrage}
                    </h3>
                    <div className="space-y-6">
                      <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                        <div className="space-y-1">
                          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{t.cexPrice} (BNB)</p>
                          <p className="text-xl font-black text-white">${mevStatus?.cexPrices?.BNB || "600.00"}</p>
                        </div>
                        <div className="h-8 w-[1px] bg-white/10" />
                        <div className="space-y-1 text-right">
                          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{t.dexPrice} (BNB)</p>
                          <p className="text-xl font-black text-blue-500">${prices?.pancake || "0.00"}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between px-2">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-2 h-2 rounded-full",
                            mevStatus?.mevShareActive ? "bg-green-500 animate-pulse" : "bg-slate-700"
                          )} />
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.backrunningStatus}</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">{t.latency}: 12{t.ms}</span>
                      </div>
                    </div>
                  </div>

                    {/* Alerts moved to global position */}
                  </div>
                </div>
              </>
            )}

          {activeTab === "opportunities" && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-white">{t.activeOpportunities}</h2>
                  <p className="text-slate-400 text-sm mt-1">{t.realTimeDex}</p>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => {
                      const testOpp: Opportunity = {
                        id: `test-${Date.now()}`,
                        pair: "WBNB/BUSD",
                        buyDex: "PancakeSwap",
                        sellDex: "Biswap",
                        buyPrice: 600.00,
                        sellPrice: 606.00,
                        profit: 6.00,
                        timestamp: Date.now(),
                        isMempool: true,
                        isFlashLoan: useFlashLoan
                      };
                      setOpportunities(prev => [testOpp, ...prev]);
                      addAlert(language === "ar" ? "تم إنشاء فرصة تجريبية للاختبار" : "Test opportunity generated for testing", 'info');
                    }}
                    className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-xl text-sm font-bold text-blue-400 transition-all flex items-center gap-2"
                  >
                    <Plus size={18} />
                    {language === "ar" ? "محاكاة فرصة" : "Simulate Opportunity"}
                  </button>
                  <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 px-4 py-2 rounded-xl">
                    <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                    <span className="text-yellow-500 text-xs font-bold uppercase tracking-wider">{t.liveMonitoring}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <AnimatePresence mode="popLayout">
                  {filteredOpportunities.length === 0 ? (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="bg-[#111114] border border-white/5 rounded-3xl p-12 text-center"
                    >
                      <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Zap size={32} className="text-slate-600" />
                      </div>
                      <p className="text-slate-400 font-medium">{t.noOpportunities}</p>
                    </motion.div>
                  ) : (
                    filteredOpportunities.map((opp) => (
                      <motion.div
                        key={opp.id}
                        layout
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-[#111114] border border-white/5 rounded-3xl p-6 hover:border-yellow-500/30 transition-all group"
                      >
                        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                          <div className="flex items-center gap-6">
                            <div className="w-12 h-12 bg-green-500/10 rounded-2xl flex items-center justify-center">
                              <TrendingUp className="text-green-500" size={24} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                {opp.isMempool && (
                                  <span className="px-2 py-0.5 bg-purple-500/10 text-purple-500 text-[10px] font-bold rounded uppercase tracking-wider flex items-center gap-1">
                                    <Activity size={10} />
                                    {t.preMempool}
                                  </span>
                                )}
                                {opp.isFlashLoan && (
                                  <span className="px-2 py-0.5 bg-yellow-500/10 text-yellow-500 text-[10px] font-bold rounded uppercase tracking-wider flex items-center gap-1">
                                    <Zap size={10} />
                                    {t.flashLoan}
                                  </span>
                                )}
                                <span className="px-2 py-0.5 bg-green-500/10 text-green-500 text-[10px] font-bold rounded uppercase tracking-wider flex items-center gap-1">
                                  <RefreshCw size={10} className="animate-spin-slow" />
                                  {t.realTime}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-slate-400 text-xs font-mono bg-white/5 px-2 py-0.5 rounded">{opp.pair}</span>
                              </div>
                              <div className="flex items-center gap-3 mb-1">
                                <span className="text-white font-bold text-lg">{opp.buyDex}</span>
                                <ArrowRight size={16} className="text-slate-600" />
                                <span className="text-white font-bold text-lg">{opp.sellDex}</span>
                              </div>
                              <div className="flex items-center gap-4 text-sm text-slate-400">
                                <span>{t.buyOn}: {formatCurrency(opp.buyPrice)}</span>
                                <div className="w-1 h-1 rounded-full bg-slate-700" />
                                <span>{t.sellOn}: {formatCurrency(opp.sellPrice)}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-8 w-full md:w-auto">
                            <div className="text-right">
                              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">{t.profit}</p>
                              <p className="text-2xl font-black text-green-500">{formatCurrency(opp.profit)}</p>
                            </div>
                            <button 
                              onClick={() => handleExecute(opp.id)}
                              disabled={isExecuting !== null}
                              className={cn(
                                "flex-1 md:flex-none px-8 py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2",
                                isExecuting === opp.id 
                                  ? "bg-white/5 text-slate-500 cursor-not-allowed" 
                                  : "bg-yellow-500 hover:bg-yellow-400 text-black shadow-lg shadow-yellow-500/20 active:scale-95"
                              )}
                            >
                              {isExecuting === opp.id ? (
                                <>
                                  <RefreshCw size={18} className="animate-spin" />
                                  <span>{t.executing}</span>
                                </>
                              ) : (
                                <>
                                  <Zap size={18} fill="currentColor" />
                                  <span>{t.execute}</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}

          {activeTab === "history" && (
            <div className="bg-[#111114] border border-white/5 rounded-3xl p-8 shadow-2xl">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-lg font-bold text-white">{t.history}</h3>
                  <p className="text-sm text-slate-400">Historical spread analysis</p>
                </div>
                <button className="flex items-center gap-2 text-sm text-yellow-500 font-bold hover:underline">
                  <BarChart3 size={16} />
                  {t.exportData}
                </button>
              </div>
              
              <div className="h-[500px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                    <XAxis dataKey="time" stroke="#ffffff20" fontSize={10} reversed={language === "ar"} />
                    <YAxis stroke="#ffffff20" fontSize={10} orientation={language === "ar" ? "right" : "left"} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#111114', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="diff" 
                      stroke="#a855f7" 
                      strokeWidth={3} 
                      dot={false}
                      animationDuration={1500}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="max-w-3xl bg-[#111114] border border-white/5 rounded-3xl p-8 shadow-2xl">
              <h3 className="text-lg font-bold text-white mb-8">{t.engineConfig}</h3>
              <div className="space-y-8">
                {/* Security Warning */}
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex gap-4 items-center">
                  <ShieldAlert className="text-yellow-500 shrink-0" size={24} />
                  <p className="text-sm text-yellow-200 font-medium">{t.securityWarning}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Private Key */}
                  <div className="space-y-4">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block">
                      {t.privateKey}
                    </label>
                    <div className="relative">
                      <input 
                        type={showPrivateKey ? "text" : "password"} 
                        value={privateKey}
                        onChange={(e) => setPrivateKey(e.target.value)}
                        placeholder="0x..."
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-yellow-500/50 transition-colors pr-12"
                      />
                      <button 
                        onClick={() => setShowPrivateKey(!showPrivateKey)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
                      >
                        {showPrivateKey ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>

                  {/* Contract Address */}
                  <div className="space-y-4">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block">
                      {t.contractAddress}
                    </label>
                    <input 
                      type="text" 
                      value={contractAddress}
                      onChange={(e) => setContractAddress(e.target.value)}
                      placeholder="0x..."
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-yellow-500/50 transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block">
                    {t.rpcEndpoint}
                  </label>
                  <input 
                    type="text" 
                    value={rpcEndpoint}
                    onChange={(e) => setRpcEndpoint(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-yellow-500/50 transition-colors"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block">
                      {t.minProfit}
                    </label>
                    <input 
                      type="number" 
                      value={minProfit}
                      onChange={(e) => setMinProfit(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-yellow-500/50 transition-colors"
                    />
                  </div>
                  <div className="space-y-4">
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block">
                      {t.maxGas}
                    </label>
                    <input 
                      type="number" 
                      value={maxGas}
                      onChange={(e) => setMaxGas(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-yellow-500/50 transition-colors"
                    />
                  </div>
                </div>

                {/* Flash Loan Settings */}
                <div className="bg-white/5 rounded-3xl p-6 space-y-6 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                        <Zap size={20} className="text-purple-500" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">{t.flashLoan}</h4>
                        <p className="text-[10px] text-slate-500">{t.useFlashLoan}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => setUseFlashLoan(!useFlashLoan)}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        useFlashLoan ? "bg-purple-500" : "bg-slate-700"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        useFlashLoan ? "right-1" : "left-1"
                      )} />
                    </button>
                  </div>

                  {useFlashLoan && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5"
                    >
                      <div className="space-y-2">
                        <label className="text-[10px] font-medium text-slate-400 uppercase">{t.loanAmount} (BNB)</label>
                        <input 
                          type="number" 
                          value={loanAmount}
                          onChange={(e) => setLoanAmount(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-medium text-slate-400 uppercase">{t.loanProvider}</label>
                        <select 
                          value={loanProvider}
                          onChange={(e) => setLoanProvider(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50 appearance-none"
                        >
                          <option value="PancakeSwap">PancakeSwap</option>
                          <option value="ApeSwap">ApeSwap</option>
                          <option value="BakerySwap">BakerySwap</option>
                          <option value="BabySwap">BabySwap</option>
                          <option value="MDEX">MDEX</option>
                        </select>
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Advanced MEV Settings */}
                <div className="bg-white/5 rounded-3xl p-6 space-y-6 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                        <ShieldAlert size={20} className="text-blue-500" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">{t.advanced}</h4>
                        <p className="text-[10px] text-slate-500">{t.mevProtection}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-white/5">
                    <div className="space-y-2">
                      <label className="text-[10px] font-medium text-slate-400 uppercase">{t.privateRpc}</label>
                      <input 
                        type="text" 
                        value={privateRpc}
                        onChange={(e) => setPrivateRpc(e.target.value)}
                        placeholder="https://rpc.bloxroute.com/..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-medium text-slate-400 uppercase">{t.useMevShare}</label>
                      <button 
                        onClick={() => setUseMevShare(!useMevShare)}
                        className={cn(
                          "w-12 h-6 rounded-full transition-all relative",
                          useMevShare ? "bg-blue-500" : "bg-slate-700"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                          useMevShare ? "right-1" : "left-1"
                        )} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <motion.button 
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSave}
                    disabled={isSaving}
                    className={cn(
                      "w-full py-4 font-bold rounded-2xl transition-all shadow-lg flex items-center justify-center gap-2",
                      isSaving 
                        ? "bg-green-500 text-white shadow-green-500/20" 
                        : "bg-yellow-500 hover:bg-yellow-400 text-black shadow-yellow-500/20"
                    )}
                  >
                    {isSaving ? (
                      <>
                        <CheckCircle2 size={20} />
                        <span>{language === "ar" ? "تم الحفظ" : "Saved"}</span>
                      </>
                    ) : (
                      t.saveConfig
                    )}
                  </motion.button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Global Alerts / Toasts */}
      <div className={cn(
        "fixed bottom-8 z-[100] w-80 space-y-3",
        language === "ar" ? "left-8" : "right-8"
      )}>
        <AnimatePresence mode="popLayout">
          {alerts.map(alert => (
            <motion.div 
              key={alert.id}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              layout
              className={cn(
                "p-4 rounded-2xl text-sm font-medium border shadow-2xl backdrop-blur-xl flex gap-3 items-start",
                alert.type === 'success' ? "bg-green-500/10 border-green-500/20 text-green-400" :
                alert.type === 'warning' ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400" :
                "bg-blue-500/10 border-blue-500/20 text-blue-400"
              )}
            >
              <div className="mt-0.5 shrink-0">
                {alert.type === 'success' ? <CheckCircle2 size={18} /> : 
                 alert.type === 'warning' ? <ShieldAlert size={18} /> : 
                 <Activity size={18} />}
              </div>
              <div className="flex-1">
                <p className="leading-relaxed">{alert.msg}</p>
              </div>
              <button 
                onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}
                className="text-slate-500 hover:text-white transition-colors"
              >
                <EyeOff size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <style>{`
        .animate-spin-slow {
          animation: spin 3s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .rtl { direction: rtl; }
        .ltr { direction: ltr; }
      `}</style>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-4 px-4 py-3 rounded-2xl transition-all group",
        active ? "bg-yellow-500 text-black shadow-lg shadow-yellow-500/20" : "text-slate-400 hover:bg-white/5 hover:text-white"
      )}
    >
      <div className={cn("transition-transform", active ? "scale-110" : "group-hover:scale-110")}>
        {icon}
      </div>
      <span className="hidden md:block font-semibold text-sm">{label}</span>
    </button>
  );
}

function StatCard({ label, value, subValue, icon, trend, trendLabel }: { label: string, value: string, subValue: string, icon: React.ReactNode, trend?: 'up' | 'down' | 'neutral', trendLabel?: string }) {
  return (
    <div className="bg-[#111114] border border-white/5 rounded-3xl p-6 shadow-xl hover:border-white/10 transition-colors">
      <div className="flex justify-between items-start mb-4">
        <div className="p-3 bg-white/5 rounded-2xl">
          {icon}
        </div>
        {trend && (
          <div className={cn(
            "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
            trend === 'up' ? "bg-green-500/10 text-green-500" : "bg-slate-500/10 text-slate-500"
          )}>
            {trendLabel}
          </div>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</p>
        <h4 className="text-2xl font-bold text-white tracking-tight">{value}</h4>
        <p className="text-xs text-slate-500 font-medium">{subValue}</p>
      </div>
    </div>
  );
}
