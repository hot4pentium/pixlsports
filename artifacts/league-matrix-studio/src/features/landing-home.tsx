import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { ArrowRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, ClipboardCheck, Activity, Heart, Share2, Bell, Check, Menu, RotateCcw, X, WifiOff, CloudUpload, Download, ShieldCheck, Smartphone, MoreVertical } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import kimberlyHypeCard from '@/assets/landing-kimberly-hype-card.png';
import dashboardMobile from '@/assets/landing-dashboard-mobile.png';
import dashboardLandscape from '@/assets/landing-dashboard-landscape.png';
import { LandingToolDemo } from './landing-tool-demo';
import youthSoccerHero from '@/assets/landing-candid-athlete.jpg';
import { useAppInstallPrompt } from './app-install-prompt';

function Brand() {
  return <span className="brand" aria-label="Pixl Sports">PIXL<span>SPORTS</span></span>;
}

function LandingNav({ isSignedIn }: { isSignedIn: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [menuOpen]);

  const destination = isSignedIn ? '/studio' : '/sign-up';
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand-link" data-testid="link-landing-home"><Brand /></Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#how-it-works" data-testid="link-landing-how-it-works">How it works</a>
          <a href="#athlete-cards" data-testid="link-landing-athlete-cards">Athlete cards</a>
          <a href="#tools" data-testid="link-landing-tools">The dashboard</a>
        </nav>
        <div className="header-actions">
          <Link href={isSignedIn ? '/studio' : '/auth'} className="desktop-account-link" style={{ color: '#d4e0e2', fontSize: 12, fontWeight: 700 }} data-testid={isSignedIn ? 'link-landing-dashboard' : 'link-landing-sign-in'}>{isSignedIn ? 'Studio' : 'Sign up / sign in'}</Link>
          <Link href={destination} className="pill pill-lime" data-testid="link-landing-get-started-nav">{isSignedIn ? 'Open studio' : 'Get started'} <ArrowUpRight size={15} aria-hidden="true" /></Link>
          <button type="button" className="menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="landing-mobile-menu" onClick={() => setMenuOpen(value => !value)} data-testid="button-landing-mobile-menu">
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {menuOpen && <nav className="mobile-nav" id="landing-mobile-menu" aria-label="Mobile navigation">
        <a href="#how-it-works" onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-how-it-works">How it works</a>
        <a href="#athlete-cards" onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-athlete-cards">Athlete cards</a>
        <a href="#tools" onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-tools">The dashboard</a>
        <Link href="/help" onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-help">Help</Link>
        <Link href={isSignedIn ? '/studio' : '/auth'} onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-sign-in">{isSignedIn ? 'Studio' : 'Sign up / sign in'}</Link>
        <Link href={destination} className="pill pill-lime" onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-get-started">{isSignedIn ? 'Open studio' : 'Get started'} <ArrowUpRight size={16} aria-hidden="true" /></Link>
      </nav>}
    </header>
  );
}

const steps = [
  { number: '01', title: 'Plan', description: 'Keep games, practices, and the next event together.', icon: CalendarDays },
  { number: '02', title: 'Prep', description: 'Get the details and game-day checklist ready.', icon: ClipboardCheck },
  { number: '03', title: 'Follow', description: 'Stay close to the action and capture what matters.', icon: Activity },
  { number: '04', title: 'Celebrate', description: 'Turn the best moments into something worth sharing.', icon: Heart },
];

const heroSports = ['Football', 'Soccer', 'Basketball', 'Baseball', 'Softball', 'Volleyball'];
const landingCapabilityHighlights = [
  {
    name: 'One link for the season',
    description: "Share your athlete's HYPE Card with fans! Send a link for everyone to follow. That's all they need to stay in the game.",
    icon: Heart,
  },
  {
    name: 'Share game details',
    description: 'Send supporters a public Event Card link for the game’s key details and updates.',
    icon: Share2,
  },
  {
    name: 'Get ready together',
    description: 'Create a checklist edit link so trusted collaborators can help with game-day prep and shared notes.',
    icon: ClipboardCheck,
  },
  {
    name: 'Opt in to Event Card reminders',
    description: 'Choose owner phone alerts when scheduled delivery is active. These reminders are separate from manual follower announcements.',
    icon: Bell,
  },
];

