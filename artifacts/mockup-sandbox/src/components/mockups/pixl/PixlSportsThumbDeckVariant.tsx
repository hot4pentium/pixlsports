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
  Play,
  Radio,
  Share2,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

type Role = "fan" | "coach";
type Tool = "schedule" | "checklist" | "tracker" | "hype" | "roster";
type NavItem = "home" | "tools" | "live" | "profile";

const tools: Array<{
  id: Tool;
  number: string;
  label: string;
  eyebrow: string;
  description: string;
  icon: typeof CalendarDays;
  accent: string;
}> = [
  {
    id: "schedule",
    number: "01",
    label: "Schedule",
    eyebrow: "Know the next move",
    description: "The week's game plan, without the group-chat archaeology.",
    icon: CalendarDays,
    accent: "#ff9a70",
  },
  {
    id: "checklist",
    number: "02",
    label: "Game day",
    eyebrow: "Arrive ready",
    description: "A small shared list for the big details nobody wants to forget.",
    icon: ClipboardCheck,
    accent: "#9af9b1",
  },
  {
    id: "tracker",
    number: "03",
    label: "Live tracker",
    eyebrow: "Keep the line moving",
    description: "Tap the moments as they happen. Watch the season total build.",
    icon: Radio,
    accent: "#f4d476",
  },
  {
    id: "hype",
    number: "04",
    label: "Hype card",
    eyebrow: "Make the moment",
    description: "Turn a sideline snap into something worth sending around.",
    icon: Sparkles,
    accent: "#c8a6ff",
  },
  {
    id: "roster",
    number: "05",
    label: "Roster",
    eyebrow: "Lead from one board",
    description: "Starters, squad, and changes in one view for the whole team.",
    icon: UsersRound,
    accent: "#74d9ea",
  },
];

const navItems: Array<{ id: NavItem; label: string; icon: typeof Home }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "tools", label: "Tools", icon: MoreHorizontal },
  { id: "live", label: "Live", icon: Activity },
  { id: "profile", label: "You", icon: UserRound },
];

