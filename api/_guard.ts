// shared guard for the public functions: who is calling, and how often.
// on vercel the platform sets x-vercel-forwarded-for and x-real-ip from the connection and overwrites anything
// the client sent, so they are safe to key on. a client-supplied x-forwarded-for is never read.
export const clientIp = (req: Request): string =>
  req.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';

const EXTRA = (process.env.STROM_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** true when the call comes from the app's own pages (same origin), an allowed origin, or carries the shared key */
export function fromApp(req: Request): boolean {
  if (process.env.VERCEL !== '1') return true; // local dev
  const key = process.env.STROM_API_KEY;
  if (key && req.headers.get('x-strom-key') === key) return true;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    const o = new URL(origin);
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
    return o.host === host || EXTRA.includes(o.origin);
  } catch { return false; }
}

/** per-instance burst limit. the firewall rate rule on /api/* is the shared limit across instances */
export function limiter(perMin: number, perDay: number) {
  const hits = new Map<string, { n: number; t: number }>();
  let day = { d: '', n: 0 };
  return (ip: string): boolean => {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now - h.t > 60_000) hits.set(ip, { n: 1, t: now });
    else if (++h.n > perMin) return false;
    if (hits.size > 5_000) hits.clear();
    const d = new Date().toISOString().slice(0, 10);
    if (day.d !== d) day = { d, n: 0 };
    return ++day.n <= perDay;
  };
}
