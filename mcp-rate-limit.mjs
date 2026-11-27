/**
 * CALLFORGE AI — M09 remote MCP rate limiting (design §6)
 *
 * In-memory token bucket, keyed by tenant (or client IP when the endpoint is
 * anonymous). Two independent buckets: one coarse per-caller bucket on every
 * POST /mcp, and a tighter per-caller/per-tool bucket for the expensive tools.
 * Both are opt-out via the limit being 0 and both are restart-volatile by
 * design — the limiter protects the process, not the cluster.
 */

const SWEEP_INTERVAL_MS = 60_000;

export const EXPENSIVE_TOOLS = new Set(['simulate_call', 'list_history', 'generate_report']);

/**
 * @param {object} opts
 * @param {number} opts.limit        tokens per window (0 disables)
 * @param {number} [opts.windowMs]   refill window
 * @param {() => number} [opts.now]  clock injection for tests
 */
export function createTokenBucket({ limit, windowMs = 60_000, now = Date.now }) {
  const capacity = limit;
  const refillPerMs = limit / windowMs;
  const buckets = new Map();
  let lastSweep = now();

  function bucketFor(key) {
    const at = now();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, stamp: at };
      buckets.set(key, bucket);
    } else {
      bucket.tokens = Math.min(capacity, bucket.tokens + (at - bucket.stamp) * refillPerMs);
      bucket.stamp = at;
    }
    // Drop buckets that have refilled fully; nothing to remember about them.
    if (at - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = at;
      for (const [k, b] of buckets) {
        if (b !== bucket && b.tokens + (at - b.stamp) * refillPerMs >= capacity) {
          buckets.delete(k);
        }
      }
    }
    return bucket;
  }

  return {
    enabled: capacity > 0,
    /** @returns {{allowed: boolean, retryAfter: number, remaining: number, limit: number}} */
    take(key) {
      if (!capacity) {
        return { allowed: true, retryAfter: 0, remaining: capacity, limit: capacity };
      }
      const bucket = bucketFor(key);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return {
          allowed: true,
          retryAfter: 0,
          remaining: Math.floor(bucket.tokens),
          limit: capacity,
        };
      }
      const deficit = 1 - bucket.tokens;
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil(deficit / refillPerMs / 1000)),
        remaining: 0,
        limit: capacity,
      };
    },
    reset() {
      buckets.clear();
    },
  };
}

/** Builds the two buckets from env (unset/0 disables). */
export function createRateLimits(env = process.env) {
  return {
    caller: createTokenBucket({
      limit: Number.parseInt(env.MCP_RATE_LIMIT_PER_MINUTE ?? '', 10) || 0,
    }),
    tool: createTokenBucket({
      limit: Number.parseInt(env.MCP_RATE_LIMIT_TOOL_PER_MINUTE ?? '', 10) || 0,
    }),
  };
}

/** JSON-RPC body → expensive tool name, or null. */
export function expensiveToolOf(parsed) {
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  for (const entry of calls) {
    const name = entry?.params?.name;
    if (entry?.method === 'tools/call' && EXPENSIVE_TOOLS.has(name)) {
      return name;
    }
  }
  return null;
}
