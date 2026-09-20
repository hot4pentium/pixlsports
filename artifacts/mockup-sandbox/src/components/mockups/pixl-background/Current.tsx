import { useState } from 'react';
import {
  Activity, ArrowRight, CalendarDays, CheckCircle2, ClipboardCheck, Image as ImageIcon,
  MapPin, PenSquare, Trophy, User, Users, Zap,
} from 'lucide-react';
import './_group.css';

type PathId = 'plan' | 'upcoming' | 'live' | 'completed';

const games = [
  { date: '2025-09-20', time: '18:30', opponent: 'North Valley Bears', location: 'Memorial Stadium', status: 'upcoming' },
  { date: '2025-09-27', time: '16:00', opponent: 'Lakeside Wolves', location: 'Lakeside Field', status: 'upcoming' },
];
const weekPath: { id: PathId; number: string; label: string; icon: typeof CalendarDays; accent: string; title: string; copy: string; action: string }[] = [
  { id: 'plan', number: '01', label: 'Plan the week', icon: CalendarDays, accent: '#7dd3fc', title: 'Set the week up.', copy: 'Connect your team calendar or add the games you want to follow so Pixl can keep the next move in view.', action: 'Open schedule' },
  { id: 'upcoming', number: '02', label: 'Get ready', icon: ClipboardCheck, accent: '#fcd34d', title: 'Get ready for game day.', copy: 'Use the checklist to get the essentials in place before the first whistle.', action: 'Open checklist' },
  { id: 'live', number: '03', label: 'Capture the game', icon: Activity, accent: '#6ee7b7', title: 'Capture the game as it happens.', copy: 'Track the score and key plays in one place while the game is live.', action: 'Open stat tracker' },
  { id: 'completed', number: '04', label: 'Send the hype', icon: Zap, accent: '#f0abfc', title: 'Send the moment around.', copy: 'Turn the best part of the game into a Hype Card with optional season stats.', action: 'Make a Hype Card' },
];

