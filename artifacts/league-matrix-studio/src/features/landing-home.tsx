import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { CalendarDays, Activity, Zap, ArrowRight, Check, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';

// Using responsive images
import statTrackerLive from '@/assets/stat-tracker-live-768.webp';
import gameDayChecklist from '@/assets/game-day-checklist-768.webp';
import hypeCardRecipientPreview from '@/assets/hype-card-recipient-preview.png';
import sidelineParents from '../../../../attached_assets/generated_images/sideline-parents.jpg';
import sportsBanner from '../../../../attached_assets/homepagesportsbanner_1790120971871.png';
import planChecklistVideo from '../../../../attached_assets/Officialprep_1789962901507.mp4';
import planChecklistPoster from '../../../../attached_assets/Officialprep_1789962901507-poster.webp';

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    return () => mediaQuery.removeEventListener('change', updatePreference);
  }, []);

  return prefersReducedMotion;
}

function BrandMark() {
  return (
    <span className="flex items-center">
      <img
        src={`${BASE_PATH}/pixlsports-logo.png`}
        alt="Pixl Sports"
        className="h-9 w-auto object-contain sm:h-10"
      />
    </span>
  );
}

function LandingNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isSignedIn } = useUser();

  return (
    <header className="sticky top-0 z-50 bg-landing-white border-b border-landing-gray/20">
      <div className="mx-auto flex h-[72px] sm:h-20 max-w-7xl items-center justify-between px-6 lg:px-8">
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-80" data-testid="link-landing-home">
          <BrandMark />
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          <a href="#tools" className="text-[15px] font-semibold text-landing-text hover:text-landing-orange transition-colors" data-testid="link-landing-tools">Tools</a>
          <a href="#how-it-works" className="text-[15px] font-semibold text-landing-text hover:text-landing-orange transition-colors" data-testid="link-landing-how-it-works">How It Works</a>
          <a href="#pricing" className="text-[15px] font-semibold text-landing-text hover:text-landing-orange transition-colors" data-testid="link-landing-pricing">Pricing</a>
          {isSignedIn ? (
            <Link href="/studio" className="text-[15px] font-semibold text-landing-text hover:text-landing-orange transition-colors" data-testid="link-landing-dashboard">Dashboard</Link>
          ) : (
            <Link href="/sign-in" className="text-[15px] font-semibold text-landing-text hover:text-landing-orange transition-colors" data-testid="link-landing-sign-in">Sign In</Link>
          )}
          <Link href="/sign-up" className="inline-flex items-center justify-center rounded-sm bg-landing-primary px-6 py-2.5 text-[15px] font-bold text-landing-white transition-transform hover:-translate-y-0.5 shadow-sm" data-testid="link-landing-get-started-nav">
            Get Started
          </Link>
        </nav>
        <button type="button" className="grid min-h-11 min-w-11 place-items-center md:hidden text-landing-text" onClick={() => setMenuOpen(!menuOpen)} aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="landing-mobile-menu" data-testid="button-landing-mobile-menu">
          {menuOpen ? <X className="h-7 w-7" /> : <Menu className="h-7 w-7" />}
        </button>
      </div>
      {menuOpen && (
        <div id="landing-mobile-menu" className="absolute inset-x-0 top-[72px] sm:top-20 bg-landing-white border-b border-landing-gray/20 p-6 shadow-xl md:hidden flex flex-col gap-4">
          <a href="#tools" onClick={() => setMenuOpen(false)} className="text-lg font-bold text-landing-text" data-testid="link-mobile-landing-tools">Tools</a>
          <a href="#how-it-works" onClick={() => setMenuOpen(false)} className="text-lg font-bold text-landing-text" data-testid="link-mobile-landing-how-it-works">How It Works</a>
          <a href="#pricing" onClick={() => setMenuOpen(false)} className="text-lg font-bold text-landing-text" data-testid="link-mobile-landing-pricing">Pricing</a>
          {isSignedIn ? (
            <Link href="/studio" onClick={() => setMenuOpen(false)} className="text-lg font-bold text-landing-text" data-testid="link-mobile-landing-dashboard">Dashboard</Link>
          ) : (
            <Link href="/sign-in" onClick={() => setMenuOpen(false)} className="text-lg font-bold text-landing-text" data-testid="link-mobile-landing-sign-in">Sign In</Link>
          )}
        </div>
      )}
    </header>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-landing-gray/20 bg-landing-white py-12">
      <div className="mx-auto max-w-7xl px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex flex-col items-center md:items-start gap-4">
          <BrandMark />
          <p className="text-sm font-medium text-landing-gray">We guide the week. You capture the moments.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-4 text-sm font-bold uppercase tracking-wider text-landing-gray">
          <Link href="/studio" className="hover:text-landing-text transition-colors" data-testid="link-footer-tools">Tools</Link>
          <Link href="/help" className="hover:text-landing-text transition-colors" data-testid="link-footer-help">Help / FAQ</Link>
          <Link href="/privacy" className="hover:text-landing-text transition-colors" data-testid="link-footer-privacy">Privacy</Link>
          <Link href="/sign-in" className="hover:text-landing-text transition-colors" data-testid="link-footer-sign-in">Sign In</Link>
        </div>
        <div className="text-xs text-landing-gray/60 font-medium">
          &copy; {new Date().getFullYear()} Pixl Sports
        </div>
      </div>
    </footer>
  );
}

