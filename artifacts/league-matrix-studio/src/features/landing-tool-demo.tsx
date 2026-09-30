import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'wouter';
import { ArrowUpRight, CalendarDays, Check, Clock3, MapPin, Minus, Plus, X } from 'lucide-react';
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
  '04': { title: 'Make their moment.', description: 'Write a little encouragement and find a Hype Card look that feels like them.' },
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

const sports = {
  Basketball: ['Points', 'Assists', 'Rebounds', 'Steals'],
  Football: ['Touchdowns', 'Yards', 'Tackles', 'Catches'],
  Soccer: ['Goals', 'Assists', 'Saves', 'Shots'],
  Baseball: ['Hits', 'Runs', 'RBIs', 'Strikeouts'],
  Volleyball: ['Kills', 'Assists', 'Digs', 'Aces'],
} as const;
type Sport = keyof typeof sports;
function FollowDemo() {
  const [athlete, setAthlete] = useState('Maya');
  const [sport, setSport] = useState<Sport>('Basketball');
  const [opponent, setOpponent] = useState('Tigers');
  const [stats, setStats] = useState<Record<string, number>>({});
  const labels: readonly string[] = sports[sport];
  const change = (label: string, by: number) => setStats(current => ({ ...current, [label]: Math.max(0, (current[label] || 0) + by) }));
  return <div className="pixl-demo-content">
    <div className="pixl-demo-editor">
      <span className="pixl-demo-section-label">03 / Athlete-first tracker</span>
      <label className="pixl-demo-field"><span>Who are we cheering for?</span><input className="pixl-demo-input" maxLength={40} value={athlete} onChange={e => setAthlete(e.target.value)} placeholder="Athlete's first name" data-testid="input-demo-stat-athlete" /></label>
      <div className="pixl-demo-field-row">
        <label className="pixl-demo-field"><span>Sport</span><select className="pixl-demo-select" value={sport} onChange={e => { setSport(e.target.value as Sport); setStats({}); }} data-testid="select-demo-sport">{Object.keys(sports).map(name => <option key={name}>{name}</option>)}</select></label>
        <label className="pixl-demo-field"><span>Opponent</span><input className="pixl-demo-input" maxLength={50} value={opponent} onChange={e => setOpponent(e.target.value)} data-testid="input-demo-stat-opponent" /></label>
      </div>
      <div aria-label="Athlete stats">{labels.map(label => <div className="pixl-demo-stat-row" key={label}><span>{label}</span><div className="pixl-demo-stepper"><button type="button" onClick={() => change(label, -1)} disabled={!stats[label]} aria-label={`Remove one ${label.toLowerCase()} for ${athlete || 'athlete'}`} data-testid={`button-demo-decrease-${label.toLowerCase()}`}><Minus size={16} aria-hidden="true" /></button><output aria-label={`${label}: ${stats[label] || 0}`} data-testid={`text-demo-stat-${label.toLowerCase()}`}>{stats[label] || 0}</output><button type="button" onClick={() => change(label, 1)} aria-label={`Add one ${label.toLowerCase()} for ${athlete || 'athlete'}`} data-testid={`button-demo-increase-${label.toLowerCase()}`}><Plus size={16} aria-hidden="true" /></button></div></div>)}</div>
      <p className="pixl-demo-muted">Try a few plays. This practice tracker is just for this preview.</p>
    </div>
    <div className="pixl-demo-preview-area">
      <span className="pixl-demo-preview-label">The story so far / live preview</span>
      <div className="pixl-demo-stat-hero"><span className="pixl-demo-eyebrow">PIXL / {sport} vs {opponent.trim() || 'opponent'}</span><strong>{athlete.trim() || 'Your athlete'}</strong><p>Every contribution counts.</p></div>
      <div className="pixl-demo-stat-grid">{labels.map(label => <div className="pixl-demo-stat-tile" key={label}><strong>{stats[label] || 0}</strong><span>{label}</span></div>)}</div>
      <p className="pixl-demo-muted">Keep the focus on their effort, not just the final score.</p>
    </div>
  </div>;
}

type HypeTheme = 'navy' | 'sky' | 'coral' | 'lime';
const themes: { id: HypeTheme; label: string }[] = [{ id: 'navy', label: 'Night game' }, { id: 'sky', label: 'Open sky' }, { id: 'coral', label: 'Big energy' }, { id: 'lime', label: 'Spotlight' }];
function CelebrateDemo() {
  const [athlete, setAthlete] = useState('Maya');
  const [headline, setHeadline] = useState('That’s our MVP.');
  const [message, setMessage] = useState('Proud of the way you showed up today.');
  const [theme, setTheme] = useState<HypeTheme>('navy');
  return <div className="pixl-demo-content">
    <div className="pixl-demo-editor">
      <span className="pixl-demo-section-label">04 / Hype Card</span>
      <label className="pixl-demo-field"><span>Athlete</span><input className="pixl-demo-input" maxLength={35} value={athlete} onChange={e => setAthlete(e.target.value)} placeholder="Athlete's first name" data-testid="input-demo-hype-athlete" /></label>
      <label className="pixl-demo-field"><span>Big headline</span><input className="pixl-demo-input" maxLength={55} value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Say it with feeling" data-testid="input-demo-hype-headline" /></label>
      <label className="pixl-demo-field"><span>Your message</span><textarea className="pixl-demo-textarea" maxLength={160} value={message} onChange={e => setMessage(e.target.value)} placeholder="What made you proud?" data-testid="textarea-demo-hype-message" /></label>
      <span className="pixl-demo-section-label" id="pixl-demo-theme-label" style={{ marginBottom: 10 }}>Pick the energy</span>
      <div className="pixl-demo-theme-row" role="group" aria-labelledby="pixl-demo-theme-label">{themes.map(option => <button className="pixl-demo-theme" key={option.id} type="button" aria-pressed={theme === option.id} onClick={() => setTheme(option.id)} data-testid={`button-demo-theme-${option.id}`}>{option.label}</button>)}</div>
    </div>
    <div className="pixl-demo-preview-area">
      <span className="pixl-demo-preview-label">Your Hype Card / live preview</span>
      <article className="pixl-demo-hype" data-theme={theme} aria-label="Hype Card preview" data-testid="card-demo-hype-preview">
        <div><span className="pixl-demo-eyebrow">PIXL SPORTS / ALL IN</span><h3>{headline.trim() || 'Their moment.'}</h3><p>{message.trim() || 'Your words go here.'}</p></div>
        <div className="pixl-demo-hype-footer"><span>For {athlete.trim() || 'your athlete'}</span><span>Keep showing up.</span></div>
      </article>
      <p className="pixl-demo-muted">The best highlight is knowing someone saw you give it your all.</p>
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