import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Heart,
  Home,
  MapPin,
  Menu,
  MoreHorizontal,
  Radio,
  Share2,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import "./PixlSportsResponsiveUnified.css";

type Role = "fan" | "coach";
type Tool = "schedule" | "checklist" | "tracker" | "hype" | "roster";
type Nav = "home" | "tools" | "live" | "you";

const tools: Array<{ id: Tool; label: string; eyebrow: string; description: string; icon: typeof CalendarDays; accent: string }> = [
  { id: "schedule", label: "Schedule", eyebrow: "01 / Fan hub", description: "The week’s game plan, without the group-chat archaeology.", icon: CalendarDays, accent: "#ff9a70" },
  { id: "checklist", label: "Game day", eyebrow: "02 / Fan hub", description: "A small shared list for the big details nobody wants to forget.", icon: ClipboardCheck, accent: "#9af9b1" },
  { id: "tracker", label: "Live tracker", eyebrow: "03 / Fan hub", description: "Tap the moments as they happen. Watch the season total build.", icon: Radio, accent: "#f4d476" },
  { id: "hype", label: "Hype card", eyebrow: "04 / Fan hub", description: "Turn a sideline snap into something worth sending around.", icon: Sparkles, accent: "#c8a6ff" },
  { id: "roster", label: "Roster", eyebrow: "05 / Coach hub", description: "Starters, squad, and changes in one view for the whole team.", icon: UsersRound, accent: "#74d9ea" },
];

