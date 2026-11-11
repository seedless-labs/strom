// about, from canvas about. links are real seedless channels; nothing here claims a feature that is not live.
import { Page, Hero, Section, Cols, Go, Cta } from '../ui/Prose';

export default function About() {
  return (
    <Page>
      <Hero
        kicker="about"
        title={<>the road between <span className="acc">two networks.</span></>}
        cta={<><Cta href="#/swap">start a swap</Cta><Cta href="#/builders" ghost>read the stack</Cta></>}
      >
        people hold dollars on solana. more and more apps they want to use live on near.
        today, getting from one to the other takes too many steps. strom makes it one.
      </Hero>

      <Section n="01" kicker="why now" title="the pieces finally fit.">
        <Cols items={[
          { k: '01', title: 'money lives on many chains', body: 'stablecoins on solana move billions every day. near is where intents and agent apps are growing.' },
          { k: '02', title: 'the road is broken', body: 'bridges, swaps and gas tokens are separate jobs. most people give up halfway.' },
          { k: '03', title: 'the tech is ready', body: 'jupiter, the omni bridge and near intents now make a one-approval move possible, with no custom program to trust.' },
        ]} />
      </Section>

      <Section n="02" kicker="who builds it" title="seedless.">
        <p className="lede">
          the team behind seedless, a non-custodial money app live on the app store, google play and the solana dapp store.
          we build money tools where your keys stay yours.
        </p>
        <Cols items={[
          { k: 'keys', title: 'non-custodial', body: 'we never hold your money or your keys. you sign every move in your wallet.' },
          { k: 'code', title: 'open protocols', body: 'strom uses jupiter, the omni bridge, near intents and 1click. no custom program to trust.' },
          { k: 'live', title: 'shipping', body: 'the seedless app is live in three stores. strom runs on solana and near mainnet.' },
        ]} />
      </Section>

      <Section n="03" kicker="talk to us" title="say hello.">
        <div className="cols">
          <div className="col"><span className="label">community</span><Go href="https://t.me/seedless_users">telegram</Go></div>
          <div className="col"><span className="label">updates</span><Go href="https://x.com/seedless_wallet">x</Go></div>
          <div className="col"><span className="label">company</span><Go href="https://seedlesslabs.xyz">seedlesslabs.xyz</Go></div>
        </div>
      </Section>

      <Section kicker="seedless" title="see it move.">
        <div className="ctas"><Cta href="#/swap">start a swap</Cta><Cta href="#/track" ghost>track a transfer</Cta></div>
      </Section>
    </Page>
  );
}
