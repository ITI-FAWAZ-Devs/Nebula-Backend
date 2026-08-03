/**
 * Runs an async operation with an abort timeout. When the timeout elapses the
 * caller's AbortSignal fires (aborting any in-flight fetch) and the promise
 * rejects with a `TimeoutError` (code `ABORT_ERR`) so the fallback classifier
 * treats it as transient and the provider chain can fall through.
 */
export async function withAbortSignal<T>(
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error(
        `Provider request timed out after ${timeoutMs}ms`,
      ) as Error & { name: string; code: string };
      timeout.name = 'TimeoutError';
      timeout.code = 'ABORT_ERR';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