function LandingSportShowcase() {
  return (
    <div className="landing-sports-banner-wrap" data-testid="landing-sport-showcase">
      <div className="landing-sports-banner-mobile-heading">
        <p>Supported sports</p>
        <h2 className="font-display">One game-week flow. <span>Six sports.</span></h2>
      </div>
      <div className="landing-sports-banner-scroll" role="region" aria-label="Supported sports banner" tabIndex={0}>
        <img
          src={sportsBanner}
          alt="Supported sports: one game-week flow for soccer, football, basketball, volleyball, baseball, and softball. Plan it. Follow it. Celebrate it."
          width={2146}
          height={733}
          className="landing-sports-banner"
          data-testid="landing-sports-banner"
        />
      </div>
      <p className="landing-sports-banner-hint">Swipe to see all six sports</p>
    </div>
  );
}

export function PublicLandingPage() {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <div className="new-landing">
      <LandingNav />
      <main>
        {/* HERO SECTION */}
        <section className="relative overflow-hidden bg-landing-bg pt-12 pb-16 sm:pt-20 sm:pb-24 lg:pb-32">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="mx-auto max-w-4xl text-center">
              <span className="inline-block text-landing-orange font-extrabold uppercase tracking-widest text-xs mb-5">
                YOUR SEASON, GUIDED
              </span>
              <h1 className="font-display text-5xl sm:text-6xl lg:text-[76px] font-extrabold leading-[0.92] text-landing-text mb-6">
                <span className="landing-hero-slam inline-block">We guide your week.</span><br />
                <span className="text-landing-primary">You capture the moments.</span>
              </h1>
              <p className="mx-auto mb-10 max-w-2xl text-lg font-medium leading-[1.6] text-landing-text/75 sm:text-[21px]">
                From planning the week to following game day and celebrating the final whistle, Pixl puts the right tool in front of you at every step.
              </p>
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Link href="/sign-up" className="w-full sm:w-auto inline-flex items-center justify-center rounded-md bg-landing-primary px-8 py-[18px] text-[17px] font-bold text-landing-white transition-transform hover:-translate-y-0.5 shadow-sm" data-testid="link-hero-get-started">
                  Get started free
                </Link>
                <a href="#tools" className="group w-full sm:w-auto inline-flex items-center justify-center rounded-md border border-landing-gray/30 bg-transparent px-8 py-[18px] text-[17px] font-bold text-landing-text hover:border-landing-primary hover:text-landing-orange transition-colors" data-testid="link-hero-explore-tools">
                  Explore the tools <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                </a>
              </div>
            </div>
            <LandingSportShowcase />
          </div>
        </section>

        {/* BENEFITS SECTION */}
        <section className="bg-landing-white py-12 sm:py-20 border-y border-landing-gray/15">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="grid grid-cols-3 divide-x divide-landing-gray/15">
              <div className="flex min-w-0 flex-col items-center px-2 text-center sm:items-start sm:px-8 sm:text-left lg:pr-12">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-landing-pale-blue text-landing-primary sm:mb-6 sm:h-16 sm:w-16 sm:rounded-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-3 h-3 bg-landing-orange/20 rounded-bl-xl"></div>
                  <CalendarDays className="h-6 w-6 sm:h-8 sm:w-8 relative z-10" strokeWidth={1.5} />
                </div>
                <h3 className="mb-2 font-display text-lg font-bold leading-none text-landing-text sm:mb-3 sm:text-[28px]">Plan the week</h3>
                <p className="text-[11px] font-medium leading-snug text-landing-text/70 sm:text-[17px] sm:font-normal sm:leading-relaxed">
                  Keep schedules, locations, and team information together in one clear place.
                </p>
              </div>
              
              <div className="flex min-w-0 flex-col items-center px-2 text-center sm:items-start sm:px-8 sm:text-left lg:px-12">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-landing-pale-blue text-landing-primary sm:mb-6 sm:h-16 sm:w-16 sm:rounded-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-3 h-3 bg-landing-orange/20 rounded-bl-xl"></div>
                  <Activity className="h-6 w-6 sm:h-8 sm:w-8 relative z-10" strokeWidth={1.5} />
                </div>
                <h3 className="mb-2 font-display text-lg font-bold leading-none text-landing-text sm:mb-3 sm:text-[28px]">Follow the game</h3>
                <p className="text-[11px] font-medium leading-snug text-landing-text/70 sm:text-[17px] sm:font-normal sm:leading-relaxed">
                  Track live stats, scores, and important moments as they happen.
                </p>
              </div>

              <div className="flex min-w-0 flex-col items-center px-2 text-center sm:items-start sm:px-8 sm:text-left lg:pl-12">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-landing-pale-blue text-landing-primary sm:mb-6 sm:h-16 sm:w-16 sm:rounded-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-3 h-3 bg-landing-orange/20 rounded-bl-xl"></div>
                  <Zap className="h-6 w-6 sm:h-8 sm:w-8 relative z-10" strokeWidth={1.5} />
                </div>
                <h3 className="mb-2 font-display text-lg font-bold leading-none text-landing-text sm:mb-3 sm:text-[28px]">Celebrate the moment</h3>
                <p className="text-[11px] font-medium leading-snug text-landing-text/70 sm:text-[17px] sm:font-normal sm:leading-relaxed">
                  Turn highlights into shareable graphics athletes and families are proud of.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* GUIDED WEEK SECTION */}
        <section id="how-it-works" className="py-24 sm:py-32 bg-landing-bg">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-20">
              <h2 className="font-display text-4xl sm:text-5xl lg:text-[56px] font-extrabold text-landing-text mb-6 leading-[0.95]">
                Your week, guided from start to finish.
              </h2>
              <p className="text-lg sm:text-[21px] text-landing-text/75 font-medium leading-relaxed">
                Pixl keeps the next step clear—from adding the schedule to following game day and sharing the moments afterward.
              </p>
            </div>

            <div className="relative">
              <div className="absolute bottom-24 left-[84px] top-24 hidden w-0.5 bg-landing-text/10 lg:block" aria-hidden="true" />

              <div className="relative z-10 flex flex-col gap-8 sm:gap-10">
                {/* Step 1 */}
                <div className="pixl-gradient-edge relative grid grid-cols-1 gap-8 rounded-[2rem] border border-landing-gray/15 bg-landing-white p-6 shadow-sm sm:p-10 lg:grid-cols-[168px_minmax(0,1fr)] lg:items-start lg:gap-10 overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-landing-orange/60"></div>
                  <div className="relative flex justify-center lg:justify-start">
                    <div className="flex h-[136px] w-[136px] items-center justify-center rounded-full border-2 border-landing-text/10 bg-landing-bg shadow-sm">
                      <div className="flex h-[116px] w-[116px] items-center justify-center rounded-full bg-landing-white">
                        <span className="font-display text-5xl font-extrabold text-landing-text">01</span>
                      </div>
                    </div>
                  </div>
                  <div className="landing-before-game-day-content grid grid-cols-1 items-start gap-10 lg:grid-cols-2 lg:gap-12">
                    <div className="flex flex-col">
                      <h3 className="mb-5 text-center font-display text-[32px] font-bold text-landing-text lg:text-left" data-testid="landing-before-game-day-title">Before game day</h3>
                      <ul className="mx-auto w-full max-w-[420px] space-y-4 text-[17px] font-medium text-landing-text/80 lg:mx-0">
                        <li className="flex items-start gap-3">
                          <Check className="mt-1 h-5 w-5 shrink-0 text-landing-orange" aria-hidden="true" />
                          Build the schedule
                        </li>
                        <li className="flex items-start gap-3">
                          <Check className="mt-1 h-5 w-5 shrink-0 text-landing-orange" aria-hidden="true" />
                          Share your event card to keep others up to date
                        </li>
                        <li className="flex items-start gap-3">
                          <Check className="mt-1 h-5 w-5 shrink-0 text-landing-orange" aria-hidden="true" />
                          Prepare with the game day checklist
                        </li>
                      </ul>
                    </div>
                    <div className="flex items-start justify-center lg:pt-0">
                      <video
                        src={planChecklistVideo}
                        autoPlay={!prefersReducedMotion}
                        muted
                        loop
                        playsInline
                        poster={planChecklistPoster}
                        preload="metadata"
                        aria-label="Plan and game day checklist video"
                        data-testid="landing-checklist-video"
                        className="landing-checklist-video w-full max-w-[240px] object-cover"
                      />
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="pixl-gradient-edge relative grid grid-cols-1 gap-8 rounded-[2rem] border border-landing-primary/10 bg-landing-pale-blue p-6 shadow-sm sm:p-10 lg:grid-cols-[168px_minmax(0,1fr)] lg:items-start lg:gap-10 overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-landing-orange/80"></div>
                  <div className="relative flex justify-center lg:justify-start">
                    <div className="flex h-[136px] w-[136px] items-center justify-center rounded-full border-2 border-landing-primary/15 bg-landing-white shadow-sm">
                      <div className="flex h-[116px] w-[116px] items-center justify-center rounded-full bg-landing-white">
                        <span className="font-display text-5xl font-extrabold text-landing-text">02</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-5 text-center font-display text-[32px] font-bold text-landing-text lg:text-left">During the game</h3>
                    <ul className="mx-auto w-full max-w-[560px] space-y-4 text-[17px] font-medium text-landing-text/80 lg:mx-0">
                      <li className="flex items-start gap-3">
                        <Check className="mt-1 h-5 w-5 shrink-0 text-landing-orange" aria-hidden="true" />
                        Follow the live action
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="mt-1 h-5 w-5 shrink-0 text-landing-orange" aria-hidden="true" />
                        Track stats and key moments
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="mt-1 h-5 w-5 shrink-0 text-landing-orange" aria-hidden="true" />
                        Keep supporters connected
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="pixl-gradient-edge relative grid grid-cols-1 gap-8 rounded-[2rem] border border-landing-orange/15 bg-[#FFF1EA] p-6 shadow-sm sm:p-10 lg:grid-cols-[168px_minmax(0,1fr)] lg:items-start lg:gap-10 overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-landing-orange"></div>
                  <div className="relative flex justify-center lg:justify-start">
                    <div className="flex h-[136px] w-[136px] items-center justify-center rounded-full border-2 border-landing-orange/15 bg-landing-white shadow-sm">
                      <div className="flex h-[116px] w-[116px] items-center justify-center rounded-full bg-landing-primary">
                        <span className="font-display text-5xl font-extrabold text-landing-white">03</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-5 text-center font-display text-[32px] font-bold text-landing-text lg:text-left">After the final whistle</h3>
                    <ul className="mx-auto w-full max-w-[560px] space-y-4 text-[17px] font-medium text-landing-text/80 lg:mx-0">
                      <li className="flex items-start gap-3">
                        <Check className="mt-1 h-5 w-5 shrink-0 text-landing-orange" aria-hidden="true" />
                        Celebrate the performance
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="mt-1 h-5 w-5 shrink-0 text-landing-orange" aria-hidden="true" />
                        Create athlete graphics
                      </li>
                      <li className="flex items-start gap-3">
                        <Check className="mt-1 h-5 w-5 shrink-0 text-landing-orange" aria-hidden="true" />
                        Share highlights and memories
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PRODUCT PREVIEW SECTION */}
        <section id="tools" className="scroll-mt-20 py-24 sm:py-32 bg-landing-white border-y border-landing-gray/15 overflow-hidden">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-center">
              <div>
                <h2 className="font-display text-4xl sm:text-5xl lg:text-[56px] font-extrabold text-landing-text mb-6 leading-[0.95]">
                  Tools made for the moments.
                </h2>
                <p className="text-lg sm:text-[21px] text-landing-text/75 mb-12 font-medium leading-relaxed">
                  Every tool connects to a clear benefit, giving you everything you need without the bloat of management software.
                </p>
                
                <div className="space-y-8 relative">
                  <div className="absolute left-[11px] top-4 bottom-4 w-px bg-landing-gray/15" />
                  
                  <div className="block relative pl-10" data-testid="preview-schedule">
                    <div className="absolute left-0 top-2.5 w-6 h-6 rounded-full bg-landing-white border-2 border-landing-gray/30 flex items-center justify-center">
                       <div className="w-2 h-2 rounded-full bg-landing-orange opacity-0" />
                    </div>
                    <h4 className="font-display text-[26px] font-bold text-landing-text mb-1">
                      Schedule Maker
                    </h4>
                    <p className="text-[17px] text-landing-text/70 font-medium">Know what is happening next.</p>
                  </div>
                  <div className="block relative pl-10" data-testid="preview-checklist">
                    <div className="absolute left-0 top-2.5 w-6 h-6 rounded-full bg-landing-white border-2 border-landing-gray/30 flex items-center justify-center">
                       <div className="w-2 h-2 rounded-full bg-landing-orange opacity-0" />
                    </div>
                    <h4 className="font-display text-[26px] font-bold text-landing-text mb-1">
                      Game-Day Checklist
                    </h4>
                    <p className="text-[17px] text-landing-text/70 font-medium">Arrive prepared.</p>
                  </div>
                  <div className="block relative pl-10" data-testid="preview-stat-tracker">
                    <div className="absolute left-0 top-2.5 w-6 h-6 rounded-full bg-landing-white border-2 border-landing-gray/30 flex items-center justify-center">
                       <div className="w-2 h-2 rounded-full bg-landing-orange opacity-0" />
                    </div>
                    <h4 className="font-display text-[26px] font-bold text-landing-text mb-1">
                      Live Stat Tracker
                    </h4>
                    <p className="text-[17px] text-landing-text/70 font-medium">Follow the action.</p>
                  </div>
                  <div className="block relative pl-10" data-testid="preview-hype-card">
                    <div className="absolute left-0 top-2.5 w-6 h-6 rounded-full bg-landing-white border-2 border-landing-gray/30 flex items-center justify-center">
                       <div className="w-2 h-2 rounded-full bg-landing-orange opacity-0" />
                    </div>
                    <h4 className="font-display text-[26px] font-bold text-landing-text mb-1">
                      Athlete Hype Card
                    </h4>
                    <p className="text-[17px] text-landing-text/70 font-medium">Celebrate and share the moment.</p>
                  </div>
                </div>
              </div>

              <div className="relative h-[480px] sm:h-[650px] w-full">
                {/* Decorative overlapping composition */}
                <div className="pixl-gradient-edge absolute top-0 right-0 w-[65%] sm:w-[55%] rounded-2xl shadow-2xl border border-landing-gray/15 overflow-hidden z-20 hover:-translate-y-1 transition-transform duration-300">
                  <img src={statTrackerLive} alt="Stat Tracker preview" className="w-full h-auto object-cover" />
                </div>
                <div className="pixl-gradient-edge absolute bottom-4 right-[10%] w-[60%] sm:w-[50%] rounded-2xl shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] border border-landing-gray/15 overflow-hidden z-30 hover:-translate-y-1 transition-transform duration-300">
                  <img src={hypeCardRecipientPreview} alt="Hype Card preview" className="w-full h-auto object-cover" />
                </div>
                <div className="pixl-gradient-edge absolute top-[25%] left-0 w-[70%] sm:w-[60%] rounded-2xl shadow-xl border border-landing-gray/15 overflow-hidden z-10 hover:-translate-y-1 transition-transform duration-300">
                  <img src={gameDayChecklist} alt="Checklist preview" className="w-full h-auto object-cover" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* AUDIENCE SECTION */}
        <section className="py-24 sm:py-32 bg-landing-pale-blue">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="flex flex-col lg:flex-row-reverse items-center gap-16 lg:gap-24">
              <div className="flex-1 text-center lg:text-left">
                <span className="inline-block text-landing-orange font-extrabold uppercase tracking-widest text-sm mb-5">
                  BUILT FOR THE PEOPLE ON THE SIDELINE
                </span>
                <h2 className="font-display text-4xl sm:text-5xl lg:text-[56px] font-extrabold text-landing-text mb-6 leading-[0.95]">
                  Stay connected without managing another complicated sports app.
                </h2>
                <p className="text-lg sm:text-[21px] text-landing-text/75 mb-10 max-w-xl mx-auto lg:mx-0 font-medium leading-relaxed">
                  Pixl organizes the information you need and helps you turn the moments you love into something worth sharing.
                </p>
              </div>
              <div className="flex-1 w-full relative">
                <div className="aspect-[4/3] rounded-3xl overflow-hidden shadow-2xl border-[6px] border-landing-white">
                  <img 
                    src={sidelineParents} 
                    alt="Parents smiling on the sideline"
                     width={1024}
                     height={1024}
                     loading="lazy"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section id="pricing" className="scroll-mt-20 bg-landing-text py-24 sm:py-32 text-center">
          <div className="mx-auto max-w-4xl px-6 lg:px-8">
            <h2 className="font-display text-5xl sm:text-6xl lg:text-[72px] font-extrabold text-landing-white mb-6 leading-[0.92]">
              Let Pixl guide your next game week.
            </h2>
            <p className="text-xl sm:text-[24px] text-landing-white/70 mb-12 max-w-2xl mx-auto font-medium">
              Bring the schedule, the action, and the celebration together in one place.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
              <Link href="/sign-up" className="w-full sm:w-auto inline-flex items-center justify-center rounded-md bg-landing-primary px-10 py-5 text-[19px] font-bold text-landing-white transition-transform hover:-translate-y-0.5 shadow-md" data-testid="link-final-get-started">
                Get started free
              </Link>
              <a href="#tools" className="w-full sm:w-auto inline-flex items-center justify-center rounded-md border-2 border-landing-white/20 bg-transparent px-10 py-5 text-[19px] font-bold text-landing-white hover:bg-landing-white hover:text-landing-text transition-colors" data-testid="link-final-explore-tools">
                Explore the tools
              </a>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
