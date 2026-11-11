// "tell strom": plain words in, a ready swap out. reads only. it never signs and never sends;
// the result is a link that prefills the swap page, and your wallet still approves every move.
// /api/agent asks claude when a key is set; the local parser below is the fallback and the guard.

export type Intent = {
  kind: 'swap' | 'quote' | 'track' | 'unknown';
  dir: 'to-near' | 'to-sol';
  tok: 'usdc' | 'sol';
  amt: string; // '' = not said, 'max' = everything, else a decimal
  note: string; // one plain sentence for the user
};

const OTHER = /\b(usdt|eth|weth|btc|wbtc|bonk|jup|wif|pyth|ray|msol|jitosol|aurora|zec|doge|xrp|trump|pengu)\b/;
const TOKEN = /\b(usdc|dollars?|usd|\$|sol|solana|near)\b/g;

const norm = (t: string) => (t.startsWith('usd') || t.startsWith('dollar') || t === '$' ? 'usdc' : t.startsWith('sol') ? 'sol' : 'near');

/** the guard: anything from the server or the parser passes through here before it reaches a link */
export function clean(x: any): Intent | undefined {
  if (!x || typeof x !== 'object') return;
  const kind = ['swap', 'quote', 'track', 'unknown'].includes(x.kind) ? x.kind : undefined;
  const dir = x.dir === 'to-sol' ? 'to-sol' : 'to-near';
  const tok = x.tok === 'sol' ? 'sol' : 'usdc';
  const amt = typeof x.amt === 'string' && /^(max|\d{1,12}(\.\d{1,9})?)?$/.test(x.amt) ? x.amt : '';
  const note = typeof x.note === 'string' ? x.note.toLowerCase().slice(0, 160) : '';
  if (!kind) return;
  return { kind, dir, tok: dir === 'to-sol' ? 'sol' : tok, amt, note };
}

export function parseLocal(text: string): Intent {
  const t = text.toLowerCase().replace(/\$(\d+(?:\.\d+)?)/g, '$1 usdc');
  const base: Intent = { kind: 'unknown', dir: 'to-near', tok: 'usdc', amt: '', note: '' };
  if (OTHER.test(t)) return { ...base, note: 'strom moves usdc, sol and near only. it will not guess another token.' };
  if (/\b(where|status|stuck|track|arrived|landed|my money|my transfer)\b/.test(t) && !/\d/.test(t))
    return { ...base, kind: 'track', note: 'opening your last transfer.' };

  const toks = [...t.matchAll(TOKEN)].map(m => norm(m[1]));
  const num = t.match(/(\d+(?:\.\d+)?)/)?.[1] ?? '';
  const amt = /\b(all|everything|max|whole)\b/.test(t) ? 'max' : num;
  const quote = /\bhow much\b|\bquote\b|\bwhat (do|would|will) i get\b|\?$/.test(t.trim());
  if (!toks.length) return { ...base, note: 'say an amount and a token, like "swap 10 usdc to near".' };

  // near leaves only when the words say so: "near to sol", or "swap/sell/send ... near" with no "to near"
  const toSol = /\bnear\s+(to|into|for|back to|→|->)\s+(sol|solana|usdc|usd)\b/.test(t)
    || (/\b(sell|swap|move|send)\s+(\d+(\.\d+)?\s+|all\s+(of\s+)?(my\s+)?|my\s+)?near\b/.test(t) && !/\b(to|into|for)\s+near\b/.test(t));
  if (toSol) {
    return { kind: quote ? 'quote' : 'swap', dir: 'to-sol', tok: 'sol', amt, note: 'near back to sol on solana, through 1click.' };
  }
  const tok = toks.find(x => x !== 'near') === 'sol' ? 'sol' : 'usdc';
  return { kind: quote ? 'quote' : 'swap', dir: 'to-near', tok, amt, note: `${tok} on solana to near, one approval in your wallet.` };
}

/** ask the server first; any failure or bad shape falls back to the local parser */
export async function understand(text: string): Promise<Intent> {
  const words = text.trim().slice(0, 200);
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: words }), signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) { const i = clean(await r.json()); if (i) return i; }
  } catch { /* offline, no key, or no function: use the local parser */ }
  return parseLocal(words);
}

/** where the intent opens. only ever a page in this app, never a signing call */
export function href(i: Intent): string | undefined {
  if (i.kind === 'track') return '#/track';
  if (i.kind === 'unknown') return;
  const q = new URLSearchParams({ dir: i.dir, tok: i.tok });
  if (i.amt) q.set('amt', i.amt);
  return '#/swap?' + q.toString();
}
