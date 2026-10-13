import { createFetch, FetchError } from 'ofetch';
import { env } from './env.js';
import { showroomTarget, timedFetch } from './proxy-core.js';

export async function upstreamFetch(input, init = {}) {
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  const target = showroomTarget(url, env);
  const request = input instanceof Request ? new Request(target, input) : target;
  return timedFetch(request, init, fetch, Number(env.UPSTREAM_TIMEOUT_MS || 15000));
}
export const ofetch = createFetch({ fetch: upstreamFetch, Headers, AbortController });
export const $fetch = ofetch;
export { FetchError };
