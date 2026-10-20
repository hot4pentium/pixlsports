import { useState } from 'react';
import {
  ArrowRight, CalendarDays, ChevronRight, CircleUserRound, ClipboardCheck,
  Clock3, MapPin, Menu, Share2, Shield, Sparkles, Trophy, X,
} from 'lucide-react';

const upcoming = [
  { month: 'MAY', day: '18', weekday: 'SAT', time: '10:30 AM', title: 'vs Northside Falcons', place: 'Riverside Athletic Complex · Field 2', type: 'GAME' },
  { month: 'MAY', day: '21', weekday: 'TUE', time: '5:15 PM', title: 'Team practice', place: 'Westview High School', type: 'PRACTICE' },
];

const styles = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700;800;900&display=swap');
.season-story {
  --ink: #102946; --navy: #102d50; --blue: #2468d9; --blue-soft: #e8f0fc;
  --paper: #f5f4ee; --white: #fffefa; --muted: #68788b; --line: #dce2e8;
  --lime: #c5ee63; --orange: #e8754e;
  min-height: 100dvh; color: var(--ink); background: var(--paper);
  font: 500 14px/1.45 'DM Sans', sans-serif; padding-bottom: 76px;
}
.season-story * { box-sizing: border-box; }
.season-story a { color: inherit; text-decoration: none; }
.season-story button, .season-story a { -webkit-tap-highlight-color: transparent; }
.season-story :is(a,button):focus-visible { outline: 3px solid #2468d9; outline-offset: 3px; }
.ss-header { display:flex; align-items:center; justify-content:space-between; height:64px; padding:0 20px; border-bottom:1px solid var(--line); background:rgba(255,254,250,.86); }
.ss-brand { display:flex; align-items:center; gap:9px; color:var(--navy); font:900 21px/.9 'Barlow Condensed',sans-serif; letter-spacing:.08em; }
.ss-mark { display:grid; grid-template-columns:repeat(3,5px); grid-template-rows:repeat(3,5px); gap:2px; transform:rotate(-8deg); }
.ss-mark i { background:var(--blue); }
.ss-mark i:nth-child(2),.ss-mark i:nth-child(4),.ss-mark i:nth-child(8) { opacity:.42; }
.ss-brand small { display:block; margin-top:2px; color:var(--blue); font:500 8px/1 'DM Mono',monospace; letter-spacing:.35em; }
.ss-header-right { display:flex; align-items:center; gap:8px; }
.ss-season-tag { color:var(--muted); font:500 10px 'DM Mono',monospace; letter-spacing:.1em; text-transform:uppercase; }
.ss-avatar { display:grid; width:34px; height:34px; place-items:center; border:1px solid #c7d5e4; border-radius:50%; background:#e8f0fc; color:#1e579f; font:800 11px 'DM Sans',sans-serif; }
.ss-menu { display:none; width:40px;height:40px;place-items:center;border:1px solid var(--line);border-radius:50%;background:transparent;color:var(--ink); }
.ss-shell { width:min(1160px,100%); margin:auto; padding:24px 24px 48px; }
.ss-layout { display:grid; grid-template-columns:minmax(0,1fr) 272px; gap:30px; align-items:start; }
.ss-main { min-width:0; }
.ss-welcome { display:flex; align-items:center; justify-content:space-between; gap:14px; margin-bottom:20px; }
.ss-welcome h1 { margin:3px 0 0; font:800 30px/1.05 'Barlow Condensed',sans-serif; letter-spacing:-.015em; color:var(--navy); }
.ss-kicker { margin:0; color:var(--blue); font:500 10px 'DM Mono',monospace; letter-spacing:.16em; text-transform:uppercase; }
.ss-athlete-pill { display:flex;align-items:center;gap:9px;padding:7px 12px 7px 7px;border:1px solid var(--line);border-radius:30px;background:var(--white); }
.ss-athlete-initials { display:grid;width:34px;height:34px;place-items:center;border-radius:50%;color:#fff;background:var(--navy);font:800 11px 'DM Sans',sans-serif; }
.ss-athlete-info { display:grid;gap:0; }
.ss-athlete-info strong { font-size:12px; line-height:1.25; }
.ss-athlete-info span { color:var(--muted);font-size:10px; }
.ss-athlete-pill svg { color:#75879a; }
.ss-event {
  position:relative; display:grid;grid-template-columns:minmax(0,1fr) 200px; min-height:246px; overflow:hidden;
  border-radius:12px; background:#112f53; color:#fff; box-shadow:0 12px 26px rgba(16,41,70,.13);
}
.ss-event-copy { position:relative;z-index:1;padding:24px 26px; }
.ss-event-label { display:flex;align-items:center;gap:8px;color:#c5ee63;font:500 10px 'DM Mono',monospace;letter-spacing:.16em; }
.ss-live-dot { width:7px;height:7px;border-radius:50%;background:var(--lime); }
.ss-event h2 { max-width:480px;margin:11px 0 5px;font:800 clamp(28px,4vw,40px)/.98 'Barlow Condensed',sans-serif;letter-spacing:.005em; }
.ss-event-sub { margin:0;color:#c8d6e6;font-size:13px; }
.ss-event-meta { display:flex;flex-wrap:wrap;gap:12px 18px;margin-top:19px;color:#e5edf7;font-size:12px; }
.ss-event-meta span { display:flex;align-items:center;gap:7px; }
.ss-event-meta svg { color:#b8d4ff; }
.ss-event-link { display:inline-flex;align-items:center;gap:8px;min-height:42px;margin-top:19px;padding:0 14px;border-radius:6px;background:var(--lime);color:#172d3f!important;font-size:12px;font-weight:800;transition:transform .2s,opacity .2s; }
.ss-event-link:hover { transform:translateY(-2px); }
.ss-pixel-scene { position:absolute;inset:0 0 0 auto;width:38%;overflow:hidden;opacity:.93; }
.ss-pixel-scene:before { content:'';position:absolute;inset:0;background:linear-gradient(90deg,#112f53 0%,rgba(17,47,83,.7) 18%,rgba(17,47,83,.05) 100%);z-index:2; }
.ss-stadium-lights { position:absolute;right:34px;top:34px;width:100px;height:88px;opacity:.8;background:linear-gradient(90deg,transparent 0 7px,#95afd0 7px 10px,transparent 10px),linear-gradient(0deg,transparent 0 64px,#667f9d 64px 68px,transparent 68px); }
.ss-stadium-lights:after { content:'';position:absolute;right:0;top:0;width:18px;height:26px;background:repeating-linear-gradient(0deg,#f8e9a1 0 4px,transparent 4px 7px),repeating-linear-gradient(90deg,#f8e9a1 0 4px,transparent 4px 7px);filter:drop-shadow(0 0 8px rgba(248,233,161,.35)); }
.ss-diamond { position:absolute;right:34px;bottom:24px;width:155px;height:115px;background:linear-gradient(135deg,transparent 49.4%,rgba(192,218,242,.65) 49.6% 50.4%,transparent 50.6%),linear-gradient(45deg,transparent 49.4%,rgba(192,218,242,.65) 49.6% 50.4%,transparent 50.6%); }
.ss-diamond:before { content:'';position:absolute;left:50%;top:51%;width:82px;height:82px;transform:translate(-50%,-50%) rotate(45deg);border:2px solid rgba(192,218,242,.72);background:linear-gradient(135deg,rgba(70,123,167,.7),rgba(37,78,119,.5)); }
.ss-diamond:after { content:'';position:absolute;left:50%;top:51%;width:8px;height:8px;transform:translate(-50%,-50%) rotate(45deg);background:#e8eef4;box-shadow:-41px 0 0 #e8eef4,41px 0 0 #e8eef4,0 -41px 0 #e8eef4,0 41px 0 #e8eef4; }
.ss-lights-pixel { position:absolute;right:0;bottom:0;left:0;height:28px;background:repeating-linear-gradient(90deg,#536d52 0 14px,#627c59 14px 28px);opacity:.68; }
.ss-section-heading { display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:26px 0 12px; }
.ss-section-heading h2 { margin:0;color:var(--navy);font:800 20px/1 'Barlow Condensed',sans-serif;letter-spacing:.035em;text-transform:uppercase; }
.ss-section-heading a { display:inline-flex;align-items:center;gap:4px;color:var(--blue);font-size:11px;font-weight:700; }
.ss-record { display:flex;align-items:center;gap:22px;border:1px solid var(--line);border-radius:10px;padding:16px 20px;background:var(--white); }
.ss-record-label { min-width:112px; }
.ss-record-label strong { display:block;color:var(--navy);font:800 17px/1 'Barlow Condensed',sans-serif;letter-spacing:.06em; }
.ss-record-label span { display:block;margin-top:5px;color:var(--muted);font:500 9px 'DM Mono',monospace;letter-spacing:.08em;text-transform:uppercase; }
.ss-record-stats { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));flex:1; }
.ss-record-stat { text-align:center;border-left:1px solid var(--line); }
.ss-record-stat strong { display:block;color:var(--navy);font:800 30px/.9 'Barlow Condensed',sans-serif; }
.ss-record-stat span { display:block;margin-top:5px;color:var(--muted);font:500 9px 'DM Mono',monospace;letter-spacing:.11em; }
.ss-streak { display:flex;align-items:center;gap:8px;margin-top:8px;color:var(--muted);font-size:11px; }
.ss-streak svg { color:var(--blue); }
.ss-event-list { display:grid;gap:8px; }
.ss-event-row { display:grid;grid-template-columns:58px minmax(0,1fr) auto;align-items:center;gap:14px;min-height:78px;border:1px solid var(--line);border-radius:9px;padding:10px 14px;background:var(--white);transition:border-color .2s,transform .2s; }
.ss-event-row:hover { border-color:#9bb9df;transform:translateY(-1px); }
.ss-date { display:grid;justify-items:center;align-content:center;min-height:50px;border-right:1px solid var(--line);padding-right:12px;color:var(--blue);font:500 9px 'DM Mono',monospace;letter-spacing:.08em; }
.ss-date strong { font:800 29px/.95 'Barlow Condensed',sans-serif; }
.ss-row-copy { min-width:0; }
.ss-row-type { display:block;color:var(--blue);font:500 9px 'DM Mono',monospace;letter-spacing:.12em; }
.ss-row-copy strong { display:block;overflow:hidden;margin:3px 0;color:var(--navy);font-size:13px;text-overflow:ellipsis;white-space:nowrap; }
.ss-row-copy span:last-child { display:block;overflow:hidden;color:var(--muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap; }
.ss-row-time { display:flex;align-items:center;gap:5px;color:#52657b;font:500 10px 'DM Mono',monospace;white-space:nowrap; }
.ss-row-time svg { color:#8298ae; }
.ss-side { display:grid;gap:14px; }
.ss-side-card { border:1px solid var(--line);border-radius:10px;background:var(--white);overflow:hidden; }
.ss-side-head { display:flex;align-items:center;justify-content:space-between;padding:15px 16px 11px;border-bottom:1px solid var(--line); }
.ss-side-head h2 { margin:0;color:var(--navy);font:800 17px 'Barlow Condensed',sans-serif;letter-spacing:.04em;text-transform:uppercase; }
.ss-side-head span { color:var(--muted);font:500 9px 'DM Mono',monospace; }
.ss-season-note { padding:15px 16px 16px; }
.ss-season-note p { margin:0;color:#51647a;font-size:12px;line-height:1.55; }
.ss-season-note strong { color:var(--navy); }
.ss-note-foot { display:flex;align-items:center;gap:7px;margin-top:13px;color:#60758d;font-size:10px; }
.ss-note-foot svg { color:var(--blue); }
.ss-tools { display:grid; }
.ss-tool { display:flex;align-items:center;gap:12px;min-height:56px;padding:9px 15px;border-bottom:1px solid #edf0f3;transition:background .2s; }
.ss-tool:last-child { border-bottom:0; }
.ss-tool:hover { background:#f2f6fc; }
.ss-tool-icon { display:grid;width:34px;height:34px;place-items:center;border-radius:8px;background:var(--blue-soft);color:#245fac; }
.ss-tool-copy { flex:1; }
.ss-tool-copy strong { display:block;color:var(--navy);font-size:12px; }
.ss-tool-copy span { display:block;margin-top:1px;color:var(--muted);font-size:10px; }
.ss-tool > svg { color:#91a0af; }
.ss-hype { position:relative;display:block;min-height:126px;padding:17px;overflow:hidden;background:#eaf1f8;color:var(--navy)!important; }
.ss-hype:after { content:'PIX';position:absolute;right:11px;bottom:-14px;color:#dce6f1;font:900 74px/.9 'Barlow Condensed',sans-serif;letter-spacing:-.07em; }
.ss-hype-kicker { position:relative;z-index:1;display:flex;align-items:center;gap:7px;color:#215dad;font:500 9px 'DM Mono',monospace;letter-spacing:.14em; }
.ss-hype strong { position:relative;z-index:1;display:block;max-width:145px;margin-top:12px;font:800 21px/.98 'Barlow Condensed',sans-serif;text-transform:uppercase; }
.ss-hype small { position:relative;z-index:1;display:flex;align-items:center;gap:4px;margin-top:8px;color:#405972;font-size:10px;font-weight:700; }
.ss-bottom-nav { display:none; }
.ss-mobile-menu { position:fixed;inset:64px 0 auto;z-index:10;padding:8px 14px 13px;border-bottom:1px solid var(--line);background:var(--white);box-shadow:0 12px 25px rgba(16,41,70,.1); }
.ss-mobile-menu a { display:flex;align-items:center;gap:10px;min-height:46px;padding:0 8px;color:var(--navy);font-size:13px;font-weight:700; }
@media (min-width:1200px) { .ss-shell { padding-top:34px; } }
@media (max-width:800px) {
 .ss-layout { grid-template-columns:minmax(0,1fr);gap:0; }
 .ss-shell { padding:19px 16px 30px; }
 .ss-side { grid-template-columns:1fr 1fr;align-items:start;margin-top:22px; }
 .ss-side-card:last-child { grid-column:auto; }
 .ss-event { grid-template-columns:minmax(0,1fr) 126px;min-height:224px; }
 .ss-event-copy { padding:20px 19px; }
 .ss-pixel-scene { width:42%; }
 .ss-diamond { right:5px;transform:scale(.74);transform-origin:right bottom; }
 .ss-stadium-lights { right:12px;transform:scale(.8);transform-origin:top right; }
}
@media (max-width:520px) {
 .season-story { padding-bottom:86px; }
 .ss-header { height:58px;padding:0 15px; }
 .ss-season-tag { display:none; }
 .ss-menu { display:grid; }
 .ss-shell { padding:18px 15px 22px; }
 .ss-welcome { align-items:flex-start;margin-bottom:15px; }
 .ss-welcome h1 { font-size:26px; }
 .ss-athlete-pill { gap:7px;padding:5px 8px 5px 5px; }
 .ss-athlete-initials { width:30px;height:30px; }
 .ss-athlete-info strong { font-size:10px; }
 .ss-athlete-info span { font-size:9px; }
 .ss-athlete-pill > svg { width:14px; }
 .ss-event { grid-template-columns:minmax(0,1fr) 86px;min-height:227px;border-radius:10px; }
 .ss-event-copy { padding:18px 16px; }
 .ss-event h2 { max-width:260px;margin-top:12px;font-size:31px; }
 .ss-event-sub { max-width:245px;font-size:11px; }
 .ss-event-meta { display:grid;gap:8px;margin-top:14px;font-size:10px; }
 .ss-event-meta span { align-items:flex-start; }
 .ss-event-meta svg { width:14px;height:14px; }
 .ss-event-link { min-height:38px;margin-top:14px;padding:0 12px;font-size:11px; }
 .ss-pixel-scene { width:35%;opacity:.65; }
 .ss-diamond { right:-29px;bottom:5px;transform:scale(.53); }
 .ss-stadium-lights { right:-2px;top:21px;transform:scale(.62); }
 .ss-section-heading { margin:21px 0 10px; }
 .ss-section-heading h2 { font-size:19px; }
 .ss-record { display:block;padding:13px 14px; }
 .ss-record-label { display:flex;align-items:baseline;justify-content:space-between; }
 .ss-record-label strong { font-size:16px; }
 .ss-record-label span { margin:0; }
 .ss-record-stats { margin-top:13px; }
 .ss-record-stat strong { font-size:27px; }
 .ss-record-stat span { font-size:8px; }
 .ss-streak { margin-top:8px;font-size:10px; }
 .ss-event-row { grid-template-columns:48px minmax(0,1fr);gap:11px;min-height:72px;padding:8px 10px; }
 .ss-date { min-height:47px;padding-right:10px; }
 .ss-date strong { font-size:27px; }
 .ss-row-copy strong { font-size:12px; }
 .ss-row-copy span:last-child { font-size:9px; }
 .ss-row-time { grid-column:2;justify-self:start;margin-top:-5px;font-size:9px; }
 .ss-side { grid-template-columns:1fr;gap:10px;margin-top:20px; }
 .ss-side-card:last-child { grid-column:auto; }
 .ss-hype { min-height:112px; }
 .ss-bottom-nav { position:fixed;z-index:20;right:0;bottom:0;left:0;display:grid;grid-template-columns:repeat(3,1fr);height:69px;padding-bottom:env(safe-area-inset-bottom);border-top:1px solid #dce2e8;background:rgba(255,254,250,.97); }
 .ss-bottom-nav a { position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:#66788d;font-size:9px;font-weight:700;letter-spacing:.04em; }
 .ss-bottom-nav a[aria-current='page'] { color:var(--blue); }
 .ss-bottom-nav a[aria-current='page']:before { position:absolute;top:0;left:50%;width:30px;height:3px;transform:translateX(-50%);background:var(--blue);content:''; }
 .ss-bottom-nav svg { width:19px;height:19px; }
 .ss-mobile-menu { top:58px; }
}
@media (prefers-reduced-motion:reduce) { .season-story *, .season-story *:before, .season-story *:after { scroll-behavior:auto!important;transition:none!important; } }
`;

export function Dashboard() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('Home');
  const closeMenu = () => setMenuOpen(false);
  const nav = (tab: string, href: string) => {
    setActiveTab(tab);
    closeMenu();
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="season-story" id="home">
      <style>{styles}</style>
      <header className="ss-header">
        <a className="ss-brand" href="#home" aria-label="Pixl Sports home">
          <span className="ss-mark" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
          <span>PIXL<small>SPORTS</small></span>
        </a>
        <div className="ss-header-right">
          <span className="ss-season-tag">2025 · Spring season</span>
          <a className="ss-avatar" href="#athlete" aria-label="Maya Carter's athlete profile">MC</a>
          <button className="ss-menu" type="button" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </header>
      {menuOpen && <nav className="ss-mobile-menu" aria-label="Main menu">
        <a href="#home" onClick={() => { nav('Home', '#home'); }}><Trophy size={17} /> Home</a>
        <a href="#events" onClick={() => { nav('Events', '#events'); }}><CalendarDays size={17} /> Events</a>
        <a href="#athlete" onClick={() => { nav('Athlete', '#athlete'); }}><CircleUserRound size={17} /> Athlete profile</a>
      </nav>}
      <div className="ss-shell">
        <div className="ss-layout">
          <main className="ss-main">
            <div className="ss-welcome">
              <div>
                <p className="ss-kicker">Your family season view</p>
                <h1>A season in good company.</h1>
              </div>
              <a className="ss-athlete-pill" href="#athlete" id="athlete">
                <span className="ss-athlete-initials">MC</span>
                <span className="ss-athlete-info"><strong>Maya Carter</strong><span>#7 · Softball</span></span>
                <ChevronRight size={16} aria-hidden="true" />
              </a>
            </div>

            <section className="ss-event" aria-labelledby="next-event-title">
              <div className="ss-event-copy">
                <div className="ss-event-label"><span className="ss-live-dot" /> NEXT ON THE SEASON</div>
                <h2 id="next-event-title">Northside Falcons</h2>
                <p className="ss-event-sub">Westview Wildcats · Maya Carter #7</p>
                <div className="ss-event-meta">
                  <span><CalendarDays size={16} /> Saturday, May 18</span>
                  <span><Clock3 size={16} /> 10:30 AM</span>
                  <span><MapPin size={16} /> Riverside Athletic Complex · Field 2</span>
                </div>
                <a className="ss-event-link" href="#events">View Event Card <ArrowRight size={15} /></a>
              </div>
              <div className="ss-pixel-scene" aria-hidden="true">
                <div className="ss-stadium-lights" />
                <div className="ss-diamond" />
                <div className="ss-lights-pixel" />
              </div>
            </section>

            <section id="season-record" aria-labelledby="record-title">
              <div className="ss-section-heading">
                <h2 id="record-title">The season so far</h2>
                <a href="#stats">View stats <ArrowRight size={13} /></a>
              </div>
              <div className="ss-record">
                <div className="ss-record-label"><strong>SEASON RECORD</strong><span>Softball · 12 games tracked</span></div>
                <div className="ss-record-stats" aria-label="8 wins, 3 losses, 1 tie">
                  <div className="ss-record-stat"><strong>8</strong><span>WINS</span></div>
                  <div className="ss-record-stat"><strong>3</strong><span>LOSSES</span></div>
                  <div className="ss-record-stat"><strong>1</strong><span>TIES</span></div>
                </div>
              </div>
              <div className="ss-streak"><Sparkles size={14} /> A season made of 12 moments, and counting.</div>
            </section>

            <section id="events" aria-labelledby="events-title">
              <div className="ss-section-heading">
                <h2 id="events-title">Coming up</h2>
                <a href="#all-events">All events <ArrowRight size={13} /></a>
              </div>
              <div className="ss-event-list">
                {upcoming.map((event) => (
                  <a className="ss-event-row" href="#event-card" key={event.day} aria-label={`${event.type}: ${event.title}, ${event.month} ${event.day}, ${event.time}`}>
                    <span className="ss-date">{event.month}<strong>{event.day}</strong></span>
                    <span className="ss-row-copy"><span className="ss-row-type">{event.type} · {event.weekday}</span><strong>{event.title}</strong><span><MapPin size={11} aria-hidden="true" /> {event.place}</span></span>
                    <span className="ss-row-time"><Clock3 size={13} /> {event.time}</span>
                  </a>
                ))}
              </div>
            </section>
          </main>

          <aside className="ss-side" aria-label="Season tools">
            <section className="ss-side-card">
              <div className="ss-side-head"><h2>Season notes</h2><span>WEEK 6</span></div>
              <div className="ss-season-note">
                <p><strong>One game, one practice.</strong> The next few days are set. Keep the details close and enjoy the season as it unfolds.</p>
                <div className="ss-note-foot"><Shield size={14} /> Your family’s season, together</div>
              </div>
            </section>
            <section className="ss-side-card" id="stats">
              <div className="ss-side-head"><h2>Useful tools</h2><span>FOR YOUR SEASON</span></div>
              <div className="ss-tools">
                <a className="ss-tool" href="#prep"><span className="ss-tool-icon"><ClipboardCheck size={18} /></span><span className="ss-tool-copy"><strong>Prep checklist</strong><span>Get ready for game day</span></span><ChevronRight size={16} /></a>
                <a className="ss-tool" href="#season-record"><span className="ss-tool-icon"><Trophy size={18} /></span><span className="ss-tool-copy"><strong>Track stats</strong><span>Follow the season record</span></span><ChevronRight size={16} /></a>
                <a className="ss-tool" href="#share"><span className="ss-tool-icon"><Share2 size={18} /></span><span className="ss-tool-copy"><strong>Share tracker</strong><span>Keep family in the loop</span></span><ChevronRight size={16} /></a>
                <a className="ss-tool" href="#hype-card"><span className="ss-tool-icon"><Sparkles size={18} /></span><span className="ss-tool-copy"><strong>HYPE Card</strong><span>Maya’s season card</span></span><ChevronRight size={16} /></a>
              </div>
            </section>
            <a className="ss-side-card ss-hype" href="#hype-card" id="hype-card">
              <span className="ss-hype-kicker"><Sparkles size={13} /> MADE FOR MAYA</span>
              <strong>Her season, worth sharing.</strong>
              <small>Open HYPE Card <ArrowRight size={12} /></small>
            </a>
          </aside>
        </div>
      </div>
      <nav className="ss-bottom-nav" aria-label="Primary navigation">
        <a href="#home" aria-current={activeTab === 'Home' ? 'page' : undefined} onClick={() => setActiveTab('Home')}><Trophy /><span>Home</span></a>
        <a href="#events" aria-current={activeTab === 'Events' ? 'page' : undefined} onClick={() => setActiveTab('Events')}><CalendarDays /><span>Events</span></a>
        <a href="#athlete" aria-current={activeTab === 'Athlete' ? 'page' : undefined} onClick={() => setActiveTab('Athlete')}><CircleUserRound /><span>Athlete</span></a>
      </nav>
    </div>
  );
}

export default Dashboard;