function DemoStepCard({ step: { number, title, description, icon: Icon }, onOpen }: {
  step: (typeof steps)[number];
  onOpen: () => void;
}) {
  return (
    <button type="button" className="step-card step-card--demo" onClick={onOpen} aria-label={`Try ${title}: ${description}`} data-testid={`button-landing-${title.toLowerCase()}-try`}>
      <div className="step-top"><span className="step-icon"><Icon size={18} strokeWidth={2} aria-hidden="true" /></span><span className="step-number" aria-hidden="true" data-testid={`landing-step-number-${number}`}>{number}</span></div>
      <h3 className="display">{title}</h3><p>{description}</p>
      <span className="step-demo-launch" aria-hidden="true">Try {title} <ArrowRight size={14} /></span>
    </button>
  );
}

function AthletePreview() {
  return (
    <div className="athlete-showcase">
      <div className="landing-hype-card-art">
        <img
          className="landing-athlete-render"
          src={kimberlyHypeCard}
          alt="Kimberly in a pink soccer jersey holding a ball on a Pixl Hype Card."
          width="1228"
          height="1981"
        />
        <div className="landing-hype-card-tabs" aria-hidden="true" data-testid="landing-hype-card-tabs">
          <span className="landing-hype-card-tab landing-hype-card-tab--active"><RotateCcw size={10} /><span>Card front</span></span>
          <span className="landing-hype-card-tab"><ChartNoAxesCombined size={10} /><span>Stats</span></span>
          <span className="landing-hype-card-tab"><CalendarDays size={10} /><span>Events</span></span>
        </div>
      </div>
      <span className="showcase-note">Product preview · Hype Card</span>
    </div>
  );
}

function DashboardPreview({ variant }: { variant: 'mobile' | 'landscape' }) {
  const mobile = variant === 'mobile';
  return (
    <div className="tool-preview">
      <span className="preview-watermark">Product preview · Fictional dashboard</span>
      <div className={`dashboard-preview dashboard-preview--${variant}`}>
        <img
          src={mobile ? dashboardMobile : dashboardLandscape}
          alt={mobile
            ? 'Fictional supporter dashboard on a phone: Maya Chen’s next volleyball game, shoutout, tracked record, and Event Cards.'
            : 'The same fictional supporter dashboard in a wide view, showing Maya Chen’s game details and six Event Cards in three columns.'}
          width={mobile ? 516 : 1600}
          height={mobile ? 1500 : 1100}
          decoding="async"
        />
      </div>
    </div>
  );
}

