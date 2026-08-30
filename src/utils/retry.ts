import { config } from "../config/defaults";
import { logger } from "./logger";

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = config.retryLimit,
  delayMs = config.retryDelayMs
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        logger.success("retry", `${label} succeeded on attempt ${attempt}`);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt <= maxRetries) {
        logger.warn("retry", `${label} failed (attempt ${attempt}/${maxRetries + 1}): ${lastError.message} — retrying in ${delayMs}ms`);
        await sleep(delayMs * attempt); // exponential-ish backoff
      } else {
        logger.error("retry", `${label} failed after ${maxRetries + 1} attempts: ${lastError.message}`);
      }
    }
  }

  throw lastError!;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
