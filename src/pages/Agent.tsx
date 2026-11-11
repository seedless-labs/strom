// agent, from canvas agent. the agent is not built yet (chunk 4), so this page says "coming" and claims nothing live.
// cut from the canvas: "prepare the step that finishes a slow transfer" (self-relay is not built) and the sample quote.
import { Page, Hero, Section, Cta } from '../ui/Prose';

const SAY = [
  'swap 10 usdc to near',
  'move all my sol to near',
  'how much near do i get for 50 usdc?',
  'where is my money?',
];

export default function Agent() {
  return (
    <Page>
      <Hero
        kicker="agent · coming"
        title={<>it reads. <span className="acc">you approve.</span></>}
        cta={<><Cta href="#/swap">start a swap</Cta><Cta href="#/how" ghost>how it works</Cta></>}
      >
        say what you want in plain words. the agent will build the swap, check every token and hand it to your wallet.
        it can never move money on its own. it is being built now; the swap and the tracker work today.
      </Hero>

      <Section n="01" kicker="you will be able to say" title="plain words in, a ready swap out.">
        <pre className="code">{SAY.map(s => '> ' + s).join('\n')}</pre>
      </Section>

      <Section n="02" kicker="what it can and cannot do" title="read only. always.">
        <div className="vs">
          <ul className="yes">
            <li>turn plain words into a ready swap</li>
            <li>show you the exact amount before you approve</li>
            <li>warn you about fake or lookalike tokens</li>
            <li>find a slow transfer and explain it in plain words</li>
          </ul>
          <ul className="no">
            <li>hold your keys or your money</li>
            <li>approve anything for you</li>
            <li>send money without your wallet</li>
            <li>guess a token it cannot verify</li>
          </ul>
        </div>
      </Section>

      <Section kicker="seedless" title="until then, it is one approval by hand.">
        <div className="ctas"><Cta href="#/swap">start a swap</Cta><Cta href="#/track" ghost>track a transfer</Cta></div>
      </Section>
    </Page>
  );
}
