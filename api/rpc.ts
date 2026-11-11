// solana rpc proxy: the app's reads go through here so the rpc key stays on the server.
// only the read methods strom uses are allowed; anything else is refused.
const RPC = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
const METHODS = new Set(['getLatestBlockhash', 'getBalance', 'getTokenAccountBalance', 'getSignatureStatuses']);
const MAX_BODY = 4 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function POST(req: Request): Promise<Response> {
  const raw = await req.arrayBuffer();
  if (raw.byteLength > MAX_BODY) return json({ error: 'body too large' }, 413);
  let rpc: any;
  try { rpc = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ error: 'bad json' }, 400); }
  if (Array.isArray(rpc) || !METHODS.has(rpc?.method)) {
    return json({ jsonrpc: '2.0', id: rpc?.id ?? null, error: { code: -32601, message: 'method not allowed' } }, 403);
  }
  try {
    const r = await fetch(RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? 1, method: rpc.method, params: rpc.params ?? [] }),
      signal: AbortSignal.timeout(8000),
    });
    return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return json({ jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32000, message: 'rpc is busy, try again' } }, 502);
  }
}
