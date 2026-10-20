import { useState } from 'react';
import {
  ArrowRight, Bell, CalendarDays, Check, ChevronRight, Clock3,
  ClipboardCheck, Edit3, MapPin, Menu, Plus, Share2, ShieldCheck, Shirt,
  Sparkles, Trophy, UserRound, X, Zap,
} from 'lucide-react';

const events = [
  { id: 'falcons', kind: 'Game', month: 'MAY', day: '18', weekday: 'SAT', time: '10:30 AM', title: 'vs Northside Falcons', location: 'Riverside Athletic Complex · Field 2', status: 'Published' },
  { id: 'practice', kind: 'Practice', month: 'MAY', day: '21', weekday: 'TUE', time: '5:15 PM', title: 'Team practice', location: 'Westview High School', status: 'Published' },
];

function PixelPlayer() {
  return (
    <svg className="locker-player" viewBox="0 0 132 176" role="img" aria-label="Pixel-art softball athlete in a navy uniform">
      <g shapeRendering="crispEdges">
        <rect x="46" y="8" width="40" height="10" fill="#162e54" /><rect x="39" y="17" width="54" height="8" fill="#162e54" />
        <rect x="35" y="25" width="63" height="8" fill="#2869ce" /><rect x="42" y="33" width="48" height="22" fill="#f0b58b" />
        <rect x="36" y="24" width="12" height="15" fill="#2869ce" /><rect x="83" y="24" width="13" height="15" fill="#2869ce" />
        <rect x="49" y="39" width="5" height="4" fill="#14233b" /><rect x="76" y="39" width="5" height="4" fill="#14233b" />
        <rect x="57" y="49" width="18" height="4" fill="#bd6c60" /><rect x="42" y="57" width="46" height="8" fill="#f5f4ed" />
        <rect x="34" y="65" width="63" height="43" fill="#1448a2" /><rect x="25" y="70" width="13" height="34" fill="#f0b58b" />
        <rect x="96" y="69" width="12" height="36" fill="#f0b58b" /><rect x="50" y="69" width="30" height="7" fill="#e8f1ff" />
        <rect x="56" y="82" width="19" height="7" fill="#98c8ff" /><rect x="52" y="91" width="28" height="4" fill="#98c8ff" />
        <rect x="43" y="107" width="45" height="17" fill="#f4f1e7" /><rect x="47" y="124" width="16" height="29" fill="#f4f1e7" />
        <rect x="68" y="124" width="16" height="29" fill="#f4f1e7" /><rect x="48" y="135" width="14" height="6" fill="#2263bf" />
        <rect x="70" y="135" width="13" height="6" fill="#2263bf" /><rect x="40" y="151" width="25" height="9" fill="#263e68" />
        <rect x="67" y="151" width="25" height="9" fill="#263e68" /><rect x="34" y="159" width="34" height="8" fill="#f7f4e9" />
        <rect x="64" y="159" width="34" height="8" fill="#f7f4e9" /><rect x="97" y="100" width="16" height="19" fill="#a36535" />
        <rect x="91" y="106" width="18" height="13" fill="#c58b4b" /><rect x="17" y="91" width="14" height="13" fill="#f0b58b" />
      </g>
      <path d="M34 28c0-13 11-22 32-22s33 9 33 22H34Z" fill="#1d5bc2" stroke="#a8d6ff" strokeWidth="2" />
      <path d="M58 18h15v10H58z" fill="#d7ecff" /><text x="65" y="26" textAnchor="middle" fontSize="8" fontWeight="900" fill="#1d5bc2">7</text>
    </svg>
  );
}