function Button({ children }: { children: React.ReactNode }) {
  return <button className="angle-sm" style={{ background: 'hsl(var(--primary))', color: 'hsl(var(--primary-foreground))', border: 0, padding: '13px 20px', fontWeight: 800, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>{children}</button>;
}

export function Current() {
  const [selectedPath, setSelectedPath] = useState<PathId>('upcoming');
  const [toolsOpen, setToolsOpen] = useState(true);
  const selected = weekPath.find((item) => item.id === selectedPath) ?? weekPath[1];
  const SelectedIcon = selected.icon;
  return (
    <main className="pixl-background" style={{ minHeight: '100vh', padding: '32px 20px 64px' }}>
      <div style={{ width: '100%', maxWidth: 1400, margin: '0 auto', display: 'grid', gap: 48 }}>
        <header style={{ display: 'grid', gap: 32, alignItems: 'center', gridTemplateColumns: 'minmax(0,1fr) minmax(22rem,.72fr)' }}>
          <div>
            <div className="angle-sm" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', background: 'hsl(var(--muted))', padding: '7px 12px', fontSize: 11, fontWeight: 800, letterSpacing: '.15em' }}><Activity size={16} color="hsl(var(--primary-ink))" /> WELCOME, JAMIE</div>
            <h1 className="display hero-title" style={{ fontSize: 'clamp(3.4rem,7vw,6.5rem)', lineHeight: .9, letterSpacing: '-.03em', margin: '16px 0 0' }}>Game Day <span style={{ color: 'hsl(var(--primary))', textShadow: '1px 1px #111' }}>Hub.</span></h1>
            <p style={{ color: 'hsl(var(--muted-foreground))', fontSize: 18, fontWeight: 500, maxWidth: 650, marginTop: 18 }}>Plan the week, get ready for game day, capture what happens, and send the moment around.</p>
          </div>
          <section className="angle shadow-depth" style={{ position: 'relative', overflow: 'hidden', background: '#111316', color: '#f5f7f4', padding: 20 }}>
            <div className="dark-grid" style={{ position: 'absolute', inset: 0, opacity: .25 }} />
            <div style={{ position: 'relative', display: 'flex', gap: 18, alignItems: 'center' }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{ display: 'grid', placeItems: 'center', width: 80, height: 80, borderRadius: '50%', border: '2px solid hsl(var(--primary))', background: '#f5f3eb' }}><User size={40} color="#111316" opacity={.25} /></div>
                <button aria-label="Edit athlete profile" style={{ position: 'absolute', right: -3, bottom: -3, display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: '50%', border: '2px solid hsl(var(--primary))', background: '#111316', color: '#fff' }}><PenSquare size={13} /></button>
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ color: 'hsl(var(--primary))', fontSize: 10, fontWeight: 800, letterSpacing: '.2em', textTransform: 'uppercase', margin: 0 }}>My athlete</p>
                <h2 className="display" style={{ fontSize: 30, margin: '5px 0 8px', lineHeight: 1 }}>Maya Thompson</h2>
                <div style={{ display: 'flex', gap: 10, color: '#ffffffa6', fontSize: 11, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase' }}><span><b style={{ color: 'hsl(var(--primary))' }}>#</b> 14</span><span>•</span><span>Forward</span><span>•</span><span>Parent</span></div>
                <div className="angle-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12, padding: '6px 9px', border: '1px solid #ffffff1c', background: '#ffffff0d', color: '#ffffffe0', fontSize: 10, fontWeight: 800, letterSpacing: '.14em', textTransform: 'uppercase' }}><Trophy size={14} color="hsl(var(--primary))" /> Eastside Eagles</div>
              </div>
            </div>
          </section>
        </header>

        <section className="angle" style={{ position: 'relative', overflow: 'hidden', background: '#111316', color: '#fff' }}>
          <div className="dark-grid" style={{ position: 'absolute', inset: 0, opacity: .3 }} />
          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1.2fr .8fr', gap: 48, padding: '40px' }}>
            <div>
              <div style={{ color: 'hsl(var(--primary))', fontSize: 10, fontWeight: 800, letterSpacing: '.2em', textTransform: 'uppercase' }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'hsl(var(--primary))', marginRight: 9 }} /> Next up · Your schedule</div>
              <h2 className="display" style={{ fontSize: 'clamp(2.6rem,5vw,4.7rem)', lineHeight: .92, margin: '14px 0 0' }}>Eastside Eagles<br />vs North Valley Bears</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 20, color: '#ffffffa6', fontWeight: 500 }}><span>Sep 20, 2025</span><span>·</span><span>6:30 PM</span><span>·</span><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><MapPin size={14} color="hsl(var(--primary))" /> Memorial Stadium</span></div>
              <p style={{ maxWidth: 520, marginTop: 22, color: '#ffffffb3', lineHeight: 1.6 }}>Pack the details now so game day feels easy.</p>
              <Button><ClipboardCheck size={16} style={{ verticalAlign: 'middle', marginRight: 8 }} /> Open checklist</Button>
            </div>
            <div style={{ alignSelf: 'end' }}>
              <p style={{ color: '#ffffff73', fontSize: 10, fontWeight: 800, letterSpacing: '.2em', textTransform: 'uppercase', margin: 0 }}>Your week path</p>
              <p style={{ color: '#ffffff80', fontSize: 12, lineHeight: 1.5, maxWidth: 360 }}>Start with the schedule, then follow the next step as game day moves.</p>
              <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>{weekPath.map((item) => { const Icon = item.icon; const active = item.id === selectedPath; return <button key={item.id} onClick={() => setSelectedPath(item.id)} aria-pressed={active} style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', padding: '12px', border: `1px solid ${active ? item.accent : '#ffffff1a'}`, background: active ? `${item.accent}1c` : '#ffffff08', color: active ? '#fff' : '#ffffff80' }}><b style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, background: active ? item.accent : '#ffffff18', color: active ? '#111' : '#ffffffb3', fontSize: 12 }}>{item.number}</b><Icon size={16} color={active ? item.accent : '#ffffff66'} /><span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>{item.label}</span>{item.id === 'upcoming' && <CheckCircle2 size={16} color={item.accent} style={{ marginLeft: 'auto' }} />}</button>; })}</div>
            </div>
          </div>
          <div style={{ borderTop: `2px solid ${selected.accent}`, background: `${selected.accent}0b`, padding: '26px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div><p style={{ color: selected.accent, fontSize: 10, fontWeight: 800, letterSpacing: '.2em', margin: 0 }}>{selected.number} / {selected.label}</p><h3 className="display" style={{ color: selected.accent, fontSize: 32, margin: '7px 0' }}>{selected.title}</h3><p style={{ color: '#ffffff99', margin: 0, maxWidth: 650 }}>{selected.copy}</p></div><Button><SelectedIcon size={15} style={{ verticalAlign: 'middle', marginRight: 8 }} /> {selected.action} <ArrowRight size={15} style={{ verticalAlign: 'middle', marginLeft: 8 }} /></Button>
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 32 }}>
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid hsl(var(--border))', paddingBottom: 12, marginBottom: 16 }}><h3 className="display" style={{ color: 'hsl(var(--primary-ink))', fontSize: 28, margin: 0 }}>Upcoming</h3><a href="#calendar" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: 'hsl(var(--foreground))' }}>View Calendar <ArrowRight size={13} style={{ verticalAlign: 'middle' }} /></a></div>
            <div className="card angle-sm grid-lines" style={{ padding: 14, display: 'grid', gap: 10 }}>{games.map((game) => <article key={game.date} style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 16, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', padding: 14 }}><div style={{ textAlign: 'center', minWidth: 54, color: 'hsl(var(--primary-ink))' }}><b className="display" style={{ fontSize: 13 }}>SEP</b><strong className="display" style={{ display: 'block', fontSize: 30, lineHeight: 1 }}>{game.date.slice(-2)}</strong></div><div><b className="display" style={{ fontSize: 22 }}>Eastside Eagles vs {game.opponent}</b><p style={{ color: 'hsl(var(--muted-foreground))', fontSize: 12, margin: '5px 0 0' }}>{game.time === '18:30' ? '6:30 PM' : '4:00 PM'} · {game.location}</p></div><ArrowRight size={17} style={{ marginLeft: 'auto' }} /></article>)}</div>
          </section>
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid hsl(var(--border))', paddingBottom: 12, marginBottom: 16 }}><h3 className="display" style={{ color: 'hsl(var(--primary-ink))', fontSize: 28, margin: 0 }}>Recent designs</h3><a href="#projects" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>View all <ArrowRight size={13} style={{ verticalAlign: 'middle' }} /></a></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>{['Senior Night / Hype Card', 'Game Day / Matchup'].map((name, i) => <article key={name} className="card angle-sm" style={{ overflow: 'hidden' }}><div style={{ height: 130, display: 'grid', placeItems: 'center', background: i ? 'linear-gradient(135deg,#122b2a,#0b1515)' : 'linear-gradient(135deg,#182c3c,#152019)', color: 'hsl(var(--primary))' }}><ImageIcon size={34} opacity={.8} /></div><div style={{ padding: 12 }}><b style={{ fontSize: 12 }}>{name}</b><p style={{ color: 'hsl(var(--muted-foreground))', fontSize: 10, margin: '5px 0 0' }}>Updated Sep {i ? 12 : 15}, 2025</p></div></article>)}</div>
          </section>
        </div>

        <section id="all-tools">
          <button onClick={() => setToolsOpen(!toolsOpen)} style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', border: 0, borderBottom: '1px solid hsl(var(--border))', background: 'transparent', padding: '0 0 14px', textAlign: 'left' }}><span className="display" style={{ fontSize: 28 }}>All tools</span><span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.15em', textTransform: 'uppercase' }}>{toolsOpen ? 'Hide' : 'Show'} tools</span></button>
          {toolsOpen && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 16 }}>{[['Game Day', CalendarDays, 'Sep 20, 2025 · 6:30 PM'], ['Stat Tracker', Activity, 'Track the game as it happens.'], ['Checklist', ClipboardCheck, 'Prepare with the whole team.'], ['Hype Card', Zap, 'Celebrate a big moment.']].map(([label, Icon, copy]) => <a href="#tool" key={label as string} className="card angle-sm" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 18, textDecoration: 'none', color: 'inherit' }}><Icon size={21} color="hsl(var(--primary-ink))" /><span><b className="display" style={{ fontSize: 20, display: 'block' }}>{label as string}</b><small style={{ color: 'hsl(var(--muted-foreground))', fontSize: 11 }}>{copy as string}</small></span><ArrowRight size={15} style={{ marginLeft: 'auto' }} /></a>)}</div>}
        </section>
      </div>
    </main>
  );
}