function ToolArtwork({ tool, role, onAction }: { tool: Tool; role: Role; onAction: (message: string) => void }) {
  if (tool === "schedule") return <div className="pixl-art pixl-schedule"><div className="pixl-art-head"><span>Next event</span><CalendarDays /></div><div className="pixl-date"><b>SAT</b><strong>14</strong><b>SEP</b></div><div className="pixl-event"><strong>Falcons<br className="mobile-only" /> vs Northside</strong><span><MapPin /> 4:30 PM · Eastside Field</span></div><button type="button" onClick={() => onAction("Schedule is open")} className="pixl-art-cta">Game day <ArrowRight /></button></div>;
  if (tool === "checklist") return <div className="pixl-art pixl-check"><div className="pixl-art-head"><span>Before you leave</span><b>2 / 3</b></div><h3>Small list.<br /><em>Big calm.</em></h3>{["Water + snacks", "Blue warm-up", "Share arrival time"].map((item, i) => <button type="button" className="pixl-check-row" key={item} onClick={() => onAction(`${item} ${i < 2 ? "already checked" : "added to the list"}`)}><span className={i < 2 ? "is-checked" : ""}>{i < 2 && <Check />}</span>{item}</button>)}</div>;
  if (tool === "tracker") return <div className="pixl-art pixl-tracker"><div className="pixl-art-head"><span>Live · Q3 08:41</span><Radio /></div><h3>Falcons <em>38</em></h3><div className="pixl-metrics">{[["Kicks", "7"], ["Saves", "12"], ["Fouls", "3"]].map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div><button type="button" onClick={() => onAction("Live board opened")} className="pixl-outline-cta">Open live board <ArrowRight /></button></div>;
  if (tool === "hype") return <div className="pixl-art pixl-hype"><div className="pixl-art-head"><span>Moment maker</span><Sparkles /></div><h3>Own the<br /><em>moment.</em></h3><p><span /> Photo from Saturday · 12 sec</p><button type="button" onClick={() => onAction("Hype card ready to share")} className="pixl-outline-cta"><Share2 /> Share this moment</button></div>;
  return <div className="pixl-art pixl-roster"><div className="pixl-art-head"><span>{role === "coach" ? "Coach board" : "Squad board"}</span><UsersRound /></div><h3>Falcons<br /><em>2024 / 25</em></h3><p>12 players · 4 starters <ArrowRight /></p></div>;
}

export function PixlSportsResponsiveUnified() {
  const [role, setRole] = useState<Role>("fan");
  const [tool, setTool] = useState<Tool>("schedule");
  const [nav, setNav] = useState<Nav>("home");
  const [menu, setMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const index = tools.findIndex((item) => item.id === tool);
  const active = tools[index];
  const ActiveIcon = active.icon;
  const notify = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 2200); };
  const selectTool = (next: Tool) => { setTool(next); setNav("tools"); };
  const moveTool = (direction: "next" | "previous") => setTool(tools[(index + (direction === "next" ? 1 : 4)) % tools.length].id);

  return (
    <main className="pixl-unified">
      <div className="pixl-shell">
        <header className="pixl-topbar">
          <button type="button" className="pixl-brand" onClick={() => { setNav("home"); notify("Back to your Pixl home"); }}><span className="pixl-mark"><Activity /></span><span><b>pixl<span>.</span></b><small>SPORTS STUDIO</small></span></button>
          <nav className="pixl-desktop-nav" aria-label="Main navigation"><button type="button" className="active" onClick={() => notify("Overview selected")}>The hubs</button><button type="button" onClick={() => notify("How it works selected")}>How it works</button><button type="button" onClick={() => notify("Pricing selected")}>Pricing</button></nav>
          <div className="pixl-actions"><button type="button" className="pixl-signin" onClick={() => notify("Sign in is ready when you are")}>Sign in</button><button type="button" className="pixl-start" onClick={() => notify("Your free workspace is ready")} >Start free <ArrowRight /></button><button type="button" className="pixl-icon-button mobile-menu-trigger" aria-label="Open menu" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button></div>
        </header>
        {menu && <div className="pixl-mobile-menu"><button type="button" onClick={() => { setRole("fan"); setMenu(false); notify("Fan hub selected"); }}>Fan hub</button><button type="button" onClick={() => { setRole("coach"); setMenu(false); notify("Coach hub selected"); }}>Coach hub</button><button type="button" onClick={() => { setMenu(false); notify("Share link copied"); }}>Share Pixl with the team <Share2 /></button></div>}

        <div className="pixl-content">
          <aside className="pixl-sidebar"><div><div className="pixl-side-label">SEASON 24 <MoreHorizontal /></div><button type="button" className="side-item" onClick={() => setNav("home")}>Overview</button><button type="button" className={`side-item ${role === "fan" ? "selected" : ""}`} onClick={() => setRole("fan")}>Fan hub <ArrowRight /></button><button type="button" className={`side-item ${role === "coach" ? "selected" : ""}`} onClick={() => setRole("coach")}>Coach hub <ArrowRight /></button></div><div className="pixl-side-foot">BUILT FOR THE SIDELINE<br /><span>Less chasing. More cheering.</span></div></aside>
          <section className="pixl-overview"><div className="pixl-grid-lines" /><div className="pixl-overview-top"><span className="pixl-pill"><Activity /> Your season, in one place</span><span className="pixl-live">● LIVE STUDIO</span></div><div className="pixl-hero-copy"><small>PIXL SPORTS / HOME BASE</small><h1>One week.<br /><em>One hub.</em><br />Game on.</h1><p>Choose how you show up for the season. Pixl puts the right tool in front of you, then gets out of the way.</p></div><div className="pixl-role-row"><div><small>CHOOSE YOUR HOME BASE</small><div className="role-buttons"><button type="button" className={role === "fan" ? "selected" : ""} onClick={() => setRole("fan")}><Heart /> Fan hub {role === "fan" && <Check />}</button><button type="button" className={role === "coach" ? "selected" : ""} onClick={() => setRole("coach")}><ShieldCheck /> Coach hub {role === "coach" && <Check />}</button></div></div><button type="button" className="pixl-text-link" onClick={() => notify(`${role === "fan" ? "Fan" : "Coach"} hub opened`)}>Enter {role} hub <ArrowRight /></button></div></section>
          <aside className="pixl-week"><div className="pixl-side-label">THIS WEEK <CalendarDays /></div><div className="week-event"><small>NEXT UP · SATURDAY</small><h2>Falcons vs Northside</h2><span><MapPin /> 4:30 PM · Eastside Field</span></div><button type="button" onClick={() => selectTool("schedule")} className="pixl-open-schedule">Open schedule <ArrowRight /></button><div className="pixl-principle"><small>THE PIXL PRINCIPLE</small><strong>Less chasing.<br />More cheering.</strong><span>FOR EVERY SIDELINE <Heart /></span></div></aside>
        </div>

        <section className="pixl-tools"><div className="pixl-tools-heading"><div><small>{role === "fan" ? "FAN HUB" : "COACH HUB"} / YOUR WEEK</small><h2>We guide the week.<br /><em>{role === "fan" ? "You enjoy the moments." : "Lead the team."}</em></h2></div><p>Move from calendar to game day to celebration with one clear next step at every turn.</p></div><div className="pixl-tools-body"><div className="pixl-tool-tabs" role="tablist">{tools.map((item) => { const Icon = item.icon; return <button type="button" role="tab" aria-selected={item.id === tool} className={item.id === tool ? "selected" : ""} key={item.id} onClick={() => selectTool(item.id)}><Icon /> {item.label}</button>; })}</div><div className="pixl-tool-detail"><div className="pixl-detail-heading"><span><i><ActiveIcon /></i><small>{active.eyebrow}</small><h3>{active.label}</h3></span><div className="pixl-mobile-arrows"><button type="button" aria-label="Previous tool" onClick={() => moveTool("previous")}><ChevronLeft /></button><button type="button" aria-label="Next tool" onClick={() => moveTool("next")}><ChevronRight /></button></div></div><p className="pixl-description">{active.description}</p><div onTouchStart={(event) => { (event.currentTarget as HTMLElement).dataset.start = String(event.changedTouches[0]?.clientX ?? 0); }} onTouchEnd={(event) => { const start = Number((event.currentTarget as HTMLElement).dataset.start); const delta = (event.changedTouches[0]?.clientX ?? start) - start; if (Math.abs(delta) > 42) moveTool(delta < 0 ? "next" : "previous"); }}><ToolArtwork tool={tool} role={role} onAction={notify} /></div><div className="pixl-step-row">{["Set the essentials", "Check items off", "Arrive ready"].map((step, i) => <span key={step}><b>0{i + 1}</b>{tool === "schedule" ? ["Add the event", "Share the details", "Keep the week current"][i] : step}</span>)}</div><button type="button" className="pixl-text-link" onClick={() => notify(`${active.label} opened`)}>Try {active.label} <ArrowRight /></button></div></div></section>

        <section className="pixl-pulse"><div><small>QUICK PULSE</small><span>● 3 THINGS MOVING</span></div><button type="button" onClick={() => selectTool("tracker")}><span>Saturday<strong>Match day</strong></span><Radio /></button><button type="button" onClick={() => selectTool("hype")}><span>Saved<strong>12 moments</strong></span><Heart /></button></section>
        <nav className="pixl-bottom-nav" aria-label="Mobile navigation">{([["home", Home, "Home"], ["tools", MoreHorizontal, "Tools"], ["live", Activity, "Live"], ["you", UserRound, "You"]] as const).map(([id, Icon, label]) => <button type="button" key={id} className={nav === id ? "selected" : ""} onClick={() => { setNav(id); if (id === "live") selectTool("tracker"); if (id === "you") notify("Your profile is ready"); }}><Icon />{label}</button>)}</nav>
        <footer>PIXL SPORTS · A CLEARER SEASON STARTS HERE. <span>● STUDIO ONLINE</span></footer>
        {notice && <div className="pixl-notice" role="status">{notice}</div>}
      </div>
    </main>
  );
}

export default PixlSportsResponsiveUnified;