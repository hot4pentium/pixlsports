import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ArrowDown, ArrowRight, Check, ChevronDown, CircleHelp, Crown, Download, Layers3, ShieldCheck, Sparkles, UsersRound } from 'lucide-react';

import { PreviewArtwork } from './hype-card-preview';
import { defaultProject, type CardFinishId, type HypeCardProject } from './hype-card-types';
import './season-pass-preview.css';

type Athlete = {
  id: string;
  name: string;
  number: string;
  sport: string;
  team: string;
  position: string;
  palette: HypeCardProject['palette'];
  finish: CardFinishId;
  stat: string;
  highlights: string[];
  illustration: string;
};

function athleteIllustration(top: string, jersey: string, trim: string, pose: 'pitch' | 'hoop') {
  const shape = pose === 'pitch'
    ? `<path d="M194 132c12-35 34-53 67-53 29 0 50 16 63 47l29 76-34 13-20-39 4 102H198l4-99-21 41-33-17 46-71Z" fill="${jersey}"/><path d="m200 166-31 47 22 15 31-43M300 160l35 48-23 18-31-44" fill="none" stroke="${trim}" stroke-width="13" stroke-linecap="round"/><path d="M220 280h28l-6 85h-39l17-85Zm43 0h29l24 85h-39l-14-85Z" fill="#182b45"/><path d="m207 360-7 17h48l2-16m33 0 4 16h44l-5-17" fill="#f6f2e8"/>`
    : `<path d="M194 133c14-35 36-53 67-53 30 0 52 18 66 50l23 69-33 15-17-39 7 105H191l6-103-19 42-33-17 49-69Z" fill="${jersey}"/><path d="M205 169 175 214l24 15 31-43m61-15 34 48-23 17-31-44" fill="none" stroke="${trim}" stroke-width="13" stroke-linecap="round"/><path d="M219 280h28l-13 82h-40l25-82Zm43 0h30l25 82h-40l-15-82Z" fill="#182b45"/><circle cx="357" cy="182" r="26" fill="#d58c48"/><path d="M341 163c20 6 29 19 31 37m-37-9 42-18" fill="none" stroke="#633d2e" stroke-width="2"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 510"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="#101d32"/></linearGradient><radialGradient id="light"><stop stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="500" height="510" fill="url(#bg)"/><circle cx="252" cy="177" r="210" fill="url(#light)" opacity=".38"/><path d="M0 335 500 250v260H0Z" fill="#081426" opacity=".48"/><path d="M0 382h500M0 410h500M0 438h500" stroke="#fff" stroke-opacity=".13" stroke-width="2"/>${Array.from({ length: 13 }, (_, i) => `<circle cx="${25 + i * 39}" cy="${72 + (i % 3) * 17}" r="${i % 4 === 0 ? 5 : 3}" fill="${i % 2 ? '#ff784f' : '#a9d6ff'}" opacity=".8"/>`).join('')}<circle cx="262" cy="65" r="43" fill="#96674e"/><path d="M220 63c4-33 21-53 48-49 23 3 36 19 37 44-17-13-43-19-85 5Z" fill="#182033"/>${shape}<path d="M242 154h39v48h-39z" fill="${trim}" opacity=".96"/><text x="260" y="189" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="25" font-weight="900">12</text><path d="M90 510c17-88 58-139 127-153h89c69 14 110 65 127 153" fill="#0b1728" opacity=".35"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.replace('>12</text>', `>${pose === 'pitch' ? '12' : '08'}</text>`))}`;
}

const ATHLETES: Athlete[] = [
  {
    id: 'maya',
    name: 'Maya Chen',
    number: '12',
    sport: 'Soccer',
    team: 'Northside Comets',
    position: 'Midfielder',
    palette: 'coral',
    finish: 'gold-spotlight',
    stat: '4 assists',
    highlights: ['First tournament start', 'A pass that changed the game', 'Team’s final whistle huddle'],
    illustration: athleteIllustration('#ef855c', '#2779b8', '#e9c778', 'pitch'),
  },
  {
    id: 'eli',
    name: 'Eli Brooks',
    number: '08',
    sport: 'Basketball',
    team: 'Harbor Hawks',
    position: 'Guard',
    palette: 'teal',
    finish: 'cosmic-clash',
    stat: '11 rebounds',
    highlights: ['First three-pointer', 'The extra pass', 'Big defensive stop'],
    illustration: athleteIllustration('#358b84', '#dc654f', '#f2c554', 'hoop'),
  },
];

