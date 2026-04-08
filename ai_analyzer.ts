import { OpenAI } from "openai";

// Initialize OpenAI client for DeepSeek
// Note: DeepSeek uses an OpenAI-compatible API
const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1";

let client: OpenAI | null = null;

if (apiKey) {
  client = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL
  });
  console.log(`🤖 AI Analyzer: DeepSeek Engine Activated (BaseURL: ${baseURL})`);
} else {
  console.warn("⚠️ AI Analyzer: DEEPSEEK_API_KEY is missing. AI features disabled.");
}

export interface MarketState {
  pairs: Record<string, Record<string, string>>;
  mempoolActivity: string[];
  cexPrices: Record<string, string>;
}

export async function analyzeOpportunitiesWithAI(state: MarketState) {
  if (!client) return [];

  try {
    const prompt = `
    You are a high-frequency MEV and Arbitrage expert on Binance Smart Chain (BSC).
    Analyze the current market state and identify profitable arbitrage opportunities.

    MARKET DATA (DEX Prices):
    ${JSON.stringify(state.pairs, null, 2)}

    CEX REFERENCE PRICES:
    ${JSON.stringify(state.cexPrices, null, 2)}

    MEMPOOL ACTIVITY:
    ${state.mempoolActivity.length > 0 ? state.mempoolActivity.join(", ") : "No significant pending swaps detected."}

    GOAL:
    1. Find price discrepancies between DEXs (Pancake, Biswap, ApeSwap, etc.) > 0.05%.
    2. Identify potential Triangular Arbitrage paths (e.g., BNB -> BUSD -> USDT -> BNB).
    3. Cross-reference with CEX prices to ensure the DEX price isn't just lagging or manipulated.
    4. Account for BSC gas fees (approx 0.003 - 0.005 BNB).

    OUTPUT FORMAT:
    Return ONLY a JSON object with an "opportunities" array. Each object must have:
    {
      "pair": "Token/BNB",
      "buyDex": "DEX Name",
      "sellDex": "DEX Name",
      "expectedProfitPct": number,
      "reason": "Short explanation of why this is profitable",
      "type": "direct" | "triangular"
    }
    `;

    const response = await client.chat.completions.create({
      model: "deepseek-chat", // Default DeepSeek model
      messages: [
        { role: "system", content: "You are a professional BSC Arbitrage Bot Assistant. Output only valid JSON." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    if (!content) return [];
    
    const parsed = JSON.parse(content);
    return parsed.opportunities || [];
  } catch (error: any) {
    console.error("DeepSeek Analysis failed:", error.message);
    return [];
  }
}
