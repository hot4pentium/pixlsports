import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { ArrowRight, ArrowUpRight, CalendarDays, ClipboardCheck, Activity, Heart, Check, Menu, X, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import candidAthlete from '@/assets/landing-candid-athlete.jpg';
import youthFootballHero from '@/assets/landing-youth-football-hero.jpg';
import planEventDetails from '@/assets/landing-plan-event-details.png';
import prepChecklist from '@/assets/landing-prep-checklist.png';
import followStatTracker from '@/assets/landing-follow-stat-tracker.png';
import celebrateVideoReply from '@/assets/landing-celebrate-video-reply.png';
import kimberlyHypeCard from '@/assets/landing-kimberly-hype-card.png';
import { PublicGameOnCardFrontFace } from './public-game-on-card-front-face';
import { PreviewArtwork } from './hype-card-preview';
import { defaultProject } from './hype-card-types';

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const WEEK_VIDEO = `${BASE_PATH}/week-path-explainer.mp4`;

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
          <a href="#tools" data-testid="link-landing-tools">The tools</a>
        </nav>
        <div className="header-actions">
          <Link href={isSignedIn ? '/studio' : '/sign-in'} className="desktop-account-link" style={{ color: '#d4e0e2', fontSize: 12, fontWeight: 700 }} data-testid={isSignedIn ? 'link-landing-dashboard' : 'link-landing-sign-in'}>{isSignedIn ? 'Studio' : 'Sign in'}</Link>
          <Link href={destination} className="pill pill-lime" data-testid="link-landing-get-started-nav">{isSignedIn ? 'Open studio' : 'Get started'} <ArrowUpRight size={15} aria-hidden="true" /></Link>
          <button type="button" className="menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="landing-mobile-menu" onClick={() => setMenuOpen(value => !value)} data-testid="button-landing-mobile-menu">
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>
      {menuOpen && <nav className="mobile-nav" id="landing-mobile-menu" aria-label="Mobile navigation">
        <a href="#how-it-works" onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-how-it-works">How it works</a>
        <a href="#athlete-cards" onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-athlete-cards">Athlete cards</a>
        <a href="#tools" onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-tools">The tools</a>
        <Link href="/help" onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-help">Help</Link>
        <Link href={isSignedIn ? '/studio' : '/sign-in'} onClick={() => setMenuOpen(false)} data-testid="link-mobile-landing-sign-in">{isSignedIn ? 'Studio' : 'Sign in'}</Link>
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

const stepPreviews: Record<string, { src: string; alt: string; description: string; width: number; height: number }> = {
  '01': {
    src: planEventDetails,
    alt: 'Completed Game On Card for Jessica vs Tigers on September 23, 2026 at 10:15 PM, Upper Park, with Prep, Stat Tracker, and Details actions.',
    description: 'Completed Game On Card',
    width: 1250,
    height: 756,
  },
  '02': {
    src: prepChecklist,
    alt: 'Game vs Tigers prep checklist with six items, private notes, an add prep item button, and a create edit link button.',
    description: 'game-day checklist',
    width: 1160,
    height: 1096,
  },
  '03': {
    src: followStatTracker,
    alt: 'Live Game vs Tigers stat tracker showing Warriors and Tigers tied at zero, set one, and six athlete stat categories.',
    description: 'live stat tracker',
    width: 1160,
    height: 1254,
  },
  '04': {
    src: celebrateVideoReply,
    alt: 'Shared Good Save highlight video with a reply panel, reaction choices, and Card Front, Stats, Videos, and Events navigation.',
    description: 'shared video and reply',
    width: 680,
    height: 824,
  },
};

function FlippableStepCard({
  step: { number, title, description, icon: Icon },
  preview,
}: {
  step: (typeof steps)[number];
  preview: { src: string; alt: string; description: string; width: number; height: number };
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="step-card step-card--flippable" data-flipped={flipped} data-testid={`card-landing-step-${number}`}>
      <div className="plan-flip-inner">
        <div className="plan-face plan-face--front" aria-hidden={flipped}>
          <div className="step-top"><span className="step-icon"><Icon size={18} strokeWidth={2} aria-hidden="true" /></span><span className="step-number">{number}</span></div>
          <h3 className="display">{title}</h3><p>{description}</p>
          <span className="plan-face-cue">Flip for a preview <ArrowRight size={12} aria-hidden="true" /></span>
        </div>
        <div className="plan-face plan-face--back" aria-hidden={!flipped}>
          <img src={preview.src} alt={preview.alt} width={preview.width} height={preview.height} />
          <span className="plan-face-cue">Tap to return to {title} <ArrowRight size={12} aria-hidden="true" /></span>
        </div>
      </div>
      <button
        type="button"
        className="plan-card-toggle"
        aria-pressed={flipped}
        aria-label={flipped ? `${preview.description} preview shown. Return to ${title} card.` : `${title}: ${description} Flip to see a ${preview.description} preview.`}
        onClick={() => setFlipped(value => !value)}
        data-testid={`button-landing-${title.toLowerCase()}-flip`}
      />
    </div>
  );
}

function AthletePreview() {
  return (
    <div className="athlete-showcase">
      <img
        className="landing-athlete-render"
        src={kimberlyHypeCard}
        alt="Kimberly in a pink soccer jersey holding a ball on a Pixl Hype Card, with Card Front, Stats, and Videos tabs."
        width="1228"
        height="1981"
      />
      <span className="showcase-note">Product preview · Hype Card</span>
    </div>
  );
}

function GameOnPreview() {
  return (
    <div className="tool-preview">
      <span className="preview-watermark">Product preview · Fictional event</span>
      <div className="event-preview" role="img" aria-label="Sample Pixl Game On badge for fictional Eastside FC versus Harbor United">
        <div className="event-preview-render" aria-hidden="true">
          <PublicGameOnCardFrontFace
            eventTitle="Eastside FC"
            eventType="game"
            stageLabel="Upcoming game"
            opponent="Harbor United"
            dateLabel="Saturday, October 17"
            time="10:30 AM"
            location="Riverside Park · Field 2"
            athleteName="Maya Rivera"
            athletePageStatus="unpublished"
          />
        </div>
      </div>
    </div>
  );
}

function GraphicPreview() {
  const sampleProject = {
    ...defaultProject(),
    format: 'card' as const,
    layout: 'all-star' as const,
    mediaType: 'image' as const,
    photo: candidAthlete,
    headline: 'GAME DAY',
    playerName: 'Maya Rivera',
    jerseyNumber: '07',
    teamName: 'Eastside FC',
    position: 'Midfield',
    stat: '',
    achievement: '',
    message: '',
    visibility: { stat: false, achievement: false, message: false },
  };
  return (
    <div className="tool-preview">
      <span className="preview-watermark">Product preview · Fictional athlete</span>
      <div className="graphic-preview" role="img" aria-label="Sample Pixl graphic maker game-day card for fictional athlete Maya Rivera">
        <div aria-hidden="true" className="graphic-preview-artwork">
          <PreviewArtwork project={sampleProject} ns="landing-sample" testId="landing-graphic-maker-render" />
        </div>
      </div>
    </div>
  );
}

export function PublicLandingPage() {
  const { isSignedIn } = useUser();
  const destination = isSignedIn ? '/studio' : '/sign-up';
  return (
    <div className="new-landing">
      <LandingNav isSignedIn={Boolean(isSignedIn)} />
      <main>
        <section className="hero" aria-labelledby="landing-headline">
          <div className="container hero-inner">
            <div className="hero-copy">
              <span className="micro">For the people in their corner</span>
              <h1 id="landing-headline" className="display" data-testid="text-landing-headline">Their<br />season.<br /><em>Your front<br />row.</em></h1>
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
              <span className="photo-caption">The moments that make a season</span>
              <div className="hero-message">
                <span className="micro">PIXL athlete card / 07</span>
                <strong>Every player has a story worth sharing.</strong>
                <p>One place for the highlights, photos, and shoutouts.</p>
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
              {steps.map(step => stepPreviews[step.number]
                ? <FlippableStepCard key={step.number} step={step} preview={stepPreviews[step.number]} />
                : <div className="step-card" key={step.number} data-testid={`card-landing-step-${step.number}`}>
                  <div className="step-top"><span className="step-icon"><step.icon size={18} strokeWidth={2} aria-hidden="true" /></span><span className="step-number">{step.number}</span></div>
                  <h3 className="display">{step.title}</h3><p>{step.description}</p>
                </div>)}
            </div>
            <a href={WEEK_VIDEO} target="_blank" rel="noopener noreferrer" className="week-video-link" data-testid="link-landing-week-path-video"><Play size={14} fill="currentColor" aria-hidden="true" /> Watch the week path explainer <ArrowUpRight size={14} aria-hidden="true" /></a>
          </div>
        </section>

        <section className="athlete-section" id="athlete-cards" aria-labelledby="athlete-heading">
          <div className="container athlete-grid">
            <AthletePreview />
            <div className="athlete-copy">
              <span className="micro">More than a profile</span>
              <h2 className="display" id="athlete-heading">Give their moments a home.</h2>
              <p>Make an athlete card they’ll want to show off. Add photos and media, share it with family, and let supporters send a shoutout.</p>
              <ul className="check-list">
                <li><Check size={16} aria-hidden="true" /> Make it theirs</li>
                <li><Check size={16} aria-hidden="true" /> Share it easily</li>
                <li><Check size={16} aria-hidden="true" /> Collect the encouragement</li>
              </ul>
              <Link href={destination} className="pill pill-navy" data-testid="link-landing-athlete-cards-cta">Explore athlete cards <ArrowUpRight size={16} aria-hidden="true" /></Link>
            </div>
          </div>
        </section>

        <section className="tools-section" id="tools" aria-labelledby="tools-heading">
          <div className="container">
            <div className="tools-intro section-intro">
              <div><span className="micro">Made for real life around sports</span><h2 className="display" id="tools-heading">The little things<br />make the week.</h2></div>
              <p>Useful tools for the rides, the sidelines, and the moments everyone wants to remember.</p>
            </div>
            <div className="tool-grid">
              <article className="tool-card">
                <GameOnPreview />
                <div className="tool-card-body"><span className="micro">01 / Bring everyone along</span><h3 className="display">Make game day feel real</h3><p>Create a Game On card for each event, then open it for the details and next steps.</p><Link href={destination} data-testid="link-landing-game-on-tool">Explore Game On <ArrowUpRight className="arrow" aria-hidden="true" /></Link></div>
              </article>
              <article className="tool-card">
                <GraphicPreview />
                <div className="tool-card-body"><span className="micro">02 / Keep the moment</span><h3 className="display">Share the excitement</h3><p>Make a graphic that’s easy to send and fun to keep.</p><Link href={destination} data-testid="link-landing-graphic-tool">Explore graphic maker <ArrowUpRight className="arrow" aria-hidden="true" /></Link></div>
              </article>
            </div>
          </div>
        </section>

        <section className="closing" aria-labelledby="closing-heading">
          <div className="container">
            <span className="micro">We guide their week</span>
            <h2 className="display" id="closing-heading">Every game week has a<br />story.</h2>
            <p>Bring the plans, the people, and the good stuff together.</p>
            <Link href={destination} className="pill pill-lime" data-testid="link-landing-closing-cta">{isSignedIn ? 'Open studio' : 'Explore the tools'} <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>
      <footer className="site-footer">
        <div className="container footer-inner">
          <Link href="/" data-testid="link-footer-home"><Brand /></Link>
          <p>Built for the people who show up.</p>
          <nav className="footer-links" aria-label="Footer navigation">
            <Link href="/studio" data-testid="link-footer-tools">Studio</Link>
            <Link href="/help" data-testid="link-footer-help">Help / FAQ</Link>
            <Link href="/privacy" data-testid="link-footer-privacy">Privacy</Link>
             <Link href={isSignedIn ? '/studio' : '/sign-in'} data-testid="link-footer-sign-in">{isSignedIn ? 'Studio' : 'Sign in'}</Link>
          </nav>
        </div>
        <div className="container footer-bottom">© {new Date().getFullYear()} PIXL Sports. Illustrative previews feature fictional athletes and events.</div>
      </footer>
    </div>
  );
}