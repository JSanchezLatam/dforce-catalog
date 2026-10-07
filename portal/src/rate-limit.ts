const LIMIT = 30;
const WINDOW_MS = 60_000;

// ponytail: per serverless instance, so best-effort — it resets on cold start and
// each Vercel instance counts alone. Upgrade to Vercel Firewall rules or a DB counter
// if abuse appears. 256-bit tokens make guessing infeasible; this only limits noise.
const buckets = new Map<string, { start: number; count: number }>();

/** True when this request is over the limit. Keyed by the first x-forwarded-for hop. */
export function rateLimited(request: Request, now = Date.now()): boolean {
  const key = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  for (const [k, b] of buckets) if (now - b.start >= WINDOW_MS) buckets.delete(k);
  const bucket = buckets.get(key);
  if (!bucket) {
    buckets.set(key, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > LIMIT;
}
