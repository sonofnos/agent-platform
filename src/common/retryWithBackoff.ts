/**
 * Bounded retry with jittered exponential backoff, for transient upstream failures
 * (free-tier LLM providers return 503 under load routinely -- this isn't hypothetical,
 * it was hit live against Gemini's flash-latest alias during setup).
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, isRetryable: (err: unknown) => boolean, maxAttempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxAttempts) throw err;
      const delayMs = 200 * 2 ** (attempt - 1) + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
