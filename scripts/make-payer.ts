// makes strom's own fee payer at ~/.strom-live/payer.json (kept outside the repo). prints only the address.
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { createKeyPairSignerFromBytes } from '@solana/kit';

const path = `${homedir()}/.strom-live/payer.json`;
if (!existsSync(path)) {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  writeFileSync(path, JSON.stringify([...pkcs8.slice(-32), ...pub]), { mode: 0o600 });
}
const signer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(path, 'utf8'))));
console.log(signer.address);
