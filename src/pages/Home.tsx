// home, from canvas main. every claim here is something the app does today; the agent is marked as coming.
import { Page, Hero, Section, Cols, Go, Cta } from '../ui/Prose';

export default function Home() {
  return (
    <Page>
      <Hero
        kicker="solana ⇄ near · one approval · gas in usdc"
        title={<>move money from solana to near. <span className="acc">one approval.</span></>}
        cta={<><Cta href="#/swap">start a swap</Cta><Cta href="#/how" ghost>how it works</Cta></>}
      >
        strom swaps your usdc or sol on solana into near and sends it across, in a single approval from your wallet.
        no bridge site to babysit. no second token for gas.
      </Hero>

      <Section n="01" kicker="built for everyone" title="whoever you are, it is the same one approval.">
        <Cols items={[
          { k: 'for', title: 'new to crypto', body: 'you have dollars on solana and want them on near. approve once and it goes. no extra token to buy first.', link: { href: '#/how', label: 'see how it works' } },
          { k: 'for', title: 'traders', body: 'a live quote and the amount you get before you approve. one transaction instead of three apps.', link: { href: '#/swap', label: 'open the app' } },
          { k: 'for', title: 'builders', body: 'jupiter routing and the omni bridge in one solana transaction, near intents and 1click on the way back.', link: { href: '#/builders', label: 'read the stack' } },
        ]} />
      </Section>

      <Section n="02" kicker="the problem" title="moving money between chains still takes three websites.">
        <div className="vs">
          <ul className="no">
            <li>a bridge site, then a swap site, then a wallet for each side</li>
            <li>sol for gas on one side, near for gas on the other</li>
            <li>a transfer that sits stuck with no one to ask</li>
          </ul>
          <ul className="yes">
            <li>one screen, one approval in the wallet you already use</li>
            <li>gas paid in usdc, no sol needed</li>
            <li>a tracker that shows every step in plain words</li>
          </ul>
        </div>
      </Section>

      <Section n="03" kicker="how it works" title="three steps.">
        <Cols items={[
          { k: '01', title: 'pick an amount', body: 'choose usdc or sol and how much. strom gets a live quote from jupiter.' },
          { k: '02', title: 'approve once', body: 'the swap and the bridge ride in one solana transaction. only your wallet can approve it.' },
          { k: '03', title: 'it lands on near', body: 'near arrives in your near account. coming back to solana is one signed message.' },
        ]} />
        <Go href="#/how">the full walkthrough</Go>
      </Section>

      <Section n="04" kicker="where is my money" title="never wonder where it went.">
        <p className="lede">paste a solana transaction or a deposit address and see every step, in plain words, with links to the explorers.</p>
        <Go href="#/track">track a transfer</Go>
      </Section>

      <Section n="05" kicker="agent · coming" title="it reads. you approve.">
        <p className="lede">an agent that turns plain words into a swap and explains a slow transfer. it will never hold your keys or sign for you.</p>
        <Go href="#/agent">what the agent will and will not do</Go>
      </Section>

      <Section kicker="seedless" title="money should move like current.">
        <p className="lede">
          strom is built by seedless, the team behind the seedless money app on the app store, google play and the solana dapp store.
          your keys stay in your wallet. always.
        </p>
        <div className="ctas"><Cta href="#/swap">start a swap</Cta><Cta href="#/track" ghost>track a transfer</Cta></div>
      </Section>
    </Page>
  );
}
