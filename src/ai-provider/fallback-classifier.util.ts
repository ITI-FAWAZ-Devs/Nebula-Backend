/**
 * Decides whether a provider error qualifies for falling back to the next
 * provider in the chain.
 *
 * Falls back on:
 *  - request timeouts
 *  - provider/server 5xx errors
 *  - throttling / rate-limit errors
 *  - transient network errors
 *  - `NotImplementedException` (reserved; was thrown by the Bedrock gateway
 *    LLM stub while the chat endpoint shape was unconfirmed)
 *
 * Does NOT fall back on:
 *  - input validation errors (caller bug; retrying elsewhere won't fix it)
 *  - content-policy rejections (caller bug / prompt issue)
 *  - auth / configuration errors (masking a misconfiguration is worse than
 *    failing loudly)
 */
const TRANSIENT_ERROR_NAMES = new Set([
  'ThrottlingException',
  'ThrottledException',
  'SlowDown',
  'ServiceUnavailableException',
  'ServiceUnavailable',
  'InternalServerException',
  'InternalServerError',
  'ModelTimeoutException',
  'ModelNotReadyException',
  'RequestTimeout',
  'RequestTimeoutException',
  'TimeoutError',
  'ConnectTimeoutError',
  'SocketTimeoutError',
  'NetworkingError',
  'AbortError',
  'NotImplementedException',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
]);

const TRANSIENT_ERROR_CODES = new Set([
  'ABORT_ERR',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
  'ERR_HTTP2_STREAM_ERROR',
]);

export function isTransientFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const name = typeof err.name === 'string' ? err.name : '';
  const code = typeof err.code === 'string' ? err.code : '';
  const message = typeof err.message === 'string' ? err.message : '';

  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof err.statusCode === 'number'
        ? err.statusCode
        : typeof err.$metadata?.httpStatusCode === 'number'
          ? err.$metadata.httpStatusCode
          : undefined;

  if (TRANSIENT_ERROR_NAMES.has(name)) return true;
  if (TRANSIENT_ERROR_CODES.has(code)) return true;

  if (typeof status === 'number') {
    if (status >= 500) return true;
    if (status === 429 || status === 408) return true;
    if (status === 400 || status === 401 || status === 403) return false;
  }

  if (code.startsWith('E') && /^(E[A-Z]+)$/i.test(code)) return true;

  const lower = message.toLowerCase();
  if (
    /throttl|rate\s*limit|slow\s*down|temporarily\s*(unavailable|failed)|service\s*unavailable|timed?\s*out|socket\s*hang\s*up|fetch\s*failed|network\s*(error|failure|timeout)|connection\s*(reset|refused|closed|timed\s*out)/.test(
      lower,
    )
  ) {
    return true;
  }

  return false;
}