function App() {
  const [activeNav, setActiveNav] = useState('Home');
  const [activeModal, setActiveModal] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(events[0]);
  const [notice, setNotice] = useState('');

  const openEvent = (event: typeof events[number]) => {
    setSelectedEvent(event);
    setActiveModal('event');
  };
  const doAction = (label: string) => {
    setNotice(`${label} is ready for Maya’s season.`);
    window.setTimeout(() => setNotice(''), 2800);
  };

  return (
    <div className="locker-app">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800;900&family=DM+Sans:wght@400;500;600;700;800&display=swap');
        .locker-app{--night:#08162c;--deep:#0c2140;--panel:#102b50;--panel2:#15365e;--line:#29486d;--ice:#dcecff;--muted:#a9bfd8;--lime:#b8f45c;--cyan:#72c9ff;min-height:100dvh;background:#071329;color:#f6f8ff;font-family:'DM Sans',sans-serif;padding-bottom:82px;position:relative;overflow:hidden}
        .locker-app *{box-sizing:border-box}.locker-app button{font:inherit}.locker-app button:focus-visible,.locker-app a:focus-visible{outline:3px solid var(--lime);outline-offset:3px}
        .locker-app::before{content:'';position:fixed;inset:0;pointer-events:none;opacity:.17;background-image:linear-gradient(90deg,rgba(93,163,236,.12) 1px,transparent 1px),linear-gradient(rgba(93,163,236,.1) 1px,transparent 1px);background-size:32px 32px}
        .locker-wrap{position:relative;z-index:1;max-width:1280px;margin:auto;padding:0 26px 32px}
        .locker-header{height:68px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(146,188,230,.14)}
        .locker-brand{display:flex;align-items:center;gap:9px;color:#fff;font-weight:900;letter-spacing:.16em;font-size:17px}
        .locker-brand-mark{width:27px;height:27px;border:2px solid #72bfff;display:grid;place-items:center;color:var(--lime);font-family:'Barlow Condensed',sans-serif;font-size:16px;transform:rotate(-4deg);box-shadow:3px 3px 0 #1b5798}
        .locker-header-right{display:flex;align-items:center;gap:14px}.locker-family{font-size:11px;color:#b4c9df;font-weight:700;letter-spacing:.09em;text-transform:uppercase}.locker-icon-btn{display:grid;place-items:center;width:40px;height:40px;border:1px solid var(--line);border-radius:12px;color:#d6e7fb;background:#0e2341;cursor:pointer}
        .locker-main{display:grid;grid-template-columns:minmax(0,1.18fr) minmax(320px,.82fr);gap:18px;padding-top:19px}
        .locker-hero{position:relative;min-height:345px;border:1px solid #315680;border-radius:24px;overflow:hidden;background:radial-gradient(ellipse at 75% 55%,rgba(42,102,174,.35),transparent 45%),linear-gradient(145deg,#122f58,#0b1d38 72%);padding:26px 28px}
        .locker-hero::after{content:'';position:absolute;inset:auto 0 0;height:74px;opacity:.28;background:repeating-linear-gradient(0deg,transparent 0 12px,rgba(83,154,202,.28) 13px 15px),linear-gradient(90deg,#142d4e,#205341 50%,#172f4e)}
        .locker-orbit{position:absolute;right:47px;top:29px;width:229px;height:229px;border:1px dashed rgba(122,193,246,.3);border-radius:50%;box-shadow:0 0 0 22px rgba(104,178,239,.025),0 0 0 48px rgba(104,178,239,.02)}
        .locker-hero-copy{position:relative;z-index:2;max-width:390px}.locker-kicker{display:flex;align-items:center;gap:8px;color:var(--lime);font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}.locker-kicker-dot{width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 12px rgba(184,244,92,.6)}
        .locker-hero h1{font:900 clamp(42px,6vw,68px)/.88 'Barlow Condensed',sans-serif;letter-spacing:-.02em;text-transform:uppercase;margin:15px 0 8px;max-width:340px}.locker-hero h1 span{display:block;color:#8ecbff}.locker-identity{color:#c4d7ee;font-size:12px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}
        .locker-hero-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.locker-primary,.locker-secondary{min-height:46px;border-radius:10px;padding:0 16px;display:inline-flex;align-items:center;gap:10px;font-size:12px;font-weight:800;cursor:pointer}
        .locker-primary{background:#1f75e6;border:1px solid #72baff;color:#fff;box-shadow:0 4px 0 #12498d}.locker-secondary{background:rgba(9,26,49,.7);border:1px solid #51749a;color:#deedff}
        .locker-player{position:absolute;z-index:1;width:161px;height:216px;object-fit:contain;right:12%;bottom:37px;filter:drop-shadow(0 10px 16px rgba(0,0,0,.3));image-rendering:pixelated}
        .locker-gear{position:absolute;z-index:2;bottom:20px;right:25px;color:#9bd0ff;display:flex;align-items:center;gap:7px;font-size:9px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.locker-gear svg{color:var(--lime)}
        .locker-side{display:grid;grid-template-rows:auto 1fr;gap:14px}.locker-next{border:1px solid #33547b;border-radius:20px;padding:18px 19px;background:linear-gradient(135deg,#14345e,#0c2040);position:relative;overflow:hidden}
        .locker-next::after{content:'';position:absolute;width:130px;height:130px;border:1px solid rgba(105,174,232,.16);border-radius:50%;right:-36px;bottom:-65px;box-shadow:0 0 0 15px rgba(105,174,232,.035),0 0 0 30px rgba(105,174,232,.025)}
        .locker-section-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.locker-section-label{font-size:10px;font-weight:800;letter-spacing:.16em;color:#acd8ff;text-transform:uppercase;display:flex;align-items:center;gap:8px}.locker-chip{border:1px solid #4973a0;background:#153b68;color:#d9efff;border-radius:999px;padding:5px 9px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
        .locker-next h2{font:800 26px/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:12px 0 7px}.locker-next-meta{color:#bdd0e5;font-size:12px;line-height:1.6;display:grid;gap:4px}.locker-next-meta span{display:flex;gap:7px;align-items:center}.locker-next-meta svg{color:#83caff}
        .locker-next-bottom{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px}.locker-next-note{font-size:11px;color:#b6cbe0}.locker-mini-btn{background:var(--lime);border:0;border-radius:8px;color:#183017;font-size:11px;font-weight:900;min-height:38px;padding:0 12px;display:flex;align-items:center;gap:8px;cursor:pointer}
        .locker-record{border:1px solid #29476b;border-radius:18px;background:#0d2140;padding:15px 17px;display:flex;align-items:center;gap:14px}.locker-record-title{min-width:90px;color:#93c9ff;font:800 17px/.92 'Barlow Condensed',sans-serif;letter-spacing:.08em;text-transform:uppercase}.locker-record-stats{display:grid;grid-template-columns:repeat(3,1fr);flex:1}.locker-stat{text-align:center;border-left:1px solid #29476b}.locker-stat strong{display:block;font:800 34px/.95 'Barlow Condensed',sans-serif;font-variant-numeric:tabular-nums}.locker-stat span{display:block;color:#a9c0db;font-size:9px;font-weight:800;letter-spacing:.13em;margin-top:4px}
        .locker-section{margin-top:23px}.locker-section-title-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.locker-section-title{display:flex;align-items:center;gap:9px;margin:0;font:900 27px/.95 'Barlow Condensed',sans-serif;letter-spacing:.04em;text-transform:uppercase}.locker-section-title svg{color:var(--lime)}.locker-add{display:flex;align-items:center;gap:6px;min-height:38px;border-radius:9px;padding:0 12px;border:1px solid #77b7ff;background:#1b66bf;color:#fff;font-size:11px;font-weight:800;cursor:pointer}
        .locker-events{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.locker-event{display:grid;grid-template-columns:58px minmax(0,1fr) auto;align-items:center;gap:12px;min-height:94px;padding:12px;border:1px solid #2b4c72;border-radius:14px;background:linear-gradient(115deg,#112c50,#0c1d39);cursor:pointer;text-align:left;color:inherit;transition:transform .18s ease,border-color .18s ease}.locker-event:hover{transform:translateY(-2px);border-color:#74b8f5}
        .locker-date{display:grid;place-items:center;align-content:center;height:62px;border-right:1px solid #355578;color:#8dc7ff}.locker-date b{font:900 28px/.9 'Barlow Condensed',sans-serif}.locker-date span{font-size:8px;font-weight:900;letter-spacing:.14em}
        .locker-event-copy{min-width:0}.locker-event-type{font-size:8px;color:#9fd2ff;letter-spacing:.13em;text-transform:uppercase;font-weight:900}.locker-event-copy h3{margin:3px 0 5px;font-size:13px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.locker-event-copy p{margin:0;color:#aec2da;font-size:10px;line-height:1.4}.locker-event-copy p svg{vertical-align:-2px;margin-right:3px;color:#7dbff3}
        .locker-event-open{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#173c68;color:#bfe4ff}.locker-tools{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
        .locker-tool{display:flex;min-height:85px;flex-direction:column;align-items:center;justify-content:center;gap:7px;border:1px solid #2b4b70;border-radius:14px;background:linear-gradient(155deg,#122b4d,#0b1e3a);color:#e7f2ff;cursor:pointer;font-size:10px;font-weight:800;text-align:center}.locker-tool svg{color:#83c9ff}.locker-tool:hover{border-color:#80c6ff;background:#15345b}
        .locker-hype{margin-top:20px;border:1px solid #355980;border-radius:18px;padding:17px 19px;display:flex;align-items:center;justify-content:space-between;gap:15px;background:linear-gradient(110deg,#102747,#172f54);overflow:hidden;position:relative}.locker-hype::after{content:'';position:absolute;right:92px;top:-26px;width:125px;height:125px;background:repeating-linear-gradient(45deg,rgba(123,187,246,.05) 0 8px,transparent 8px 16px);transform:rotate(10deg)}
        .locker-hype-copy{position:relative;z-index:1}.locker-hype-kicker{display:flex;align-items:center;gap:6px;color:var(--lime);font-size:9px;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.locker-hype h2{font:800 24px/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:6px 0 4px}.locker-hype p{margin:0;color:#b6cbe1;font-size:11px}.locker-hype-button{position:relative;z-index:1;min-height:42px;padding:0 13px;border:1px solid #6597cc;border-radius:9px;background:#102849;color:#eef7ff;font-size:11px;font-weight:800;display:flex;align-items:center;gap:8px;cursor:pointer}
        .locker-bottom-nav{position:fixed;z-index:5;bottom:0;left:0;right:0;display:grid;grid-template-columns:repeat(3,1fr);height:70px;padding-bottom:env(safe-area-inset-bottom);background:rgba(7,19,41,.96);border-top:1px solid #294768;backdrop-filter:blur(14px)}
        .locker-nav-item{display:flex;align-items:center;justify-content:center;gap:6px;flex-direction:column;color:#92a9c6;border:0;background:transparent;font-size:10px;font-weight:700;cursor:pointer;position:relative}.locker-nav-item svg{width:19px;height:19px}.locker-nav-item.is-active{color:#77bfff}.locker-nav-item.is-active::after{content:'';position:absolute;bottom:3px;width:40px;height:3px;border-radius:5px;background:var(--lime)}
        .locker-toast{position:fixed;z-index:10;bottom:84px;left:50%;transform:translateX(-50%);background:#e8f3ff;color:#102745;border-radius:12px;padding:11px 15px;box-shadow:0 10px 25px #0008;font-size:12px;font-weight:700;display:flex;align-items:center;gap:8px;white-space:nowrap}
        .locker-modal-backdrop{position:fixed;z-index:20;inset:0;background:rgba(2,9,20,.74);display:grid;place-items:center;padding:18px}.locker-modal{width:min(100%,440px);border:1px solid #47709b;border-radius:20px;background:#0d2342;padding:20px;box-shadow:0 25px 70px #0008}.locker-modal-head{display:flex;align-items:center;justify-content:space-between}.locker-modal h2{font:800 26px/1 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:0}.locker-modal-close{border:0;background:transparent;color:#d7eaff;width:40px;height:40px;display:grid;place-items:center;cursor:pointer}.locker-modal-body{color:#c0d3e8;font-size:13px;line-height:1.55;margin:14px 0}.locker-modal-row{display:flex;gap:8px;align-items:center;margin:8px 0}.locker-modal-row svg{color:#82c7ff;flex:none}.locker-modal-actions{display:flex;gap:9px;margin-top:17px}.locker-modal-actions button{flex:1;justify-content:center}
        .locker-field{display:grid;gap:6px;color:#bed4e9;font-size:11px;font-weight:700;margin-top:13px}.locker-field input{min-height:43px;border-radius:9px;border:1px solid #385c82;background:#091a33;color:#fff;padding:0 12px;font:600 13px 'DM Sans',sans-serif}
        @media(min-width:950px){.locker-tools{max-width:620px}.locker-events{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(min-width:950px){.locker-header{position:relative}.locker-bottom-nav{position:absolute;top:13px;right:30%;bottom:auto;left:auto;width:270px;height:42px;padding:0;display:flex;gap:8px;border:0;background:transparent;backdrop-filter:none}.locker-nav-item{flex:1;flex-direction:row;gap:6px;border-radius:9px;font-size:11px}.locker-nav-item svg{width:16px;height:16px}.locker-nav-item.is-active{background:#102849}.locker-nav-item.is-active::after{bottom:-3px;width:25px;height:2px}}
        @media(max-width:700px){.locker-wrap{padding:0 16px 22px}.locker-header{height:58px}.locker-brand{font-size:15px}.locker-family{display:none}.locker-main{display:flex;flex-direction:column;gap:12px;padding-top:12px}.locker-hero{min-height:307px;padding:20px 17px;border-radius:20px}.locker-orbit{width:180px;height:180px;right:9px;top:25px}.locker-player{width:125px;height:171px;right:1px;bottom:31px}.locker-hero h1{font-size:47px;margin-top:12px;max-width:245px}.locker-identity{font-size:10px;max-width:190px;line-height:1.5}.locker-hero-copy{max-width:245px}.locker-hero-actions{gap:8px;margin-top:19px}.locker-primary,.locker-secondary{min-height:43px;padding:0 11px;font-size:10px;gap:6px}.locker-gear{right:11px;bottom:12px;font-size:8px}.locker-side{display:flex;flex-direction:column;gap:10px}.locker-next{padding:15px;border-radius:17px}.locker-next h2{font-size:24px}.locker-next-meta{font-size:11px}.locker-record{padding:13px 12px;gap:8px}.locker-record-title{font-size:15px;min-width:74px}.locker-stat strong{font-size:30px}.locker-stat span{font-size:8px}.locker-section{margin-top:20px}.locker-section-title{font-size:25px}.locker-events{grid-template-columns:1fr;gap:8px}.locker-event{min-height:84px;grid-template-columns:53px minmax(0,1fr) 31px;padding:10px;gap:10px}.locker-date{height:56px}.locker-date b{font-size:26px}.locker-event-copy h3{font-size:12px}.locker-tools{gap:7px}.locker-tool{min-height:79px;border-radius:12px;font-size:9px}.locker-tool svg{width:21px}.locker-hype{padding:14px 13px;margin-top:15px}.locker-hype h2{font-size:21px}.locker-hype p{font-size:10px;max-width:195px}.locker-hype-button{min-height:39px;padding:0 9px;font-size:10px}.locker-bottom-nav{height:68px}}
        @media(max-width:360px){.locker-player{width:109px;right:-5px}.locker-hero h1{font-size:41px}.locker-hero-copy{max-width:220px}.locker-primary,.locker-secondary{font-size:9px;padding:0 8px}.locker-hype-button{font-size:9px}}
        @media(prefers-reduced-motion:reduce){.locker-event{transition:none}}
      `}</style>

      <div className="locker-wrap">
        <header className="locker-header">
          <div className="locker-brand"><span className="locker-brand-mark">P</span><span>PIXL SPORTS</span></div>
          <div className="locker-header-right"><span className="locker-family">Family season · 2025</span><button className="locker-icon-btn" aria-label="Open menu" onClick={() => doAction('Menu')}><Menu size={19} /></button></div>
        </header>
        <main>
          <div className="locker-main">
            <section className="locker-hero" aria-labelledby="athlete-name">
              <div className="locker-orbit" aria-hidden="true" />
              <div className="locker-hero-copy">
                <div className="locker-kicker"><span className="locker-kicker-dot" /> ALL IN, ALL SEASON</div>
                <h1 id="athlete-name">Maya <span>Carter</span></h1>
                <div className="locker-identity">SOFTBALL · #7 · WESTVIEW WILDCATS</div>
                <div className="locker-hero-actions">
                  <button className="locker-primary" onClick={() => setActiveModal('profile')}><Edit3 size={15} /> Customize athlete <ArrowRight size={15} /></button>
                  <button className="locker-secondary" onClick={() => doAction('HYPE Card')}><Zap size={15} /> HYPE Card</button>
                </div>
              </div>
              <PixelPlayer />
              <div className="locker-gear"><Shirt size={14} /> Maya’s locker · #7</div>
            </section>
            <div className="locker-side">
              <section className="locker-next" aria-labelledby="next-event-heading">
                <div className="locker-section-head"><span className="locker-section-label"><span className="locker-kicker-dot" /> UP NEXT</span><span className="locker-chip">Game day</span></div>
                <h2 id="next-event-heading">Northside Falcons</h2>
                <div className="locker-next-meta">
                  <span><CalendarDays size={14} /> Saturday, May 18 · 10:30 AM</span>
                  <span><MapPin size={14} /> Riverside Athletic Complex · Field 2</span>
                </div>
                <div className="locker-next-bottom"><span className="locker-next-note">A little prep goes a long way.</span><button className="locker-mini-btn" onClick={() => doAction('Prep checklist')}>Get prepped <ArrowRight size={14} /></button></div>
              </section>
              <section className="locker-record" aria-label="Season record: 8 wins, 3 losses, 1 tie">
                <div className="locker-record-title">SEASON<br />RECORD</div>
                <div className="locker-record-stats">
                  <div className="locker-stat"><strong>8</strong><span>WINS</span></div><div className="locker-stat"><strong>3</strong><span>LOSSES</span></div><div className="locker-stat"><strong>1</strong><span>TIES</span></div>
                </div>
              </section>
            </div>
          </div>

          <section className="locker-section" aria-labelledby="event-cards-title">
            <div className="locker-section-title-row"><h2 className="locker-section-title" id="event-cards-title"><CalendarDays size={20} /> Event cards</h2><button className="locker-add" onClick={() => setActiveModal('add')}><Plus size={16} /> Add event</button></div>
            <div className="locker-events">
              {events.map((event) => <button key={event.id} className="locker-event" onClick={() => openEvent(event)} aria-label={`Open ${event.kind}: ${event.title}`}>
                <span className="locker-date"><span>{event.month}</span><b>{event.day}</b></span>
                <span className="locker-event-copy"><span className="locker-event-type">{event.kind} · {event.weekday} · {event.time}</span><h3>{event.title}</h3><p><MapPin size={12} /> {event.location}</p></span>
                <span className="locker-event-open"><ChevronRight size={17} /></span>
              </button>)}
            </div>
          </section>
          <section className="locker-section" aria-labelledby="tools-title">
            <div className="locker-section-title-row"><h2 className="locker-section-title" id="tools-title"><Sparkles size={20} /> Your tools</h2></div>
            <div className="locker-tools">
              <button className="locker-tool" onClick={() => doAction('Prep checklist')}><ClipboardCheck size={25} /><span>Prep<br />checklist</span></button>
              <button className="locker-tool" onClick={() => doAction('Track stats')}><Trophy size={25} /><span>Track<br />stats</span></button>
              <button className="locker-tool" onClick={() => doAction('Share tracker')}><Share2 size={25} /><span>Share<br />tracker</span></button>
              <button className="locker-tool" onClick={() => doAction('HYPE Card')}><Bell size={25} /><span>HYPE<br />Card</span></button>
            </div>
          </section>
          <section className="locker-hype" aria-label="Maya's HYPE Card">
            <div className="locker-hype-copy"><div className="locker-hype-kicker"><Zap size={13} /> Player card</div><h2>Her season. Her spotlight.</h2><p>Maya’s HYPE Card is ready to share with family.</p></div>
            <button className="locker-hype-button" onClick={() => doAction('HYPE Card')}><Share2 size={15} /> View HYPE Card <ArrowRight size={14} /></button>
          </section>
        </main>
      </div>
      <nav className="locker-bottom-nav" aria-label="Main navigation">
        {[
          { name: 'Home', icon: <ShieldCheck /> },
          { name: 'Events', icon: <CalendarDays /> },
          { name: 'Athlete', icon: <UserRound /> },
        ].map((item) => <button key={item.name} className={`locker-nav-item ${activeNav === item.name ? 'is-active' : ''}`} aria-current={activeNav === item.name ? 'page' : undefined} onClick={() => { setActiveNav(item.name); if (item.name !== 'Home') doAction(item.name); }}>{item.icon}<span>{item.name}</span></button>)}
      </nav>
      {notice && <div className="locker-toast" role="status"><Check size={16} />{notice}</div>}
      {activeModal && <div className="locker-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setActiveModal(''); }}>
        <section className="locker-modal" role="dialog" aria-modal="true" aria-labelledby="locker-modal-title">
          <div className="locker-modal-head"><h2 id="locker-modal-title">{activeModal === 'event' ? 'Event details' : activeModal === 'profile' ? 'Athlete profile' : 'Add an event card'}</h2><button className="locker-modal-close" aria-label="Close dialog" onClick={() => setActiveModal('')}><X /></button></div>
          {activeModal === 'event' ? <><div className="locker-modal-body"><div className="locker-modal-row"><CalendarDays size={16} />{selectedEvent.kind} · {selectedEvent.weekday}, {selectedEvent.month} {selectedEvent.day}, 2025</div><div className="locker-modal-row"><Clock3 size={16} />{selectedEvent.time} · {selectedEvent.status}</div><div className="locker-modal-row"><MapPin size={16} />{selectedEvent.location}</div><p>{selectedEvent.title}</p></div><div className="locker-modal-actions"><button className="locker-secondary" onClick={() => { setActiveModal(''); doAction('Prep checklist'); }}><ClipboardCheck size={15} /> Get prepped</button><button className="locker-primary" onClick={() => { setActiveModal(''); doAction('Event card'); }}>Open card <ArrowRight size={15} /></button></div></> :
            activeModal === 'profile' ? <><div className="locker-modal-body">Your athlete profile keeps Maya’s season details together.</div><label className="locker-field">Athlete name<input defaultValue="Maya Carter" /></label><label className="locker-field">Team<input defaultValue="Westview Wildcats" /></label><label className="locker-field">Sport and number<input defaultValue="Softball · #7" /></label><div className="locker-modal-actions"><button className="locker-primary" onClick={() => { setActiveModal(''); doAction('Profile customization'); }}><Check size={15} /> Done</button></div></> :
              <><div className="locker-modal-body">Create an Event Card for a game or practice. This preview does not save changes.</div><label className="locker-field">Event name<input placeholder="e.g. Saturday tournament" /></label><label className="locker-field">Date and time<input type="datetime-local" /></label><label className="locker-field">Location<input placeholder="Venue or field" /></label><div className="locker-modal-actions"><button className="locker-secondary" onClick={() => setActiveModal('')}>Cancel</button><button className="locker-primary" onClick={() => { setActiveModal(''); doAction('Event card draft'); }}><Plus size={15} /> Preview card</button></div></>}
        </section>
      </div>}
    </div>
  );
}

export function Dashboard() {
  return <App />;
}

export default Dashboard;
