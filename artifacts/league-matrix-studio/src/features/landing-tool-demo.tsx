import { useEffect, useId, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'wouter';
import { ArrowUpRight, CalendarDays, ChartNoAxesCombined, Check, Clock3, Images, MapPin, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import './game-on-inline-stat-tracker.css';
import samplePlayerPhoto from '@/assets/hypecard-player-photo-640.webp';
import sampleFootballMoment from '@/assets/landing-youth-football-hero.jpg';
import './landing-tool-demo.css';

type DemoStep = '01' | '02' | '03' | '04';
type LandingToolDemoProps = {
  step: DemoStep;
  open: boolean;
  destination: string;
  onOpenChange: (open: boolean) => void;
};

const copy: Record<DemoStep, { title: string; description: string }> = {
  '01': { title: 'Plan the next event.', description: 'Try filling out an Event Card. The details take shape as you type.' },
  '02': { title: 'Show up ready.', description: 'Check off the essentials, add your own, and leave a note for game day.' },
  '03': { title: 'Follow their game.', description: 'The little moments add up. Track an athlete’s stats one play at a time.' },
  '04': { title: 'Their season, one card.', description: 'Explore a Hype Card with its athlete photo, stats, shoutouts, and events.' },
};

function PlanDemo() {
  const [eventType, setEventType] = useState('Game');
  const [athlete, setAthlete] = useState('Maya');
  const [opponent, setOpponent] = useState('Tigers');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const formattedDate = date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'Date to be set';
  const formattedTime = time ? new Date(`2000-01-01T${time}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'Time to be set';
  return <div className="pixl-demo-content">
    <div className="pixl-demo-editor">
      <span className="pixl-demo-section-label">01 / Event details</span>
      <div className="pixl-demo-field-row">
        <label className="pixl-demo-field"><span>Event type</span><select className="pixl-demo-select" value={eventType} onChange={e => setEventType(e.target.value)} data-testid="select-demo-event-type"><option>Game</option><option>Practice</option><option>Meet</option><option>Tournament</option></select></label>
        <label className="pixl-demo-field"><span>Athlete</span><input className="pixl-demo-input" maxLength={40} value={athlete} onChange={e => setAthlete(e.target.value)} placeholder="Athlete's first name" data-testid="input-demo-athlete" /></label>
      </div>
      <label className="pixl-demo-field"><span>Opponent or event name</span><input className="pixl-demo-input" maxLength={60} value={opponent} onChange={e => setOpponent(e.target.value)} placeholder="Who or what is next?" data-testid="input-demo-opponent" /></label>
      <div className="pixl-demo-field-row">
        <label className="pixl-demo-field"><span>Date</span><input className="pixl-demo-input" type="date" value={date} onChange={e => setDate(e.target.value)} data-testid="input-demo-date" /></label>
        <label className="pixl-demo-field"><span>Time</span><input className="pixl-demo-input" type="time" value={time} onChange={e => setTime(e.target.value)} data-testid="input-demo-time" /></label>
      </div>
      <label className="pixl-demo-field"><span>Where</span><input className="pixl-demo-input" maxLength={100} value={location} onChange={e => setLocation(e.target.value)} placeholder="Field, court, or address" data-testid="input-demo-location" /></label>
      <label className="pixl-demo-field"><span>A note to remember</span><textarea className="pixl-demo-textarea" maxLength={240} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Arrival time, parking, what to bring..." data-testid="textarea-demo-event-notes" /></label>
    </div>
    <div className="pixl-demo-preview-area">
      <span className="pixl-demo-preview-label">Your Event Card / live preview</span>
      <article className="pixl-demo-card" aria-label="Event Card preview" data-testid="card-demo-event-preview">
        <div className="pixl-demo-card-top"><span className="pixl-demo-eyebrow">PIXL / {eventType}</span><h3>{athlete.trim() || 'Your athlete'} {eventType === 'Game' && 'vs'} {opponent.trim() || 'Next event'}</h3><p>One place for what’s coming up.</p></div>
        <div className="pixl-demo-card-bottom">
          <div className="pixl-demo-detail"><CalendarDays size={16} aria-hidden="true" /><span><strong>{formattedDate}</strong></span></div>
          <div className="pixl-demo-detail"><Clock3 size={16} aria-hidden="true" /><span>{formattedTime}</span></div>
          <div className="pixl-demo-detail"><MapPin size={16} aria-hidden="true" /><span>{location.trim() || 'Location to be set'}</span></div>
          {notes.trim() && <div className="pixl-demo-detail"><span>{notes.trim()}</span></div>}
        </div>
      </article>
      <p className="pixl-demo-muted">A real Event Card can keep the whole support crew on the same page.</p>
    </div>
  </div>;
}

type PrepItem = { id: number; label: string; done: boolean };
function PrepDemo() {
  const nextItemId = useRef(4);
  const [items, setItems] = useState<PrepItem[]>([
    { id: 1, label: 'Pack game shoes and uniform', done: false },
    { id: 2, label: 'Fill the water bottle', done: false },
    { id: 3, label: 'Check the field and arrival time', done: false },
  ]);
  const [newItem, setNewItem] = useState('');
  const [notes, setNotes] = useState('');
  const done = items.filter(item => item.done).length;
  const addItem = () => {
    const label = newItem.trim();
    if (!label) return;
    setItems(current => [...current, { id: nextItemId.current++, label, done: false }]);
    setNewItem('');
  };
  return <div className="pixl-demo-content">
    <div className="pixl-demo-editor">
      <span className="pixl-demo-section-label">02 / Game-day prep</span>
      <div className="pixl-demo-progress" role="progressbar" aria-label="Checklist progress" aria-valuenow={done} aria-valuemin={0} aria-valuemax={items.length}><span style={{ transform: `scaleX(${items.length ? done / items.length : 0})` }} /></div>
      <ul className="pixl-demo-list">{items.map(item => <li key={item.id}><button type="button" className="pixl-demo-check" data-done={item.done} aria-pressed={item.done} onClick={() => setItems(current => current.map(entry => entry.id === item.id ? { ...entry, done: !entry.done } : entry))} data-testid={`button-demo-check-${item.id}`}><span className="pixl-demo-box">{item.done && <Check size={13} aria-hidden="true" />}</span><span>{item.label}</span></button></li>)}</ul>
      <form className="pixl-demo-add" onSubmit={e => { e.preventDefault(); addItem(); }}>
        <input className="pixl-demo-input" aria-label="New prep item" maxLength={70} value={newItem} onChange={e => setNewItem(e.target.value)} placeholder="Add something to remember" data-testid="input-demo-new-prep-item" />
        <button type="submit" aria-label="Add prep item" data-testid="button-demo-add-prep-item"><Plus size={19} aria-hidden="true" /></button>
      </form>
      <label className="pixl-demo-field" style={{ marginTop: 20 }}><span>Private reminder</span><textarea className="pixl-demo-textarea" maxLength={300} value={notes} onChange={e => setNotes(e.target.value)} placeholder="A small note for yourself..." data-testid="textarea-demo-prep-notes" /></label>
    </div>
    <div className="pixl-demo-preview-area">
      <span className="pixl-demo-preview-label">Ready for the whistle</span>
      <div className="pixl-demo-card">
        <div className="pixl-demo-card-top"><span className="pixl-demo-eyebrow">PIXL / Prep</span><h3>{done === items.length ? 'All set.' : 'Getting ready.'}</h3><p data-testid="text-demo-prep-count">{done} of {items.length} things handled</p></div>
        <div className="pixl-demo-card-bottom"><ul className="pixl-demo-preview-list">{items.map(item => <li key={item.id} data-done={item.done}>{item.label}</li>)}</ul>{notes.trim() && <p className="pixl-demo-muted"><strong>Your reminder:</strong> {notes.trim()}</p>}</div>
      </div>
      <p className="pixl-demo-muted">A little preparation makes more room to enjoy the game.</p>
    </div>
  </div>;
}

type FollowStatId = 'touchdown' | 'field-goal' | 'extra-point' | 'two-point-conversion' | 'pass-reception' | 'rush-yard' | 'interception' | 'tackle';
type FollowAttribution = 'team' | 'athlete';
type FollowAction = { statId: FollowStatId; attribution: FollowAttribution };
type FollowDemoState = {
  quarter: number;
  teamScore: number;
  opponentScore: number;
  actions: FollowAction[];
};
type FollowDemoEvent =
  | { type: 'record'; statId: FollowStatId; attribution: FollowAttribution }
  | { type: 'adjust-score'; side: 'teamScore' | 'opponentScore'; by: number }
  | { type: 'advance-quarter' }
  | { type: 'undo' };

const followStats: { id: FollowStatId; label: string; shortLabel: string; points: number }[] = [
  { id: 'touchdown', label: 'Touchdown', shortLabel: 'TD', points: 6 },
  { id: 'field-goal', label: 'Field goal', shortLabel: 'FG', points: 3 },
  { id: 'extra-point', label: 'Extra point', shortLabel: 'XP', points: 1 },
  { id: 'two-point-conversion', label: 'Two-point conversion', shortLabel: '2 PT', points: 2 },
  { id: 'pass-reception', label: 'Pass/Rec', shortLabel: 'PASS/REC', points: 0 },
  { id: 'rush-yard', label: 'Rush', shortLabel: 'RUSH', points: 0 },
  { id: 'interception', label: 'Interception', shortLabel: 'INT', points: 0 },
  { id: 'tackle', label: 'Tackle', shortLabel: 'TACKLE', points: 0 },
];

function repeatedFollowActions(statId: FollowStatId, attribution: FollowAttribution, count: number): FollowAction[] {
  return Array.from({ length: count }, (): FollowAction => ({ statId, attribution }));
}

const initialFollowActions: FollowAction[] = [
  { statId: 'touchdown', attribution: 'team' },
  { statId: 'touchdown', attribution: 'team' },
  { statId: 'field-goal', attribution: 'team' },
  { statId: 'extra-point', attribution: 'team' },
  { statId: 'extra-point', attribution: 'athlete' },
  ...repeatedFollowActions('pass-reception', 'team', 4),
  { statId: 'pass-reception', attribution: 'athlete' },
  ...repeatedFollowActions('rush-yard', 'team', 4),
  ...repeatedFollowActions('rush-yard', 'athlete', 2),
  { statId: 'interception', attribution: 'team' },
  ...repeatedFollowActions('tackle', 'team', 6),
  ...repeatedFollowActions('tackle', 'athlete', 2),
];

const initialFollowDemoState: FollowDemoState = {
  quarter: 1,
  teamScore: 17,
  opponentScore: 10,
  actions: initialFollowActions,
};

function followDemoReducer(state: FollowDemoState, event: FollowDemoEvent): FollowDemoState {
  if (event.type === 'record') {
    const points = followStats.find(stat => stat.id === event.statId)?.points ?? 0;
    return {
      ...state,
      teamScore: state.teamScore + (event.attribution === 'team' ? points : 0),
      actions: [...state.actions, { statId: event.statId, attribution: event.attribution }],
    };
  }
  if (event.type === 'adjust-score') {
    return { ...state, [event.side]: Math.max(0, state[event.side] + event.by) };
  }
  if (event.type === 'advance-quarter') {
    return { ...state, quarter: Math.min(4, state.quarter + 1) };
  }
  const lastAction = state.actions[state.actions.length - 1];
  if (!lastAction) return state;
  const points = followStats.find(stat => stat.id === lastAction.statId)?.points ?? 0;
  return {
    ...state,
    teamScore: Math.max(0, state.teamScore - (lastAction.attribution === 'team' ? points : 0)),
    actions: state.actions.slice(0, -1),
  };
}

function FollowDemo() {
  const [game, dispatch] = useReducer(followDemoReducer, initialFollowDemoState);
  const counts = Object.fromEntries(followStats.map(stat => [stat.id, { team: 0, athlete: 0 }])) as Record<FollowStatId, Record<FollowAttribution, number>>;
  for (const action of game.actions) counts[action.statId][action.attribution] += 1;

  return <div className="pixl-demo-content pixl-demo-content--follow">
    <div className="pixl-demo-follow-tracker">
      <span className="pixl-demo-section-label">03 / Football Stat Tracker</span>
      <section className="game-on-quick-tracker" aria-label="Fictional football Stat Tracker demo" data-testid="demo-follow-tracker">
        <div className="game-on-quick-tracker__heading">
          <div>
            <p className="game-on-quick-tracker__eyebrow">Game day · Stat Tracker</p>
            <h3 className="game-on-quick-tracker__title">vs Tigers</h3>
          </div>
        </div>

        <div className="game-on-quick-tracker__scoreboard" data-testid="demo-follow-scoreboard" aria-live="polite">
          <div className="game-on-quick-tracker__scoreboard-top">
            <span className="game-on-quick-tracker__live"><span aria-hidden="true" /> Live</span>
            <span className="game-on-quick-tracker__period" data-testid="text-demo-follow-quarter">Quarter {game.quarter}</span>
          </div>
          <div className="game-on-quick-tracker__score-grid">
            {([
              ['teamScore', 'PIXL ALL-STARS', game.teamScore],
              ['opponentScore', 'TIGERS', game.opponentScore],
            ] as const).map(([side, label, score]) => (
              <div className="game-on-quick-tracker__score-card" key={side}>
                <span className="game-on-quick-tracker__score-label">{label}</span>
                <strong className="game-on-quick-tracker__score-value" data-testid={`text-demo-follow-${side}`}>{score}</strong>
                <div className="game-on-quick-tracker__score-actions">
                  <button type="button" aria-label={`Subtract one from ${label}`} onClick={() => dispatch({ type: 'adjust-score', side, by: -1 })} data-testid={`button-demo-follow-${side}-decrease`}><Minus size={16} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Add one to ${label}`} onClick={() => dispatch({ type: 'adjust-score', side, by: 1 })} data-testid={`button-demo-follow-${side}-increase`}><Plus size={16} aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="game-on-quick-tracker__period-row">
            <span>Now tracking quarter {game.quarter}</span>
            <button type="button" disabled={game.quarter >= 4} onClick={() => dispatch({ type: 'advance-quarter' })} aria-label={`Advance to quarter ${game.quarter + 1}`} data-testid="button-demo-follow-advance-quarter">Next quarter</button>
          </div>
        </div>

        <div className="game-on-quick-tracker__stats-heading">
          <div>
            <p className="game-on-quick-tracker__eyebrow">Tap a stat</p>
            <p className="game-on-quick-tracker__stats-summary" role="status" data-testid="text-demo-follow-summary">{game.actions.length} plays · {game.teamScore} pts</p>
          </div>
        </div>
        <div className="game-on-quick-tracker__stat-grid" role="group" aria-label="Football stats">
          {followStats.map(stat => (
            <div className="game-on-quick-tracker__stat-card" key={stat.id} data-testid={`card-demo-follow-stat-${stat.id}`}>
              <button
                type="button"
                aria-label={`Record ${stat.label} for PIXL All-Stars`}
                onClick={() => dispatch({ type: 'record', statId: stat.id, attribution: 'team' })}
                data-testid={`button-demo-follow-stat-${stat.id}-team`}
              >
                <span className="game-on-quick-tracker__stat-label">{stat.shortLabel}</span>
                <strong data-testid={`text-demo-follow-stat-${stat.id}`}>{counts[stat.id].team + counts[stat.id].athlete}</strong>
                <span className="game-on-quick-tracker__stat-counts" data-testid={`text-demo-follow-attribution-${stat.id}`}>Team {counts[stat.id].team} · Athlete {counts[stat.id].athlete}</span>
              </button>
              <button
                type="button"
                className="game-on-quick-tracker__athlete-tap"
                aria-label={`Record ${stat.label} for Maya Chen`}
                onClick={() => dispatch({ type: 'record', statId: stat.id, attribution: 'athlete' })}
                data-testid={`button-demo-follow-stat-${stat.id}-athlete`}
              >
                MC
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="game-on-quick-tracker__undo"
          disabled={game.actions.length === 0}
          onClick={() => dispatch({ type: 'undo' })}
          aria-label="Undo last stat"
          data-testid="button-demo-follow-undo"
        >
          <RotateCcw size={15} aria-hidden="true" /> Undo last stat
        </button>
        <p className="game-on-quick-tracker__save-note" role="status">Fictional game · Changes stay in this preview only.</p>
      </section>
    </div>
  </div>;
}

type HypeSide = 'front' | 'stats' | 'events';
const hypeSides = [
  { id: 'front', label: 'Card front', icon: RotateCcw },
  { id: 'stats', label: 'Stats', icon: ChartNoAxesCombined },
  { id: 'events', label: 'Events', icon: CalendarDays },
] as const;
const sampleStats = [
  { label: 'Passing yards', value: '184' },
  { label: 'Touchdowns', value: '3' },
  { label: 'Catches', value: '7' },
  { label: 'Tackles', value: '5' },
  { label: 'Interceptions', value: '1' },
  { label: 'Sacks', value: '0' },
  { label: 'Extra points', value: '2' },
  { label: 'Fumbles', value: '0' },
];
const sampleEvents = [
  { day: 'Saturday', date: 'Oct 10', dateTime: '2026-10-10', opponent: 'Tigers', time: '10:00 AM', location: 'Upper Field' },
  { day: 'Sunday', date: 'Oct 18', dateTime: '2026-10-18', opponent: 'Falcons', time: '2:30 PM', location: 'Riverside Stadium' },
];
function CelebrateDemo() {
  const [athlete, setAthlete] = useState('Player 24');
  const [team, setTeam] = useState('PIXL ALL STARS');
  const [side, setSide] = useState<HypeSide>('front');
  const athleteName = athlete.trim() || 'Your athlete';
  return <div className="pixl-demo-content">
    <div className="pixl-demo-editor">
      <span className="pixl-demo-section-label">04 / Hype Card</span>
      <label className="pixl-demo-field"><span>Athlete</span><input className="pixl-demo-input" maxLength={35} value={athlete} onChange={e => setAthlete(e.target.value)} placeholder="Athlete's first name" data-testid="input-demo-hype-athlete" /></label>
      <label className="pixl-demo-field"><span>Team</span><input className="pixl-demo-input" maxLength={45} value={team} onChange={e => setTeam(e.target.value)} placeholder="Team name" data-testid="input-demo-hype-team" /></label>
      <p className="pixl-demo-muted">Tap the buttons on the card to see what fans can follow. The photo and season examples are fictional; only your athlete and team names change here.</p>
    </div>
    <div className="pixl-demo-preview-area">
      <span className="pixl-demo-preview-label">Hype Card / interactive sample</span>
      <div className="pixl-demo-hype" data-side={side} data-testid="card-demo-hype-preview">
        <div className="pixl-demo-hype-display" id="pixl-demo-hype-card" role="region" aria-live="polite" aria-label={`${athleteName} — ${side === 'front' ? 'card front' : side}`}>
          {side === 'front' && <div className="pixl-demo-hype-front" data-testid="face-demo-hype-front">
            <LivingAthleteCardFront athleteName={athleteName} teamName={team.trim()} photoUrl={samplePlayerPhoto} photoAlt="Fictional sample football player" />
          </div>}
          {side === 'stats' && <div className="pixl-demo-hype-panel" data-testid="face-demo-hype-stats">
            <div className="pixl-demo-hype-panel-top"><span>PIXL / THE RECORD</span><span>EXAMPLE SEASON</span></div>
            <h3>Season stats.</h3>
            <p>{athleteName} / {team.trim() || 'Your team'} / Finalized games only</p>
            <div className="pixl-demo-hype-stats-lead">
              <div><strong>2–0–0</strong><span>W – L – T · scored games</span></div>
              <div><strong>3</strong><span>Finalized games</span></div>
              <div><strong>28</strong><span>Team points / runs</span></div>
            </div>
            <div className="pixl-demo-hype-stat-grid">{sampleStats.map(({ label, value }) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
            <small>Fictional sample stats · A real card shows finalized games.</small>
          </div>}
          {side === 'events' && <div className="pixl-demo-hype-panel" data-testid="face-demo-hype-events">
            <div className="pixl-demo-hype-panel-top"><span>PIXL / GAME DAYS</span><span>EXAMPLE SEASON</span></div>
            <h3>Events.</h3>
            <p>Event Cards shared for {athleteName} appear here.</p>
            <ol className="pixl-demo-hype-event-list" aria-label="Sample events">
              {sampleEvents.map(({ day, date, dateTime, opponent, time, location }, index) => <li className="pixl-demo-hype-event" key={opponent} data-testid={`card-demo-hype-event-${index + 1}`}>
                <span>GAME / <time dateTime={dateTime}>{day.toUpperCase()} · {date.toUpperCase()}</time> · SAMPLE EVENT</span><strong>vs {opponent}</strong>
                <dl><div><dt>Time</dt><dd>{time}</dd></div><div><dt>Location</dt><dd>{location}</dd></div></dl>
              </li>)}
            </ol>
            <small>Fictional events · A real card links to shared Event Cards.</small>
          </div>}
        </div>
        <div className="pixl-demo-hype-controls" role="group" aria-label="Choose a side of the Hype Card">
          {hypeSides.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={side === id} aria-controls="pixl-demo-hype-card" onClick={() => setSide(id)} data-testid={`button-demo-hype-${id}`}><Icon size={15} aria-hidden="true" /><span>{label}</span></button>)}
        </div>
      </div>
      <p className="pixl-demo-muted">Fictional stats and events. Nothing is saved or shared.</p>
    </div>
  </div>;
}

/** An in-memory, fictional preview. Unmounts on close so every visit starts fresh. */
export function LandingToolDemo({ step, open, destination, onOpenChange }: LandingToolDemoProps) {
  const headingId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChangeRef.current(false);
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(<div className="pixl-demo-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onOpenChange(false); }}>
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId} className="pixl-demo-dialog" data-testid="landing-tool-demo">
      <button className="pixl-demo-close" type="button" onClick={() => onOpenChange(false)} aria-label="Close demo"><X size={18} aria-hidden="true" /></button>
      <div className="pixl-demo-head">
        <span className="pixl-demo-kicker">Try the tools / {step} of 04</span>
        <h2 id={headingId} className="pixl-demo-title">{copy[step].title}</h2>
        <p id={descriptionId} className="pixl-demo-description">{copy[step].description}</p>
      </div>
      {step === '01' && <PlanDemo />}
      {step === '02' && <PrepDemo />}
      {step === '03' && <FollowDemo />}
      {step === '04' && <CelebrateDemo />}
      <div className="pixl-demo-footer">
        <p>This is a hands-on preview with fictional details. Nothing here is saved, sent, or shared; closing starts fresh.</p>
        <Link href={destination} className="pixl-demo-cta" onClick={() => onOpenChange(false)} data-testid="link-demo-sign-up">{destination === '/studio' ? 'Open studio to save your own' : 'Sign up to save your own'} <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </div>
    </div>
  </div>, document.body);
}