const LOOKS: Array<{ id: CardFinishId; title: string; note: string; layout: HypeCardProject['layout'] }> = [
  { id: 'gold-spotlight', title: 'Spotlight', note: 'Stadium light, quiet confidence', layout: 'all-star' },
  { id: 'cosmic-clash', title: 'Signature', note: 'Blue and orange arena edges', layout: 'dugout' },
  { id: 'neon-prism', title: 'Walkout', note: 'A dark corridor with warm gold light', layout: 'rookie' },
];

const INTERVIEW_QUESTIONS = [
  'Thinking about a typical season, how useful would it be to make more than one polished card for your athlete?',
  'Which, if any, of these ideas feels most valuable: more card designs, profiles for multiple athletes, or a downloadable season keepsake? What makes you say that?',
  'What would make a season keepsake feel worth keeping or sharing? What would make it feel unnecessary?',
  'If a one-season pass like this were offered, how would you decide whether it was worth paying for? What would you compare it with?',
  'What concerns or missing details would you want answered before deciding?',
];

export default function SeasonPassPreview() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Season Pass Research Preview | Pixl Sports';
    const description = 'Explore a fictional one-season family pass with Hype Card designs, multiple athletes, and a keepsake concept. Research only; no purchase available.';
    const cleanups = [
      ['name', 'description', description],
      ['name', 'robots', 'noindex, nofollow'],
      ['property', 'og:title', document.title],
      ['property', 'og:description', description],
      ['property', 'og:type', 'website'],
    ].map(([attribute, key, content]) => {
      const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
      const element = existing ?? document.createElement('meta');
      const previous = element.getAttribute('content');
      element.setAttribute(attribute, key);
      element.content = content;
      if (!existing) document.head.appendChild(element);
      return () => {
        if (!existing) element.remove();
        else if (previous === null) element.removeAttribute('content');
        else element.content = previous;
      };
    });
    return () => {
      document.title = previousTitle;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);
  const [athleteId, setAthleteId] = useState(ATHLETES[0].id);
  const [selectedLook, setSelectedLook] = useState<CardFinishId>(ATHLETES[0].finish);
  const [selectedMoments, setSelectedMoments] = useState<string[]>(ATHLETES[0].highlights.slice(0, 2));
  const [interviewOpen, setInterviewOpen] = useState(false);
  const athlete = ATHLETES.find((item) => item.id === athleteId) ?? ATHLETES[0];
  const selectedLookName = LOOKS.find((look) => look.id === selectedLook)?.title ?? 'Spotlight';

  const project = useMemo<HypeCardProject>(() => ({
    ...defaultProject(),
    headline: 'A SEASON TO REMEMBER',
    mediaType: 'image',
    photo: athlete.illustration,
    playerName: athlete.name,
    jerseyNumber: athlete.number,
    teamName: athlete.team,
    position: athlete.position,
    stat: athlete.stat,
    achievement: 'Season highlight',
    message: 'Every little moment counts.',
    palette: athlete.palette,
    finish: selectedLook,
    layout: LOOKS.find((look) => look.id === selectedLook)!.layout,
    template: 'spotlight',
    format: 'card',
    visibility: { stat: true, achievement: true, message: true },
  }), [athlete, selectedLook]);

  const selectAthlete = (nextId: string) => {
    const nextAthlete = ATHLETES.find((item) => item.id === nextId);
    if (!nextAthlete) return;
    setAthleteId(nextId);
    setSelectedLook(nextAthlete.finish);
    setSelectedMoments(nextAthlete.highlights.slice(0, 2));
  };

  const toggleMoment = (moment: string) => {
    setSelectedMoments((current) => current.includes(moment)
      ? current.filter((item) => item !== moment)
      : [...current, moment]);
  };

  return (
    <main className="season-pass-page" data-testid="season-pass-preview-page">
      <div className="sp-shell">
        <header className="sp-topline">
          <Link href="/" className="sp-wordmark" aria-label="Pixl Sports home" data-testid="link-pixl-home">
            <span className="sp-mark" aria-hidden="true">P</span>
            <span>PIXL <b>SPORTS</b></span>
          </Link>
          <span className="sp-research-label"><span /> RESEARCH PREVIEW</span>
        </header>

        <section className="sp-hero" aria-labelledby="sp-title">
          <div className="sp-hero-copy">
            <p className="sp-kicker"><span className="sp-kicker-line" /> A season, held onto</p>
            <h1 id="sp-title">More of the moments<br /><em>they’ll remember.</em></h1>
            <p className="sp-intro">A proposed Season Pass could give families more ways to turn the season into athlete-first artwork—one card, one proud moment at a time.</p>
            <div className="sp-hero-proof">
              <span className="sp-proof-icon"><ShieldCheck size={17} /></span>
              <p><strong>One pass. One season.</strong><br />Your season’s cards and keepsakes stay yours to revisit.</p>
            </div>
            <a className="sp-scroll-link" href="#try-the-preview" data-testid="link-explore-preview">
              Explore the idea <ArrowDown size={15} />
            </a>
          </div>
          <div className="sp-hero-art" aria-label="Sample HYPE Card artwork">
            <div className="sp-art-orbit sp-orbit-one" />
            <div className="sp-art-orbit sp-orbit-two" />
            <div className="sp-art-stamp">THE<br />SEASON<br />EDITION</div>
            <div className="sp-main-card">
              <PreviewArtwork project={project} ns="season-pass-hero" testId="artwork-season-card" />
            </div>
            <div className="sp-floating-note"><Sparkles size={14} /> Made for the whole season</div>
            <div className="sp-card-caption"><span>01 / 03</span> A look that feels like theirs</div>
          </div>
        </section>

        <section className="sp-concept-bar" data-testid="notice-research-only">
          <div className="sp-concept-symbol"><CircleHelp size={18} /></div>
          <div><strong>This is a concept under research.</strong><span>No purchase is available. The final offer and price have not been decided.</span></div>
          <span className="sp-no-price">NOT FOR SALE</span>
        </section>

        <section className="sp-baseline" aria-labelledby="baseline-title">
          <div className="sp-section-heading">
            <p className="sp-eyebrow">THE IDEA, IN CONTEXT</p>
            <h2 id="baseline-title">Start with what’s free.<br /><span>Imagine what a season could hold.</span></h2>
          </div>
          <div className="sp-compare">
            <article className="sp-compare-card sp-free">
              <div className="sp-compare-top"><span className="sp-small-index">01</span><span className="sp-tag">FREE BASELINE</span></div>
              <h3>HYPE Cards, as they are</h3>
              <p>Make a basic HYPE Card and share it with the people who cheer them on.</p>
              <ul>
                <li><Check size={15} /> Basic HYPE Card creation</li>
                <li><Check size={15} /> Share a card with family and friends</li>
              </ul>
              <div className="sp-compare-foot">A card for the moment.</div>
            </article>
            <div className="sp-compare-bridge" aria-hidden="true"><ArrowRight size={18} /></div>
            <article className="sp-compare-card sp-pass">
              <div className="sp-compare-top"><span className="sp-small-index">02</span><span className="sp-tag">PROPOSED · ONE SEASON</span></div>
              <h3>A fuller season story</h3>
              <p>A proposed pass could add a little more room to celebrate, collect, and look back.</p>
              <ul>
                <li><Layers3 size={15} /> Premium HYPE Card designs</li>
                <li><UsersRound size={15} /> Multiple athlete profiles</li>
                <li><Download size={15} /> A downloadable season keepsake</li>
              </ul>
              <div className="sp-compare-foot">More ways to keep the season close.</div>
            </article>
          </div>
          <p className="sp-term-note"><span className="sp-term-mark" /> The pass would last for one season. When it expires, previously created cards, public share links, and purchased keepsakes would remain viewable and shareable.</p>
        </section>

        <section className="sp-preview-lab" id="try-the-preview" aria-labelledby="preview-title">
          <div className="sp-lab-heading">
            <div>
              <p className="sp-eyebrow">A LOCAL-ONLY SAMPLE</p>
              <h2 id="preview-title">See the season take shape.</h2>
              <p>Switch between two fictional athletes, try three proposed looks, and assemble a sample keepsake. Nothing is saved or sent.</p>
            </div>
            <span className="sp-demo-stamp">FICTIONAL<br />SAMPLE DATA</span>
          </div>

          <div className="sp-lab">
            <aside className="sp-controls">
              <div className="sp-control-block">
                <span className="sp-control-label">01 / ATHLETE</span>
                <div className="sp-athlete-options" role="group" aria-label="Choose a fictional athlete">
                  {ATHLETES.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`sp-athlete-option ${athlete.id === item.id ? 'is-active' : ''}`}
                      onClick={() => selectAthlete(item.id)}
                      aria-pressed={athlete.id === item.id}
                      data-testid={`button-athlete-${item.id}`}
                    >
                      <span className={`sp-athlete-avatar sp-avatar-${item.id}`}>{item.name.split(' ').map((part) => part[0]).join('')}</span>
                      <span><strong>{item.name}</strong><small>{item.sport} · #{item.number}</small></span>
                      {athlete.id === item.id && <Check size={16} className="sp-option-check" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="sp-control-block">
                <span className="sp-control-label">02 / CARD LOOK</span>
                <div className="sp-look-options" role="group" aria-label="Choose a proposed card design">
                  {LOOKS.map((look, index) => (
                    <button
                      type="button"
                      key={look.id}
                      className={`sp-look-option ${selectedLook === look.id ? 'is-active' : ''}`}
                      onClick={() => setSelectedLook(look.id)}
                      aria-pressed={selectedLook === look.id}
                      data-testid={`button-look-${look.id}`}
                    >
                      <span className={`sp-look-swatch sp-look-${look.id}`}><span /></span>
                      <span className="sp-look-copy"><b>{look.title}</b><small>{look.note}</small></span>
                      <span className="sp-look-number">0{index + 1}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="sp-control-disclaimer">These are visual directions for discussion, not a promise of final designs.</p>
            </aside>

            <div className="sp-card-stage">
               <div className="sp-stage-meta"><span data-testid="text-selected-look">PROPOSED {selectedLookName.toUpperCase()} LOOK</span><span>HYPE CARD · SAMPLE</span></div>
              <div className="sp-stage-card" key={`${athlete.id}-${selectedLook}`}>
                <PreviewArtwork project={project} ns={`season-pass-${athlete.id}-${selectedLook}`} testId="artwork-interactive-card" />
              </div>
              <div className="sp-stage-footer"><span className="sp-live-dot" /> PREVIEW UPDATES LOCALLY <span className="sp-stage-divider" /> {athlete.team.toUpperCase()}</div>
            </div>
          </div>

          <section className="sp-keepsake" aria-labelledby="keepsake-title">
            <div className="sp-keepsake-top">
              <div>
                <p className="sp-eyebrow">PROPOSED DOWNLOADABLE KEEPSAKE</p>
                <h3 id="keepsake-title">A season, in their own highlights.</h3>
              </div>
              <span className="sp-keepsake-label"><Crown size={14} /> PASS CONCEPT</span>
            </div>
            <div className="sp-keepsake-body">
              <div className="sp-keepsake-cover" aria-hidden="true">
                <div className="sp-cover-rays" />
                <span>PIXL SPORTS <i>·</i> {athlete.sport.toUpperCase()}</span>
                <strong>{athlete.name.split(' ')[0]}’S<br />SEASON</strong>
                <small>{athlete.team} <b>/{athlete.number}</b></small>
                <div className="sp-cover-line" />
                <div className="sp-cover-orb">{athlete.number}</div>
              </div>
              <div className="sp-keepsake-details">
                <p className="sp-keepsake-lead">A digital season page built from fictional results and moments a family might choose to remember.</p>
                 <div className="sp-fictional-stat"><span>SEASON SNAPSHOT</span><strong data-testid="text-season-stat">{athlete.stat}</strong><small>Example result · Fictional sample</small></div>
                <div className="sp-moments">
                   <div className="sp-moments-label"><span>OWNER-SELECTED MOMENTS</span><small data-testid="text-selected-moment-count">{selectedMoments.length} selected</small></div>
                  {athlete.highlights.map((moment, index) => {
                    const selected = selectedMoments.includes(moment);
                    return (
                      <button
                        type="button"
                        className={`sp-moment ${selected ? 'is-selected' : ''}`}
                        key={moment}
                        onClick={() => toggleMoment(moment)}
                        aria-pressed={selected}
                        data-testid={`button-moment-${athlete.id}-${index}`}
                      >
                        <span className="sp-moment-check">{selected && <Check size={12} />}</span>
                        <span>{moment}</span>
                        <small>{selected ? 'IN KEEPSAKE' : 'ADD MOMENT'}</small>
                      </button>
                    );
                  })}
                </div>
                 <div className="sp-keepsake-result" data-testid="preview-keepsake-result" aria-live="polite">
                   <strong>{athlete.name} · Keepsake preview</strong>
                   {selectedMoments.length > 0
                     ? <ul>{selectedMoments.map((moment) => <li key={moment}>{moment}</li>)}</ul>
                     : <p>No moments selected. Choose a moment above to include it.</p>}
                 </div>
                <p className="sp-keep-note">A real keepsake might reflect moments a parent chooses. This preview uses only fictional examples and selection stays on this page.</p>
              </div>
            </div>
            <div className="sp-keepsake-bottom"><span><ShieldCheck size={15} /> Existing cards and purchased keepsakes remain viewable after a pass expires.</span><span>CONCEPT ONLY · NOT AVAILABLE TO DOWNLOAD</span></div>
          </section>
        </section>

        <section className="sp-interview" aria-labelledby="interview-title">
          <div className="sp-interview-intro">
            <p className="sp-eyebrow">A FEW QUESTIONS FOR PARENTS</p>
            <h2 id="interview-title">Help us understand<br />what matters.</h2>
            <p>Use these neutral prompts in a conversation. This page does not collect answers.</p>
          </div>
          <div className="sp-interview-questions">
            <button
              type="button"
              className="sp-interview-toggle"
              onClick={() => setInterviewOpen((open) => !open)}
              aria-expanded={interviewOpen}
              aria-controls="sp-interview-list"
              data-testid="button-toggle-interview-script"
            >
              <span><span className="sp-script-count">05</span> Parent feedback interview script</span>
              <ChevronDown size={19} className={interviewOpen ? 'is-open' : ''} />
            </button>
            {interviewOpen && (
              <ol id="sp-interview-list" className="sp-question-list" data-testid="list-interview-questions">
                {INTERVIEW_QUESTIONS.map((question, index) => (
                  <li key={question} data-testid={`text-interview-question-${index + 1}`}>
                    <span>0{index + 1}</span><p>{question}</p>
                  </li>
                ))}
              </ol>
            )}
            {interviewOpen && (
              <div className="sp-research-signals" data-testid="text-research-decision-signals">
                <p className="sp-interview-reminder">Ask openly. There are no right answers; do not request private family details. Record only anonymous research notes outside this page.</p>
                <h3>Go / revise / stop signals</h3>
                <p><strong>Explore further:</strong> Parents explain a specific use for the bundle, select moments they would keep, and describe a realistic reason to pay without prompting.</p>
                <p><strong>Revise:</strong> Only one benefit matters, or season duration, athlete limits, or the keepsake format remain unclear. Test those details before pricing.</p>
                <p><strong>Stop or rethink:</strong> Parents prefer the free card and cannot describe added value or a reason to pay. Praise for the artwork alone is not purchase intent.</p>
                <p>These are discussion signals, not validated demand. No final price or launch decision is implied.</p>
              </div>
            )}
          </div>
        </section>

        <footer className="sp-footer">
          <Link href="/" className="sp-wordmark" data-testid="link-footer-home"><span className="sp-mark" aria-hidden="true">P</span><span>PIXL <b>SPORTS</b></span></Link>
          <p>Made for the people in the stands.</p>
          <span>RESEARCH PREVIEW · NO PURCHASE AVAILABLE</span>
        </footer>
      </div>
    </main>
  );
}