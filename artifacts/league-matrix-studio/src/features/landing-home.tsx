import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { ArrowRight, ArrowUpRight, CalendarDays, ChartNoAxesCombined, ClipboardCheck, Activity, Heart, Share2, Bell, Check, Menu, RotateCcw, X, WifiOff, CloudUpload } from 'lucide-react';
import { useEffect, useState } from 'react';
import youthFootballHero from '@/assets/landing-youth-football-hero.jpg';
import kimberlyHypeCard from '@/assets/landing-kimberly-hype-card.png';
import dashboardMobile from '@/assets/landing-dashboard-mobile.png';
import dashboardLandscape from '@/assets/landing-dashboard-landscape.png';
import { LandingToolDemo } from './landing-tool-demo';

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
      <div className="step-top"><span className="step-icon"><Icon size={18} strokeWidth={2} aria-hidden="true" /></span><span className="step-number">{number}</span></div>
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
  return (
    <div className="new-landing">
      <LandingNav isSignedIn={Boolean(isSignedIn)} />
      <main>
        <section className="hero" aria-labelledby="landing-headline">
          <div className="container hero-inner">
            <div className="hero-copy">
              <h1 id="landing-headline" className="display" data-testid="text-landing-headline">ALL IN,<br /><em>ALL SEASON.</em></h1>
              <p className="hero-description">Plan the week, follow the game, and celebrate the athlete you love—all in one place built for families and supporters.</p>
              <div className="hero-buttons">
                <Link href={destination} className="pill pill-lime" data-testid="link-hero-get-started">{isSignedIn ? 'Open studio' : 'Get started'} <ArrowUpRight size={16} aria-hidden="true" /></Link>
                <a href="#how-it-works" className="pill pill-ghost" data-testid="link-hero-see-week">See how it works <ArrowRight size={16} aria-hidden="true" /></a>
              </div>
            </div>
            <div className="hero-visual">
              <div className="hero-image-frame">
                <img src={youthFootballHero} alt="Black youth football player smiling on the field while carrying a helmet" width="1024" height="1024" fetchPriority="high" decoding="async" />
              </div>
              <div className="hero-message">
                <strong>Every player has a story worth sharing.</strong>
                <p>One place for the photos, stats, events, and shoutouts.</p>
                <div className="message-line" aria-hidden="true" />
              </div>
            </div>
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
            <div className="week-grid">
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
              <p className="offline-connection-note">Creating or updating Event Card shares, receiving new replies, and sending alerts still need a connection.</p>
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
             <a href="mailto:support@pixlsports.com" data-testid="link-footer-support">support@pixlsports.com</a>
            <Link href="/privacy" data-testid="link-footer-privacy">Privacy</Link>
             <Link href={isSignedIn ? '/studio' : '/auth'} data-testid="link-footer-sign-in">{isSignedIn ? 'Studio' : 'Sign up / sign in'}</Link>
          </nav>
        </div>
        <div className="container footer-bottom">© {new Date().getFullYear()} PIXL Sports. Illustrative previews feature fictional athletes and events.</div>
      </footer>
    </div>
  );
}