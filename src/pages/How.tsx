// how it works, from canvas how. each line matches lib/flow.ts and the live mainnet runs (11 nov: 81s to near, 114s back).
import { Page, Hero, Section, Cols, Qa, Go, Cta } from '../ui/Prose';

export default function How() {
  return (
    <Page>
      <Hero kicker="how it works" title="three steps. one approval." cta={<Cta href="#/swap">start a swap</Cta>}>
        no new wallet, no bridge site, no near to buy first. if you can send a payment, you can use strom.
      </Hero>

      <Section n="01" kicker="the steps" title="connect, choose, approve.">
        <Cols items={[
          { k: '01', title: 'connect your wallet', body: 'use the solana wallet you already have. strom works with any wallet that supports the solana wallet standard.' },
          { k: '02', title: 'choose what to move', body: 'pick usdc or sol and an amount. you see how much near you get, and every fee, before anything happens.' },
          { k: '03', title: 'approve once', body: 'one approval in your wallet sends the swap and the bridge together. then watch it land on near.' },
        ]} />
      </Section>

      <Section n="02" kicker="what you need" title="a wallet and the money you want to move.">
        <Qa items={[
          ['a solana wallet', 'any wallet that supports the solana wallet standard, in your browser or inside your wallet app.'],
          ['usdc or sol', 'the money you want to move. that is it.'],
          ['no sol for gas', 'gas is a few cents of usdc from your wallet, so you never buy sol or near first. swapping sol? keep a little usdc for gas.'],
          ['a near account', 'not needed. near lands in your near intents account, which is tied to your solana wallet.'],
        ]} />
      </Section>

      <Section n="03" kicker="behind the scenes" title="one solana transaction does the work.">
        <Cols items={[
          { k: '1 · swap', title: 'jupiter', body: 'on solana, your usdc or sol is swapped into bridged near through jupiter, solana’s swap router.' },
          { k: '2 · send', title: 'omni bridge', body: 'in the same transaction, the omni bridge picks that near up and carries it to the near network.' },
          { k: '3 · arrive', title: 'near', body: 'the bridge finishes on near and the money is in your account. in our live runs this took under two minutes.' },
        ]} />
        <p className="lede">coming back works through near intents: you sign one message, 1click swaps your near to sol, and it lands in your solana wallet.</p>
      </Section>

      <Section n="04" kicker="questions" title="the short answers.">
        <Qa items={[
          ['is my money safe?', 'strom never holds your money or your keys. every move is approved by you, in your wallet.'],
          ['what does it cost?', <>you see every fee before you approve: a few cents of usdc for gas and a small bridge fee taken from the near you get. see the <a href="#/builders">full route</a>.</>],
          ['what if it is slow?', <>open <a href="#/track">where is my money</a>, paste your transaction, and see each step in plain words, with links to the explorers.</>],
          ['do i need to know crypto?', 'no. if you can send a payment, you can use strom.'],
        ]} />
      </Section>

      <Section kicker="ready" title="ready when you are.">
        <div className="ctas"><Cta href="#/swap">start a swap</Cta><Cta href="#/track" ghost>track a transfer</Cta></div>
        <Go href="#/agent">the agent, coming soon</Go>
      </Section>
    </Page>
  );
}
