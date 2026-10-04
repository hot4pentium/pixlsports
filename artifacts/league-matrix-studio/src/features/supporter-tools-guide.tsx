import { useEffect } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link } from 'wouter';
import './supporter-tools-guide.css';

export function SupporterToolsGuidePage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Pixl Sports — Family Supporter Guide';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="supporter-tools-guide-shell">
      <article className="supporter-tools-guide" data-testid="supporter-tools-guide">
        <header className="supporter-guide-hero">
          <p className="supporter-guide-eyebrow">PIXL SPORTS · SUPPORTER GUIDE</p>
          <h1>One athlete.<br />One season.</h1>
          <p className="supporter-guide-intro">
            A quick guide to the tools for supporting one athlete—and what family and friends can use from a public HYPE Card.
          </p>
          <div className="supporter-guide-actions" aria-label="Guide actions">
            <button
              type="button"
              onClick={() => window.print()}
              data-testid="button-print-supporter-guide"
            >
              <Printer size={16} aria-hidden="true" />
              Print this guide
            </button>
            <Link href="/studio" data-testid="link-supporter-guide-hub">
              <ArrowLeft size={16} aria-hidden="true" />
              Supporter Hub
            </Link>
          </div>
        </header>

        <div className="supporter-guide-columns">
          <section
            className="supporter-guide-column supporter-guide-account"
            aria-labelledby="supporter-guide-account-heading"
            data-testid="supporter-guide-account-tools"
          >
            <p className="supporter-guide-kicker">For the supporter account</p>
            <h2 id="supporter-guide-account-heading">Your athlete’s tools</h2>
            <ul className="supporter-guide-list">
              <li>
                <h3>Season hub</h3>
                <p>Keep your athlete’s upcoming events, game details, and season highlights together.</p>
              </li>
              <li>
                <h3>Game-day preparation</h3>
                <p>Review event details and the prep checklist, then open the game tracker or create an Event Card.</p>
              </li>
              <li>
                <h3>Stats</h3>
                <p>Record game action in Stat Tracker and review completed games and season stats for your athlete.</p>
              </li>
              <li>
                <h3>HYPE Card setup</h3>
                <p>Create and manage your athlete’s public card, choose its visible sections, and decide whether to accept Shoutouts.</p>
              </li>
            </ul>
          </section>

          <section
            className="supporter-guide-column supporter-guide-public"
            aria-labelledby="supporter-guide-public-heading"
            data-testid="supporter-guide-public-card"
          >
            <p className="supporter-guide-kicker">For family &amp; friends</p>
            <h2 id="supporter-guide-public-heading">With the public HYPE Card link</h2>
            <ul className="supporter-guide-list">
              <li>
                <h3>View the card</h3>
                <p>Anyone with the public link can view the card. No account is needed.</p>
              </li>
              <li>
                <h3>Follow the season</h3>
                <p>Follow on your device without an account. Optional alerts are separate, and the owner chooses whether to send pre-event announcements.</p>
              </li>
              <li>
                <h3>Send a Shoutout</h3>
                <p>If the owner has turned Shoutouts on, send a public cheer for your athlete.</p>
              </li>
            </ul>
            <aside className="supporter-guide-live-taps" aria-labelledby="supporter-guide-live-taps-heading">
              <p className="supporter-guide-kicker">Extra access for in-person cheering</p>
              <h3 id="supporter-guide-live-taps-heading">Live Taps use the family QR</h3>
              <p>
                To add a Live Tap, scan the private family QR created by the card owner. It works while Game Day Live is active, and the owner can revoke the QR access.
              </p>
            </aside>
          </section>
        </div>

        <div className="supporter-guide-quick-rule" data-testid="supporter-guide-quick-rule">
          <strong>Easy to remember</strong>
          <span>Public HYPE Card link = view and follow. Owner’s private family QR = Live Taps.</span>
        </div>

        <footer className="supporter-guide-footer">
          <span>Made for sharing with the people cheering on your athlete.</span>
          <span>Public-card features depend on the card owner’s settings.</span>
        </footer>
      </article>
    </main>
  );
}