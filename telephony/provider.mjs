/**
 * CALLFORGE AI — telephony provider port (M05 / TECH-015)
 *
 * The sink behind `call.dial` must not know which carrier answers. A provider is
 * an object with `name` and an async `dial()` that either resolves to a handle
 * (`{ providerRef }`) or throws. Contract requirements for any adapter:
 *
 * - `dial()` MUST be treated as idempotent on `idempotencyKey` (the dial request
 *   id) so an at-least-once redelivery does not place a second call; a provider
 *   that cannot honour that must still be safe because the sink also guards on
 *   the attempt row.
 * - `dial()` MUST throw on a definite rejection (carrier refused, auth error) so
 *   the outbox retries with backoff; it must not resolve a fake success.
 * - No live call is placed unless the owner enables a provider that reaches a
 *   carrier; `simulated` is deliberately inert and is the default.
 *
 * Resolution is fail-closed: an unknown `CALLFORGE_TELEPHONY_PROVIDER` throws at
 * dispatch time (the outbox row retries) instead of silently falling back.
 */
import { simulatedProvider } from './simulatedProvider.mjs';

const PROVIDERS = new Map([[simulatedProvider.name, simulatedProvider]]);

export class UnknownProviderError extends Error {}
export class ProviderRejectedError extends Error {}

export const DEFAULT_PROVIDER = 'simulated';

/** Register an adapter. Re-registering a name replaces it (tests, later carriers). */
export function registerProvider(provider) {
  if (!provider?.name || typeof provider.dial !== 'function') {
    throw new TypeError('provider needs a name and a dial() function');
  }
  PROVIDERS.set(provider.name, provider);
  return provider;
}

export function providerNames() {
  return [...PROVIDERS.keys()].sort();
}

/** @param {string} [name] defaults to `CALLFORGE_TELEPHONY_PROVIDER` then `simulated` */
export function resolveProvider(
  name = process.env.CALLFORGE_TELEPHONY_PROVIDER ?? DEFAULT_PROVIDER,
) {
  const provider = PROVIDERS.get(name);
  if (!provider) {
    throw new UnknownProviderError(
      `unknown telephony provider "${name}" (known: ${providerNames().join(', ')})`,
    );
  }
  return provider;
}