export function PublicLandingPage() {
  const { isSignedIn } = useUser();
  const destination = isSignedIn ? '/studio' : '/sign-up';
  const [activeDemo, setActiveDemo] = useState<'01' | '02' | '03' | '04' | null>(null);
  const [weekStepsVisible, setWeekStepsVisible] = useState(false);
  const weekGridRef = useRef<HTMLDivElement | null>(null);
  const { action: installAction, isIOS, showInstructions, handleInstall } = useAppInstallPrompt('landing');

  const requestInstall = () => {
    const deviceClass = window.matchMedia('(max-width: 700px)').matches ? 'mobile' : 'desktop';
    void handleInstall(deviceClass);
  };

  const startInstall = () => {
    document.getElementById('landing-install')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (installAction === 'installed') return;
    requestInstall();
  };

  useEffect(() => {
    const grid = weekGridRef.current;
    if (!grid) return;
    if (typeof window.IntersectionObserver !== 'function') {
      setWeekStepsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setWeekStepsVisible(true);
      observer.unobserve(grid);
    }, { threshold: 0.12 });
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="new-landing">
      <LandingNav isSignedIn={Boolean(isSignedIn)} />
      <main>
        <section className="hero" aria-labelledby="landing-headline">
          <div className="container hero-inner">
            <div className="hero-copy">
              <h1 id="landing-headline" className="display" data-testid="text-landing-headline">ALL IN,<br /><em>ALL SEASON.</em></h1>
              <p className="hero-description">One season hub for youth-sports families. Plan games and practices, get ready for game day, track stats, and share your athlete’s HYPE Card.</p>
              <div className="hero-buttons">
                <Link href={destination} className="pill pill-lime" data-testid="link-hero-get-started">{isSignedIn ? 'Open studio' : 'Get started'} <ArrowUpRight size={16} aria-hidden="true" /></Link>
                <a href="#how-it-works" className="pill pill-ghost" data-testid="link-hero-see-week">See how it works <ArrowRight size={16} aria-hidden="true" /></a>
                <button
                  type="button"
                  className="pill pill-ghost landing-install-button"
                  onClick={startInstall}
                  aria-controls="landing-install"
                  data-testid="button-landing-install"
                >
                  <Download size={16} aria-hidden="true" /> Install as an app
                </button>
              </div>
            </div>
            <div className="hero-visual">
              <div className="hero-image-frame">
                <img src={youthSoccerHero} alt="Youth soccer player smiling while running on a field" width="1024" height="1024" fetchPriority="high" decoding="async" />
              </div>
              <div className="hero-message">
                <strong>Every player has a story worth sharing.</strong>
                <p>One place for the photos, stats, events, and shoutouts.</p>
                <div className="message-line" aria-hidden="true" />
              </div>
            </div>
          </div>
        </section>

        <div className="supported-sports" role="group" aria-label="Sports PIXL supports" data-testid="hero-supported-sports">
          <ul className="container supported-sports-list">
            {heroSports.map(sport => <li key={sport} data-testid={`hero-supported-sport-${sport.toLowerCase()}`}>{sport}</li>)}
          </ul>
        </div>

        <section className="install-section" id="landing-install" aria-labelledby="landing-install-heading" data-testid="landing-install-panel">
          <div className="container install-layout">
            <div className="install-copy">
              <span className="install-eyebrow"><span className="install-live-dot" aria-hidden="true" /> THE FUTURE OF WEB APPLICATIONS</span>
              <h2 id="landing-install-heading" className="display">Make room<br />for <em>the good stuff.</em></h2>
              <p className="install-lede">PIXL Sports is a Progressive Web App (PWA)—a website you can add to your Home Screen and open like an app. Load your game details and checklist while online; reopen them offline and track stats. Saved stats sync when you reconnect.</p>
              <button type="button" className="install-action" onClick={requestInstall} data-testid="button-install-section">
                <Download size={18} aria-hidden="true" /> {installAction === 'installed' ? 'PIXL is on your home screen' : 'Add PIXL to your home screen'} <ArrowUpRight size={17} aria-hidden="true" />
              </button>
              {showInstructions && <p className="install-action-hint" role="status">Use the quick steps below to finish adding PIXL on this device.</p>}
              {installAction === 'installed' && <p className="install-action-hint" role="status" data-testid="landing-install-status">PIXL Sports is already installed on this device.</p>}
              <div className="install-proof"><ShieldCheck size={17} aria-hidden="true" /><span>Install only from the official PIXL Sports website. No store download needed.</span></div>
            </div>
            <div className="install-visual" aria-hidden="true">
              <div className="install-sideline install-sideline--one" />
              <div className="install-sideline install-sideline--two" />
              <div className="install-burst install-burst--one">PIXL<br />ON DECK</div>
              <div className="install-phone">
                <div className="install-phone-notch" />
                <div className="install-phone-screen">
                  <div className="install-phone-top"><span>PIXL SPORTS</span><span className="install-signal" /></div>
                  <div className="install-phone-kicker">GAME DAY</div>
                  <div className="install-phone-title">Let’s play.</div>
                  <div className="install-mini-event"><span className="install-mini-ball"><Activity size={17} /></span><span><b>Saturday · 10:30 AM</b><small>Falcons vs. Comets</small></span></div>
                  <div className="install-mini-footer"><span>PLAN</span><span>PREP</span><span>HYPE</span></div>
                </div>
              </div>
              <div className="install-burst install-burst--two"><span>ONE TAP</span><ArrowRight size={19} /></div>
            </div>
          </div>
          <div className="container install-steps-wrap">
            <div className="install-steps-heading"><span className="micro">A quick pregame setup</span><span className="install-steps-rule" /></div>
            <div className="install-steps">
              <article className="install-step" data-testid="landing-install-iphone">
                <div className="install-step-top"><span className="install-step-icon"><Smartphone size={18} aria-hidden="true" /></span><span className="install-step-number">01</span></div>
                <h3 className="display">iPhone &amp; iPad</h3>
                <p>Open this page in <strong>Safari</strong>. Tap <Share2 size={13} aria-label="Share" /> Share, then <strong>Add to Home Screen</strong>. Turn on <strong>Open as Web App</strong>, then tap Add.</p>
              </article>
              <article className="install-step" data-testid="landing-install-android">
                <div className="install-step-top"><span className="install-step-icon"><MoreVertical size={18} aria-hidden="true" /></span><span className="install-step-number">02</span></div>
                <h3 className="display">Android</h3>
                <p>Tap your browser’s <strong>Install</strong> prompt, or open its menu and choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</p>
              </article>
              <div className="install-security" data-testid="landing-install-security">
                <ShieldCheck size={20} aria-hidden="true" />
                <div><strong>A clear note on safety</strong><p>PIXL is served over HTTPS and uses your browser’s and device’s security protections. This PWA installs from the website and does not go through App Store or Google Play review. Install only from the official PIXL Sports website.</p></div>
              </div>
            </div>
            {isIOS && <p className="install-device-note" role="status">On iPhone or iPad? Open this page in Safari to add PIXL.</p>}
          </div>
        </section>

        <div className="week-ribbon" aria-label="Plan the week, show up ready, celebrate together">
          <div className="container ribbon-inner"><span>Plan the week</span><span className="ribbon-star" aria-hidden="true" /><span>Show up ready</span><span className="ribbon-star" aria-hidden="true" /><span>Celebrate together</span></div>
        </div>

        <section className="week-section" id="how-it-works" aria-labelledby="week-heading">
          <div className="container">
            <div className="section-intro">
              <div><span className="micro">A simpler game week</span><h2 className="display" id="week-heading">One week.<br />Everything in motion.</h2></div>
              <p>PIXL gives you a clear next step, from putting a game on the calendar to sharing the moments afterward.</p>
            </div>
            <div ref={weekGridRef} className={`week-grid${weekStepsVisible ? ' week-grid--visible' : ''}`} data-testid="landing-week-grid">
              {steps.map(step => <DemoStepCard key={step.number} step={step} onOpen={() => setActiveDemo(step.number as '01' | '02' | '03' | '04')} />)}
            </div>
            {activeDemo && <LandingToolDemo step={activeDemo} open destination={destination} onOpenChange={open => { if (!open) setActiveDemo(null); }} />}
          </div>
        </section>

        <section className="athlete-section" id="athlete-cards" aria-labelledby="athlete-heading">
          <div className="container athlete-grid">
            <div className="athlete-copy">
              <span className="micro">More than a profile</span>
              <h2 className="display" id="athlete-heading">Their moments.<br />Their <span className="hype-word">Hype</span> Card.</h2>
              <p>Make a Hype Card they’ll want to show off. Add a favorite photo, share it with family, and let supporters send a shoutout.</p>
              <ul className="check-list">
                <li><Check size={16} aria-hidden="true" /> Make it theirs</li>
                <li><Check size={16} aria-hidden="true" /> Share it easily</li>
                <li><Check size={16} aria-hidden="true" /> Collect the encouragement</li>
              </ul>
              <Link href={destination} className="pill pill-navy" data-testid="link-landing-athlete-cards-cta">Explore Hype Cards <ArrowUpRight size={16} aria-hidden="true" /></Link>
            </div>
            <AthletePreview />
          </div>
        </section>

        <section className="offline-section" aria-labelledby="offline-heading" data-testid="landing-offline-section">
          <div className="container offline-grid">
            <div className="offline-copy">
              <span className="micro"><WifiOff size={14} aria-hidden="true" /> Game day, even with a weak signal</span>
              <h2 className="display" id="offline-heading">No service?<br /><em>Keep going.</em></h2>
              <p>When you’ve loaded the details, PIXL keeps key game-day work on your device, so a dropped connection doesn’t have to stop the plan.</p>
              <div className="offline-sync-status" role="status" data-testid="offline-sync-status">
                <span className="offline-sync-icon"><CloudUpload size={17} aria-hidden="true" /></span>
                <span><strong>Saved on this device</strong><small>Will sync when connected</small></span>
                <Check className="offline-sync-check" size={17} aria-hidden="true" />
              </div>
            </div>
            <div className="offline-details">
              <ul className="offline-feature-list">
                <li>
                  <span className="offline-feature-icon"><CalendarDays size={19} aria-hidden="true" /></span>
                  <div><h3 className="display">Game details, ready</h3><p>Reopen game details and checklists you’ve already loaded on this device.</p></div>
                </li>
                <li>
                  <span className="offline-feature-icon"><ClipboardCheck size={19} aria-hidden="true" /></span>
                  <div><h3 className="display">Prep keeps moving</h3><p>Check off prep items on your device, even without service. Shared checklist edits stay here and may need Retry to sync to collaborators.</p></div>
                </li>
                <li>
                  <span className="offline-feature-icon"><Activity size={19} aria-hidden="true" /></span>
                  <div><h3 className="display">Track the action</h3><p>Record game stats locally and sync your saved result when you’re back online.</p></div>
                </li>
              </ul>
              <p className="offline-install-note"><strong>Before game day:</strong> On iPhone, tap Share, then Add to Home Screen. On Android, open your browser menu and choose Install app or Add to Home screen. Open PIXL online and load each game and checklist you’ll need. This will give you the full benefit of PIXL Sports, with offline content saved on this device.</p>
              <p className="offline-connection-note">New Event Card drafts stay private on this device until published online. Updating public cards, receiving new replies, and sending alerts still need a connection.</p>
            </div>
          </div>
        </section>

        <section className="tools-section" id="tools" aria-labelledby="tools-heading">
          <div className="container">
            <div className="tools-intro section-intro">
              <div><span className="micro">A look inside your dashboard</span><h2 className="display" id="tools-heading">Your athlete’s week.<br />All in view.</h2></div>
              <p>See the next game, Event Cards, tracked results, and supporter shoutouts together. These previews use fictional details.</p>
            </div>
            <div className="tool-grid">
              <article className="tool-card">
                <DashboardPreview variant="mobile" />
                <div className="tool-card-body"><span className="micro">01 / On the go</span><h3 className="display">Your game week in one place</h3><p>Check the next matchup, catch new shoutouts, and find every Event Card from your phone.</p><Link href={destination} data-testid="link-landing-dashboard-mobile">{isSignedIn ? 'Open your dashboard' : 'Create your dashboard'} <ArrowUpRight className="arrow" aria-hidden="true" /></Link></div>
              </article>
              <article className="tool-card">
                <DashboardPreview variant="landscape" />
                <div className="tool-card-body"><span className="micro">02 / The wider view</span><h3 className="display">See the whole season</h3><p>On a larger screen, the same dashboard keeps game details, your record, and Event Cards in sight.</p><Link href={destination} data-testid="link-landing-dashboard-landscape">{isSignedIn ? 'Open your dashboard' : 'Create your dashboard'} <ArrowUpRight className="arrow" aria-hidden="true" /></Link></div>
              </article>
            </div>
            <div className="capability-highlights" data-testid="landing-capability-highlights" aria-labelledby="capability-highlights-heading">
              <h3 className="display" id="capability-highlights-heading">Share the season. Stay connected.</h3>
              <ul className="capability-highlight-list">
                {landingCapabilityHighlights.map(({ name, description, icon: Icon }) => (
                  <li className="capability-highlight" key={name}>
                    <span className="capability-highlight-icon"><Icon size={18} aria-hidden="true" /></span>
                    <div>
                      <h4 className="display">{name}</h4>
                      <p>{description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="closing" aria-labelledby="closing-heading">
          <div className="container">
            <span className="micro">We guide their week</span>
            <h2 className="display" id="closing-heading">Every game week has a<br />story.</h2>
            <p>Bring the plans, the people, and the good stuff together.</p>
            <Link href={destination} className="pill pill-lime" data-testid="link-landing-closing-cta">{isSignedIn ? 'Open your dashboard' : 'Create your dashboard'} <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <Link href="/" data-testid="link-footer-home"><Brand /></Link>
          <p>Built for the people who show up.</p>
          <nav className="footer-links" aria-label="Footer navigation">
            <Link href={isSignedIn ? '/studio' : '/auth'} data-testid="link-footer-tools">Studio</Link>
            <Link href="/help" data-testid="link-footer-help">Help / FAQ</Link>
             <Link href="/help" data-testid="link-footer-support">Contact support</Link>
            <Link href="/privacy" data-testid="link-footer-privacy">Privacy</Link>
             <Link href={isSignedIn ? '/studio' : '/auth'} data-testid="link-footer-sign-in">{isSignedIn ? 'Studio' : 'Sign up / sign in'}</Link>
          </nav>
        </div>
        <div className="container footer-bottom">© {new Date().getFullYear()} PIXL Sports. Illustrative previews feature fictional athletes and events.</div>
      </footer>
    </div>
  );
}
