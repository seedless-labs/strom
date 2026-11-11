// builders, from canvas builders. matched to src/lib (v0 tx + strom lookup table, 1click on the way back) and the
// 11 nov mainnet runs. the self-relay fallback and the fork-only numbers were cut.
import { Page, Hero, Section, Cols, Qa, Go, Cta } from '../ui/Prose';

const TX = `// solana → near · one v0 transaction, signed by your wallet, fee paid by the relayer
[ compute budget ]
[ jupiter swap   ]  usdc or sol → near (omni-bridged mint)
[ omni bridge    ]  init_transfer → intents.near
[ kora fee       ]  usdc or sol → relayer
// lookup tables: jupiter's + strom's own for the fixed omni accounts

// near → solana · one signed message
1click quote → your wallet signs a near intent (solana signMessage, raw ed25519)
→ the solver relay publishes it → 1click swaps and pays out sol or usdc on solana`;

export default function Builders() {
  return (
    <Page>
      <Hero
        kicker="builders"
        title={<>one signature. <span className="acc">open protocols.</span></>}
        cta={<><Cta href="#/swap">try the app</Cta><Cta href="#/track" ghost>track a transfer</Cta></>}
      >
        strom is a thin client over open protocols. no custom program, no custody,
        nothing to trust but solana, jupiter, the omni bridge and near.
      </Hero>

      <Section n="01" kicker="the transaction" title="what your wallet signs.">
        <pre className="code">{TX}</pre>
      </Section>

      <Section n="02" kicker="measured" title="from two live mainnet runs, 11 nov 2026.">
        <Cols items={[
          { k: 'solana → near', title: '81 seconds', body: 'from the signed solana transaction to near landing in the intents account.' },
          { k: 'near → solana', title: '114 seconds', body: 'from the signed intent to the 1click payout landing on solana.' },
          { k: 'signatures', title: '1 each way', body: 'one transaction out, one signed message back. the user held no sol for gas.' },
        ]} />
      </Section>

      <Section n="03" kicker="stack" title="what each piece does.">
        <Qa items={[
          ['jupiter', 'the swap-instructions api routes usdc or sol into the omni-bridged near mint.'],
          ['omni bridge', 'init_transfer on solana sends the near across. the omni relayer finishes it on near.'],
          ['near intents', 'the landing account for near, tied to your solana wallet. also the source for the way back.'],
          ['1click', 'quotes and runs near → solana. refunds go back to the account they came from.'],
          ['kora', 'a gasless relayer. it pays the sol network fee and takes its fee from your wallet in the token you swap: usdc, or sol.'],
          ['v0 + lookup tables', 'swap, bridge and fee fit in one transaction. strom keeps its own lookup table for the fixed omni accounts.'],
          ['wallet standard', 'any solana wallet works. there is no default wallet brand.'],
        ]} />
      </Section>

      <Section n="04" kicker="status" title="what is live.">
        <Qa items={[
          ['solana → near', 'live on mainnet.'],
          ['near → solana', 'live on mainnet through 1click.'],
          ['agent', 'live. it reads and suggests, never signs.'],
        ]} />
        <p className="lede">
          we found a gap while building: a solana v1 transaction cannot be finished by the omni relayer today, so strom sends v0.
          reported upstream.
        </p>
        <Go href="https://github.com/Near-One/bridge-sdk-rs/issues/331">read the issue</Go>
      </Section>

      <Section kicker="seedless" title="see it move.">
        <div className="ctas"><Cta href="#/swap">try the app</Cta><Cta href="#/how" ghost>how it works</Cta></div>
      </Section>
    </Page>
  );
}
