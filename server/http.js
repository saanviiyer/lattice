// Shared helpers for polite upstream access: a short in-memory cache, a serialized
// request queue with a minimum interval between calls, and a descriptive User-Agent.
// Used by the CrossRef and arXiv metadata clients so we stay within their guidelines.

export const USER_AGENT =
  "lattice/1.0 (research knowledge workspace; mailto:hello@lattice.app)";

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// One cache + one queue per named upstream, so CrossRef and arXiv don't share limits.
const caches = new Map(); // name -> Map(key -> { at, data })
const queues = new Map(); // name -> { chain, lastAt, minIntervalMs }

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cacheFor(name) {
  if (!caches.has(name)) caches.set(name, new Map());
  return caches.get(name);
}

export function cacheGet(name, key) {
  const hit = cacheFor(name).get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  return null;
}

export function cacheSet(name, key, data) {
  cacheFor(name).set(key, { at: Date.now(), data });
}

// Serialize upstream calls for `name` through a queue, spacing them out politely.
export function rateLimited(name, minIntervalMs, fn) {
  if (!queues.has(name)) {
    queues.set(name, { chain: Promise.resolve(), lastAt: 0, minIntervalMs });
  }
  const q = queues.get(name);
  q.minIntervalMs = minIntervalMs;

  const run = q.chain.then(async () => {
    const wait = q.minIntervalMs - (Date.now() - q.lastAt);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      q.lastAt = Date.now();
    }
  });

  // Keep the chain alive even if this call rejects.
  q.chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// An upstream that says it is overloaded gets left alone for a while. Asking again
// straight away is what turns a brief rate limit into a long one, and arXiv in
// particular counts every request from a network against the same allowance.
const cooldowns = new Map(); // name -> timestamp before which the upstream is left alone

export function coolDown(name, ms) {
  const until = Date.now() + Math.max(0, ms);
  cooldowns.set(name, Math.max(cooldowns.get(name) || 0, until));
}

/** Milliseconds until `name` should be asked again; 0 when it is fine to ask now. */
export function cooldownRemaining(name) {
  return Math.max(0, (cooldowns.get(name) || 0) - Date.now());
}

export function clearCooldown(name) {
  cooldowns.delete(name);
}

export function decodeEntities(s = "") {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

export function clean(s = "") {
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}
