import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_INTERCEPT_KEY = 'skipResponseIntercept';

/**
 * Marks a route as raw output (e.g. SSE). The global ResponseInterceptor
 * will pass the response through untouched instead of wrapping it in
 * `{ success, message, data }`.
 */
export const SkipResponseIntercept = () =>
  SetMetadata(SKIP_RESPONSE_INTERCEPT_KEY, true);
