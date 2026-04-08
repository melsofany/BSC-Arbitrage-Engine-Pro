import { OpenAI } from "openai";

// Initialize OpenAI client only if API key is provided
const apiKey = process.env.OPENAI_API_KEY;
let client: OpenAI | null = null;

if (apiKey) {
  client = new OpenAI({
    apiKey: apiKey,
    baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  });
  console.log("🤖 AI Analyzer initialized with OpenAI/DeepSeek");
} else {
  console.warn("⚠️ AI Analyzer: OPENAI_API_KEY is missing. AI features will be disabled, but the server will continue to run.");
}

export interface MarketState {
  pairs: Record<string, Record<string, string>>;
  mempoolActivity: string[];
  cexPrices: Record<string, string>;
}

export async function analyzeOpportunitiesWithAI(state: MarketState) {
  if (!client) {
    // Return empty if AI is not configured
    return [];
  }

  try {
    const prompt = `
    Analyze the following BSC market state for arbitrage opportunities.
    Market Data: ${JSON.stringify(state.pairs)}
    Mempool Activity: ${state.mempoolActivity.join(", ")}
    CEX Prices: ${JSON.stringify(state.cexPrices)}

    Task:
    1. Identify pairs with price discrepancies > 0.1%.
    2. Predict if a pending transaction in mempool will create a larger spread.
    3. Suggest the best path (Direct or Triangular).
    4. Estimate if the profit will cover gas fees (approx 0.005 BNB).

    Return a JSON array of objects with: {pair, buyDex, sellDex, expectedProfitPct, reason, type: 'direct'|'triangular'}.
    Only return the JSON array, no other text.
    `;

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: "You are an expert MEV and Arbitrage analyst on BSC." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    return content ? JSON.parse(content).opportunities : [];
  } catch (error) {
    console.error("AI Analysis failed:", error);
    return [];
  }
}
