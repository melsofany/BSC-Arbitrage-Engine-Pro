// rpcThrottler.ts

/**
 * Implements exponential backoff retry logic with request batching.
 * This utility is to rate limit RPC requests by batching and delaying them.
 */

class RpcThrottler {
    private static MAX_RETRIES = 5;
    private static INITIAL_DELAY_MS = 100;

    static async batchRequests<T>(requests: () => Promise<T>[], batchSize: number): Promise<T[]> {
        const results: T[] = [];
        for (let i = 0; i < requests.length; i += batchSize) {
            const batch = requests.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(req => this.executeWithRetry(req)));
            results.push(...batchResults);
        }
        return results;
    }

    private static async executeWithRetry<T>(requestFn: () => Promise<T>, attempts = 0): Promise<T> {
        try {
            return await requestFn();
        } catch (error) {
            if (attempts < this.MAX_RETRIES) {
                const delay = this.getExponentialBackoffDelay(attempts);
                await this.delay(delay);
                return this.executeWithRetry(requestFn, attempts + 1);
            }
            throw error;  // Rethrow after max retries
        }
    }

    private static getExponentialBackoffDelay(attempts: number): number {
        return this.INITIAL_DELAY_MS * Math.pow(2, attempts);
    }

    private static delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export default RpcThrottler;