function ToolArtwork({ tool, role }: { tool: Tool; role: Role }) {
  if (tool === "schedule") {
    return (
      <div className="relative overflow-hidden rounded-[1.4rem] border border-[#1e332f] bg-[#f4f0e4] text-[#10201e]">
        <div className="flex items-center justify-between border-b border-[#10201e]/15 px-4 py-3">
          <span className="text-[9px] font-black uppercase tracking-[0.19em] text-[#1e785a]">Next event</span>
          <CalendarDays className="h-4 w-4 text-[#1e785a]" />
        </div>
        <div className="grid grid-cols-[78px_1fr]">
          <div className="bg-[#d7e5d5] p-4 text-center">
            <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#1e785a]">SAT</p>
            <p className="font-display text-[3.5rem] leading-[0.78]">14</p>
            <p className="mt-2 text-[9px] font-black uppercase tracking-[0.18em]">SEP</p>
          </div>
          <div className="p-4">
            <p className="font-display text-[1.45rem] uppercase leading-[0.88]">Falcons<br />vs Northside</p>
            <p className="mt-3 flex items-center gap-1.5 text-[10px] font-semibold text-[#10201e]/60">
              <MapPin className="h-3 w-3 text-[#1e785a]" /> 4:30 PM · Eastside Field
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between bg-[#13231f] px-4 py-3 text-[#f4f0e4]">
          <span className="text-[9px] font-black uppercase tracking-[0.15em]">Game day</span>
          <ArrowRight className="h-4 w-4 text-[#9af9b1]" />
        </div>
      </div>
    );
  }

  if (tool === "checklist") {
    const checks = ["Water + snacks", "Blue warm-up", "Share arrival time"];
    return (
      <div className="relative overflow-hidden rounded-[1.4rem] border border-[#325b49] bg-[#18382f] p-5 text-[#f4f0e4]">
        <div className="absolute -right-14 -top-16 h-44 w-44 rounded-full border border-[#9af9b1]/20" />
        <div className="absolute -bottom-20 right-8 h-48 w-48 rounded-full border border-[#9af9b1]/15" />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#9af9b1]">Before you leave</span>
            <span className="rounded-full bg-[#9af9b1] px-2 py-1 text-[9px] font-black text-[#10201e]">2 / 3</span>
          </div>
          <p className="mt-7 max-w-[12rem] font-display text-[2.35rem] uppercase leading-[0.84]">Small list.<br /><span className="text-[#9af9b1]">Big calm.</span></p>
          <div className="mt-7 space-y-2.5">
            {checks.map((item, index) => (
              <div key={item} className="flex items-center gap-3 text-xs font-semibold">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${index < 2 ? "border-[#9af9b1] bg-[#9af9b1] text-[#10201e]" : "border-[#f4f0e4]/30 text-transparent"}`}>
                  <Check className="h-3 w-3" />
                </span>
                <span className={index < 2 ? "text-[#f4f0e4]/60 line-through" : ""}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (tool === "tracker") {
    return (
      <div className="overflow-hidden rounded-[1.4rem] border border-[#4f472a] bg-[#2b2b1c] p-5 text-[#f4f0e4]">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#f4d476]">Live · Q3 08:41</span>
            <p className="mt-3 font-display text-[2.55rem] uppercase leading-[0.8]">Falcons <span className="text-[#f4d476]">38</span></p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[#f4d476]/40">
            <Radio className="h-4 w-4 text-[#f4d476]" />
          </div>
        </div>
        <div className="mt-7 grid grid-cols-3 gap-2">
          {["Kicks", "Saves", "Fouls"].map((label, index) => (
            <div key={label} className="border border-[#f4f0e4]/15 p-3">
              <span className="text-[8px] font-black uppercase tracking-widest text-[#f4f0e4]/45">{label}</span>
              <p className="mt-2 font-display text-2xl text-[#f4d476]">{[7, 12, 3][index]}</p>
            </div>
          ))}
        </div>
        <button type="button" className="mt-4 flex w-full items-center justify-between border border-[#f4d476]/45 px-3 py-2.5 text-left text-[9px] font-black uppercase tracking-[0.15em] text-[#f4d476]">
          Open live board <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (tool === "hype") {
    return (
      <div className="relative min-h-[218px] overflow-hidden rounded-[1.4rem] border border-[#4c366a] bg-[#241b35] p-5 text-[#f4f0e4]">
        <div className="absolute right-[-13px] top-[-25px] h-36 w-36 rotate-12 rounded-[2rem] border border-[#c8a6ff]/40 bg-[#c8a6ff]/10" />
        <div className="absolute bottom-[-70px] left-8 h-40 w-40 rounded-full border border-[#ff9a70]/30" />
        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#c8a6ff]">Moment maker</span>
            <Sparkles className="h-4 w-4 text-[#ff9a70]" />
          </div>
          <div className="mt-16">
            <p className="font-display text-[3.05rem] uppercase leading-[0.76]">Own the<br /><span className="text-[#ff9a70]">moment.</span></p>
            <div className="mt-5 flex items-center gap-2 text-[10px] font-bold text-[#f4f0e4]/55"><span className="h-6 w-6 rounded-full border border-[#c8a6ff]/60 bg-[#c8a6ff]/20" /> Photo from Saturday · 12 sec</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[1.4rem] border border-[#24546a] bg-[#172f3a] p-5 text-[#f4f0e4]">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-[#74d9ea]">{role === "coach" ? "Coach board" : "Squad board"}</span>
        <UsersRound className="h-4 w-4 text-[#74d9ea]" />
      </div>
      <p className="mt-6 font-display text-[2.55rem] uppercase leading-[0.78]">Falcons<br /><span className="text-[#74d9ea]">2024 / 25</span></p>
      <div className="mt-7 flex items-center justify-between border-t border-[#f4f0e4]/15 pt-3">
        <span className="text-[9px] font-black uppercase tracking-[0.15em] text-[#f4f0e4]/55">12 players · 4 starters</span>
        <ArrowRight className="h-4 w-4 text-[#74d9ea]" />
      </div>
    </div>
  );
}

export function PixlSportsThumbDeckVariant() {
  const [role, setRole] = useState<Role>("fan");
  const [activeTool, setActiveTool] = useState<Tool>("schedule");
  const [activeNav, setActiveNav] = useState<NavItem>("home");
  const [showMenu, setShowMenu] = useState(false);
  const [notice, setNotice] = useState("");
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const activeIndex = tools.findIndex((tool) => tool.id === activeTool);
  const active = tools[activeIndex];
  const Icon = active.icon;

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  }

  function selectTool(tool: Tool) {
    setActiveTool(tool);
    setActiveNav("tools");
    notify(`${tools.find((item) => item.id === tool)?.label} opened`);
  }

  function moveTool(direction: "next" | "previous") {
    const nextIndex = direction === "next"
      ? (activeIndex + 1) % tools.length
      : (activeIndex - 1 + tools.length) % tools.length;
    setActiveTool(tools[nextIndex].id);
  }

  function handleTouchEnd(clientX: number) {
    if (touchStart === null) return;
    const delta = clientX - touchStart;
    if (Math.abs(delta) > 42) moveTool(delta < 0 ? "next" : "previous");
    setTouchStart(null);
  }

  return (
    <main className="min-h-[100dvh] bg-[#dce7dc] px-3 py-3 text-[#10201e] sm:px-6 sm:py-6">
      <div className="mx-auto flex h-[calc(100dvh-1.5rem)] max-w-[440px] flex-col overflow-hidden rounded-[2rem] border border-[#10201e]/15 bg-[#10201e] shadow-[0_24px_80px_rgba(16,32,30,0.24)] sm:h-[820px]">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: "linear-gradient(rgba(220,231,220,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(220,231,220,.08) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />
          <header className="relative flex items-center justify-between px-5 pb-3 pt-5">
            <button type="button" onClick={() => setShowMenu(true)} aria-label="Open menu" className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e8f1e5]/15 text-[#e8f1e5]/75 transition-transform active:scale-95">
              <Menu className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#9af9b1]" />
              <span className="font-display text-lg uppercase tracking-[-0.06em] text-[#e8f1e5]">pixl<span className="text-[#9af9b1]">.</span></span>
            </div>
            <button type="button" onClick={() => notify("You're all caught up")} aria-label="Notifications" className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#e8f1e5]/15 text-[#e8f1e5]/75 transition-transform active:scale-95">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-[#ff9a70]" />
            </button>
          </header>

          <section className="relative px-5 pb-5 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#9af9b1]">{role === "fan" ? "Fan hub" : "Coach hub"} · Tuesday</p>
                <h1 className="mt-3 font-display text-[3.2rem] uppercase leading-[0.78] tracking-[-0.04em] text-[#e8f1e5]">Keep the<br /><span className="text-[#9af9b1]">week moving.</span></h1>
              </div>
              <span className="mt-1 rounded-full border border-[#e8f1e5]/15 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-[#e8f1e5]/55">09 / 17</span>
            </div>
            <p className="mt-5 max-w-[19rem] text-xs font-medium leading-relaxed text-[#e8f1e5]/50">One thumb-friendly home for the next event, the live score, and the moments worth keeping.</p>
          </section>

          <section className="relative mx-4 rounded-[1.6rem] bg-[#9af9b1] p-4 text-[#10201e]">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#1e785a]">Next up · Saturday</p>
                <p className="mt-3 font-display text-[2.2rem] uppercase leading-[0.8]">Falcons<br />vs Northside</p>
              </div>
              <div className="rounded-full bg-[#10201e] p-2.5 text-[#9af9b1]"><CalendarDays className="h-4 w-4" /></div>
            </div>
            <div className="mt-7 flex items-center justify-between border-t border-[#10201e]/15 pt-3">
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-[#10201e]/65"><MapPin className="h-3.5 w-3.5" /> Eastside Field · 4:30 PM</span>
              <button type="button" onClick={() => selectTool("schedule")} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#10201e] text-[#9af9b1] transition-transform active:scale-90" aria-label="Open schedule"><ArrowRight className="h-4 w-4" /></button>
            </div>
          </section>

          <section className="relative px-5 pb-3 pt-7">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#e8f1e5]/40">Your toolkit</p>
                <h2 className="mt-2 font-display text-2xl uppercase leading-none text-[#e8f1e5]">{active.label}</h2>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => moveTool("previous")} aria-label="Previous tool" className="flex h-8 w-8 items-center justify-center rounded-full border border-[#e8f1e5]/20 text-[#e8f1e5]/70 active:scale-90"><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" onClick={() => moveTool("next")} aria-label="Next tool" className="flex h-8 w-8 items-center justify-center rounded-full border border-[#e8f1e5]/20 text-[#e8f1e5]/70 active:scale-90"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          </section>

          <section
            className="relative mx-5 touch-pan-y"
            onTouchStart={(event) => setTouchStart(event.changedTouches[0]?.clientX ?? null)}
            onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
          >
            <ToolArtwork tool={activeTool} role={role} />
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[#e8f1e5]/15" style={{ color: active.accent }}><Icon className="h-3.5 w-3.5" /></span>
                <span className="text-[10px] font-semibold text-[#e8f1e5]/50">{active.eyebrow}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {tools.map((tool, index) => <button key={tool.id} type="button" onClick={() => selectTool(tool.id)} aria-label={`Show ${tool.label}`} className={`h-1.5 rounded-full transition-all ${index === activeIndex ? "w-6" : "w-1.5 bg-[#e8f1e5]/25"}`} style={index === activeIndex ? { backgroundColor: active.accent } : undefined} />)}
              </div>
            </div>
          </section>

          <section className="relative mx-5 mt-7 border-t border-[#e8f1e5]/10 pb-28 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#e8f1e5]/40">Quick pulse</p>
              <span className="flex items-center gap-1.5 text-[9px] font-bold text-[#9af9b1]"><span className="h-1.5 w-1.5 rounded-full bg-[#9af9b1]" /> 3 things moving</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => selectTool("tracker")} className="flex items-center justify-between rounded-xl border border-[#e8f1e5]/10 bg-[#172a27] p-3 text-left active:scale-[.98]">
                <span><span className="block text-[9px] font-black uppercase tracking-widest text-[#e8f1e5]/40">Saturday</span><span className="mt-1 block text-xs font-bold text-[#e8f1e5]">Match day</span></span><Radio className="h-4 w-4 text-[#f4d476]" />
              </button>
              <button type="button" onClick={() => selectTool("hype")} className="flex items-center justify-between rounded-xl border border-[#e8f1e5]/10 bg-[#172a27] p-3 text-left active:scale-[.98]">
                <span><span className="block text-[9px] font-black uppercase tracking-widest text-[#e8f1e5]/40">Saved</span><span className="mt-1 block text-xs font-bold text-[#e8f1e5]">12 moments</span></span><Heart className="h-4 w-4 text-[#ff9a70]" />
              </button>
            </div>
          </section>

          <nav className="absolute bottom-0 left-0 right-0 z-10 border-t border-[#e8f1e5]/10 bg-[#10201e]/95 px-4 pb-4 pt-3 backdrop-blur-md">
            <div className="flex items-center justify-around">
              {navItems.map((item) => {
                const NavIcon = item.icon;
                const selected = activeNav === item.id;
                return (
                  <button key={item.id} type="button" onClick={() => { setActiveNav(item.id); if (item.id === "tools") selectTool(activeTool); if (item.id === "live") selectTool("tracker"); if (item.id === "profile") notify("Your profile is ready"); }} className={`flex min-w-[58px] flex-col items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.1em] ${selected ? "text-[#9af9b1]" : "text-[#e8f1e5]/35"}`}>
                    <NavIcon className={`h-[18px] w-[18px] ${selected ? "stroke-[2.5]" : ""}`} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        {showMenu && (
          <div className="absolute inset-0 z-20 flex items-end bg-[#10201e]/70 p-3 backdrop-blur-sm">
            <div className="w-full rounded-[1.6rem] border border-[#e8f1e5]/15 bg-[#18382f] p-5 text-[#e8f1e5] shadow-2xl">
              <div className="flex items-center justify-between">
                <div><p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#9af9b1]">Switch your view</p><p className="mt-2 font-display text-2xl uppercase leading-none">Who&apos;s on the sideline?</p></div>
                <button type="button" onClick={() => setShowMenu(false)} aria-label="Close menu" className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e8f1e5]/15"><X className="h-4 w-4" /></button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {(["fan", "coach"] as Role[]).map((item) => <button key={item} type="button" onClick={() => { setRole(item); setShowMenu(false); notify(`${item === "fan" ? "Fan" : "Coach"} hub selected`); }} className={`flex items-center justify-between rounded-xl border p-3 text-left text-[10px] font-black uppercase tracking-[0.12em] ${role === item ? "border-[#9af9b1] bg-[#9af9b1] text-[#10201e]" : "border-[#e8f1e5]/15 text-[#e8f1e5]/65"}`}><span>{item} hub</span>{role === item && <Check className="h-4 w-4" />}</button>)}
              </div>
              <button type="button" onClick={() => { setShowMenu(false); notify("Share link copied"); }} className="mt-2 flex w-full items-center justify-between rounded-xl border border-[#e8f1e5]/15 p-3 text-left text-[10px] font-black uppercase tracking-[0.12em] text-[#e8f1e5]/65"><span>Share Pixl with the team</span><Share2 className="h-4 w-4 text-[#9af9b1]" /></button>
            </div>
          </div>
        )}

        {notice && <div className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#f4f0e4] px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#10201e] shadow-lg">{notice}</div>}
      </div>
    </main>
  );
}

export default PixlSportsThumbDeckVariant;