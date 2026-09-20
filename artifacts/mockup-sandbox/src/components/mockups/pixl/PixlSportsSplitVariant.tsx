import { useState } from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  FileImage,
  Heart,
  LayoutGrid,
  MapPin,
  Menu,
  Palette,
  Play,
  Radio,
  Share2,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from "lucide-react";
import "./PixlSportsSplitVariant.css";

type Role = "fan" | "coach";
type Tool = "schedule" | "checklist" | "tracker" | "hype" | "roster";

const toolData: Record<
  Tool,
  {
    label: string;
    kicker: string;
    description: string;
    icon: typeof CalendarDays;
    steps: string[];
  }
> = {
  schedule: {
    label: "Schedule",
    kicker: "01 / Fan hub",
    description: "Turn the season plan into one event families can actually follow.",
    icon: CalendarDays,
    steps: ["Add the event", "Share the details", "Keep the week current"],
  },
  checklist: {
    label: "Game day",
    kicker: "02 / Fan hub",
    description: "Replace the game-day group chat with one shared list of what happens next.",
    icon: ClipboardCheck,
    steps: ["Set the essentials", "Check items off", "Arrive ready"],
  },
  tracker: {
    label: "Stat tracker",
    kicker: "03 / Fan hub",
    description: "Capture the game as it happens, then keep the season total growing.",
    icon: Radio,
    steps: ["Tap live plays", "Watch the line update", "Build the total"],
  },
  hype: {
    label: "Hype card",
    kicker: "04 / Fan hub",
    description: "Turn a photo or short video into a polished moment card from the sideline.",
    icon: Sparkles,
    steps: ["Choose the moment", "Pick a look", "Share the card"],
  },
  roster: {
    label: "Roster",
    kicker: "05 / Coach hub",
    description: "Make the team board clear before the game starts and keep the lineup in one place.",
    icon: UsersRound,
    steps: ["Add players", "Set the starters", "Share the lineup"],
  },
};

const toolOrder: Tool[] = ["schedule", "checklist", "tracker", "hype", "roster"];

function ToolVisual({ tool }: { tool: Tool }) {
  if (tool === "schedule") {
    return (
      <div className="overflow-hidden border border-[#98e9b4]/40 bg-[#eeeadd] text-[#122025]">
        <div className="flex items-center justify-between border-b border-[#122025]/15 px-4 py-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#087a48]">Next event</span>
          <CalendarDays className="h-4 w-4 text-[#087a48]" />
        </div>
        <div className="grid grid-cols-[86px_1fr]">
          <div className="border-r border-[#122025]/15 bg-[#d5dfd8] p-4 text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#087a48]">SAT</p>
            <p className="font-display text-5xl leading-none">14</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest">SEP</p>
          </div>
          <div className="p-4">
            <p className="font-display text-2xl uppercase leading-none">Falcons vs Northside</p>
            <p className="mt-3 text-xs font-semibold text-[#122025]/60">4:30 PM · Eastside Field</p>
            <span className="mt-4 inline-flex items-center gap-2 bg-[#122025] px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest text-[#eef4e5]">
              <MapPin className="h-3 w-3 text-[#00f776]" /> Game day
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (tool === "checklist") {
    return (
      <div className="relative min-h-[218px] overflow-hidden border border-[#98e9b4]/35 bg-[#17352d] p-5">
        <div className="absolute right-[-28px] top-[-44px] h-44 w-44 rounded-full border border-[#98e9b4]/25" />
        <div className="absolute bottom-[-74px] right-10 h-48 w-48 rounded-full border border-[#98e9b4]/20" />
        <div className="relative flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#00f776]">Saturday · 4:30 PM</p>
            <p className="mt-2 font-display text-4xl uppercase leading-none text-[#eef4e5]">Ready list</p>
          </div>
          <ClipboardCheck className="h-8 w-8 text-[#00f776]" />
        </div>
        <div className="relative mt-6 grid gap-2 sm:grid-cols-3">
          {["Kit bag", "Lineup", "Water"].map((item) => (
            <div key={item} className="flex items-center gap-2 border border-[#eef4e5]/15 bg-[#eef4e5]/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-[#eef4e5]/70">
              <Check className="h-3.5 w-3.5 text-[#00f776]" /> {item}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tool === "tracker") {
    return (
      <div className="border border-[#98e9b4]/35 bg-[#eeeadd] p-4 text-[#122025]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#087a48]">Live now · 2nd half</span>
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase text-[#bd533f]"><CircleDot className="h-3 w-3" /> Recording</span>
        </div>
        <div className="mt-5 flex items-end justify-between border-b border-[#122025]/15 pb-4">
          <div><p className="text-xs font-bold uppercase text-[#122025]/55">Falcons</p><p className="font-display text-6xl leading-none">28</p></div>
          <p className="pb-2 font-display text-2xl text-[#122025]/30">—</p>
          <div className="text-right"><p className="text-xs font-bold uppercase text-[#122025]/55">Northside</p><p className="font-display text-6xl leading-none">21</p></div>
        </div>
        <div className="mt-4 flex gap-2">
          {["TD", "P1", "REC"].map((label) => <button key={label} type="button" className="flex-1 border border-[#122025]/15 py-2 text-[10px] font-bold uppercase tracking-wider hover:bg-[#d5dfd8]">{label}</button>)}
        </div>
      </div>
    );
  }

  if (tool === "hype") {
    return (
      <div className="grid gap-3 sm:grid-cols-[1.1fr_.9fr]">
        <div className="relative min-h-[218px] overflow-hidden border border-[#98e9b4]/35 bg-[#285046]">
          <div className="absolute inset-x-8 top-8 h-36 rotate-[-7deg] border border-[#00f776]/45 bg-[#0f2925] p-4 shadow-[10px_10px_0_rgba(0,247,118,.15)]">
            <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.16em] text-[#00f776]"><span>Pixl / moment</span><span>24</span></div>
            <div className="mt-8 flex items-end justify-between"><span className="font-display text-4xl uppercase leading-none text-[#eef4e5]">All star</span><Play className="h-7 w-7 rounded-full bg-[#00f776] p-2 text-[#122025]" /></div>
          </div>
          <div className="absolute bottom-4 left-4 flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-[#eef4e5]/60"><FileImage className="h-3.5 w-3.5 text-[#00f776]" /> Choose a moment</div>
        </div>
        <div className="flex flex-col justify-between border border-[#eef4e5]/15 bg-[#0d191d] p-4">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#00f776]">Recipient view</p><p className="mt-2 font-display text-3xl uppercase text-[#eef4e5]">Worth sharing.</p><p className="mt-2 text-xs leading-relaxed text-[#eef4e5]/55">Stats, reactions, and the full moment in one clean card.</p></div>
          <div className="mt-6 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[#eef4e5]/60"><Share2 className="h-3.5 w-3.5 text-[#00f776]" /> Send it out</div>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-[#98e9b4]/35 bg-[#285046] p-5">
      <div className="flex items-center justify-between">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#00f776]">Saturday lineup</p><p className="mt-1 font-display text-3xl uppercase text-[#eef4e5]">Starting nine</p></div>
        <UsersRound className="h-7 w-7 text-[#00f776]" />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        {["MAYA 12", "JORDAN 04", "RILEY 21", "SAM 08", "NOAH 15", "AVA 02"].map((player, index) => <div key={player} className={`border px-2 py-3 text-center text-[9px] font-bold uppercase tracking-wider ${index < 3 ? "border-[#00f776] bg-[#00f776]/15 text-[#00f776]" : "border-[#eef4e5]/10 text-[#eef4e5]/55"}`}>{player}</div>)}
      </div>
    </div>
  );
}

export function PixlSportsSplitVariant() {
  const [role, setRole] = useState<Role>("fan");
  const [activeTool, setActiveTool] = useState<Tool>("schedule");
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState("");
  const active = toolData[activeTool];
  const ActiveIcon = active.icon;

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  return (
    <div className="pixl-split-focus min-h-screen overflow-x-hidden bg-[#10191d] text-[#eef4e5]" style={{ fontFamily: "'Trebuchet MS', system-ui, sans-serif" }}>
      <header className="sticky top-0 z-20 border-b border-[#eef4e5]/10 bg-[#10191d]/95 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] max-w-[1480px] items-center justify-between px-5 sm:px-8">
          <button type="button" onClick={() => flash("Back to your Pixl home")} className="group flex items-center gap-3 text-left">
            <span className="grid h-9 w-9 place-items-center bg-[#00f776] text-[#10191d] [clip-path:polygon(0_0,100%_0,100%_80%,80%_100%,0_100%)]"><Activity className="h-5 w-5" /></span>
            <span><span className="block font-display text-xl uppercase tracking-[0.14em] text-[#eef4e5]">Pixl</span><span className="block text-[9px] font-bold uppercase tracking-[0.28em] text-[#00f776]">Sports studio</span></span>
          </button>
          <nav className="hidden items-center gap-8 lg:flex">
            {["The hubs", "How it works", "Pricing"].map((label, index) => <button key={label} type="button" onClick={() => flash(`${label} is coming into focus`)} className={`text-[11px] font-bold uppercase tracking-[0.18em] transition-colors hover:text-[#00f776] ${index === 0 ? "text-[#00f776]" : "text-[#eef4e5]/55"}`}>{label}</button>)}
          </nav>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => flash("Sign in is ready when you are")} className="hidden text-[11px] font-bold uppercase tracking-[0.18em] text-[#eef4e5]/60 transition-colors hover:text-[#eef4e5] sm:block">Sign in</button>
            <button type="button" onClick={() => flash("Your free workspace is ready to start")} className="hidden items-center gap-2 bg-[#00f776] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#10191d] [clip-path:polygon(0_0,100%_0,100%_78%,88%_100%,0_100%)] sm:inline-flex">Start free <ArrowRight className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="Open menu" onClick={() => setMobileNav((value) => !value)} className="grid h-10 w-10 place-items-center border border-[#eef4e5]/20 text-[#eef4e5] lg:hidden">{mobileNav ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          </div>
        </div>
        {mobileNav && <div className="border-t border-[#eef4e5]/10 bg-[#172326] px-5 py-4 lg:hidden"><div className="flex flex-col gap-4">{["The hubs", "How it works", "Pricing", "Sign in"].map((label) => <button key={label} type="button" onClick={() => { setMobileNav(false); flash(`${label} is coming into focus`); }} className="text-left text-xs font-bold uppercase tracking-[0.18em] text-[#eef4e5]/70">{label}</button>)}</div></div>}
      </header>

      <main className="mx-auto max-w-[1480px] px-5 py-5 sm:px-8 lg:py-8">
        <div className="grid gap-5 lg:grid-cols-[188px_minmax(0,1fr)_292px]">
          <aside className="hidden flex-col justify-between border border-[#eef4e5]/10 bg-[#172326] p-4 lg:flex">
            <div>
              <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.2em] text-[#eef4e5]/40"><span>Season 24</span><LayoutGrid className="h-3.5 w-3.5" /></div>
              <div className="mt-10 space-y-2">
                {["Overview", "Fan hub", "Coach hub"].map((label, index) => <button key={label} type="button" onClick={() => { if (index === 1) setRole("fan"); if (index === 2) setRole("coach"); flash(`${label} selected`); }} className={`flex w-full items-center justify-between border-l-2 px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] transition-colors ${((role === "fan" && index === 1) || (role === "coach" && index === 2)) ? "border-[#00f776] bg-[#00f776]/10 text-[#00f776]" : "border-transparent text-[#eef4e5]/50 hover:bg-[#eef4e5]/[0.05] hover:text-[#eef4e5]"}`}>{label}{index > 0 && <ArrowUpRight className="h-3.5 w-3.5" />}</button>)}
              </div>
            </div>
            <div className="border-t border-[#eef4e5]/10 pt-4"><p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#eef4e5]/35">Built for the sideline</p><p className="mt-2 text-xs leading-relaxed text-[#eef4e5]/55">Less chasing. More cheering.</p></div>
          </aside>

          <section className="relative min-h-[640px] overflow-hidden border border-[#eef4e5]/10 bg-[#142126] p-6 sm:p-10 lg:p-12">
            <div className="pointer-events-none absolute inset-0 opacity-50" style={{ backgroundImage: "linear-gradient(90deg, rgba(0,247,118,.06) 1px, transparent 1px), linear-gradient(rgba(0,247,118,.06) 1px, transparent 1px)", backgroundSize: "42px 42px" }} />
            <div className="pointer-events-none absolute right-[-12%] top-[12%] h-[520px] w-[520px] rounded-full border border-[#00f776]/10" />
            <div className="pointer-events-none absolute right-[-4%] top-[20%] h-[390px] w-[390px] rounded-full border border-[#00f776]/10" />
            <div className="relative flex h-full flex-col justify-between">
              <div className="flex items-start justify-between gap-5">
                <div className="inline-flex items-center gap-2 border border-[#00f776]/40 bg-[#00f776]/[0.08] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#00f776]"><Activity className="h-3.5 w-3.5" /> Your season, in one place</div>
                <span className="hidden items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#eef4e5]/35 sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-[#00f776]" /> Live studio</span>
              </div>
              <div className="mt-24 max-w-3xl sm:mt-32">
                <p className="mb-5 text-[10px] font-bold uppercase tracking-[0.23em] text-[#eef4e5]/45">Pixl Sports / Home base</p>
                <h1 className="font-display text-[clamp(4rem,9vw,8.6rem)] uppercase leading-[0.78] tracking-[-0.035em] text-[#eef4e5]">One week.<br /><span className="text-[#00f776]">One hub.</span><br />Game on.</h1>
                <p className="mt-8 max-w-md text-sm font-medium leading-relaxed text-[#eef4e5]/60 sm:text-base">Choose how you show up for the season. Pixl puts the right tool in front of you, then gets out of the way.</p>
              </div>
              <div className="mt-14 flex flex-col gap-4 border-t border-[#eef4e5]/10 pt-5 sm:flex-row sm:items-end sm:justify-between">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#eef4e5]/40">Choose your home base</p><div className="mt-3 flex flex-wrap gap-2">{(["fan", "coach"] as Role[]).map((item) => { const selected = role === item; const Icon = item === "fan" ? Heart : ShieldCheck; return <button key={item} type="button" onClick={() => setRole(item)} className={`inline-flex items-center gap-2 border px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] transition-all [clip-path:polygon(0_0,100%_0,100%_78%,94%_100%,0_100%)] ${selected ? "border-[#00f776] bg-[#00f776] text-[#10191d]" : "border-[#eef4e5]/20 text-[#eef4e5]/55 hover:border-[#00f776] hover:text-[#eef4e5]"}`}><Icon className="h-4 w-4" /> {item === "fan" ? "Fan hub" : "Coach hub"} {selected && <Check className="h-3.5 w-3.5" />}</button>; })}</div></div>
                <button type="button" onClick={() => flash(role === "fan" ? "Fan Hub opened" : "Coach Hub opened")} className="inline-flex items-center gap-2 self-start text-[10px] font-bold uppercase tracking-[0.18em] text-[#00f776] hover:text-[#eef4e5] sm:self-end">Enter {role} hub <ArrowRight className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </section>

          <aside className="flex flex-col gap-5">
            <div className="border border-[#eef4e5]/10 bg-[#172326] p-5">
              <div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#00f776]">This week</p><ChevronDown className="h-4 w-4 text-[#eef4e5]/35" /></div>
              <div className="mt-6 border-l-2 border-[#00f776] pl-4"><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#eef4e5]/45">Next up · Saturday</p><p className="mt-2 font-display text-3xl uppercase leading-none text-[#eef4e5]">Falcons vs Northside</p><p className="mt-3 flex items-center gap-2 text-xs font-medium text-[#eef4e5]/55"><MapPin className="h-3.5 w-3.5 text-[#00f776]" /> 4:30 PM · Eastside Field</p></div>
              <button type="button" onClick={() => { setActiveTool("schedule"); flash("Schedule opened"); }} className="mt-7 flex w-full items-center justify-between border border-[#eef4e5]/15 px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.15em] text-[#eef4e5]/65 hover:border-[#00f776] hover:text-[#00f776]">Open schedule <ArrowUpRight className="h-4 w-4" /></button>
            </div>
            <div className="flex flex-1 flex-col justify-between border border-[#00f776]/30 bg-[#00f776] p-5 text-[#10191d]">
              <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#087a48]">The Pixl principle</p><p className="mt-5 font-display text-4xl uppercase leading-[0.82]">Less chasing.<br />More cheering.</p></div>
              <div className="mt-10 flex items-center justify-between border-t border-[#10191d]/20 pt-4"><span className="text-[10px] font-bold uppercase tracking-[0.14em]">For every sideline</span><Heart className="h-5 w-5" /></div>
            </div>
          </aside>
        </div>

        <section className="mt-5 border border-[#eef4e5]/10 bg-[#10191d]">
          <div className="flex flex-col justify-between gap-5 border-b border-[#eef4e5]/10 p-5 sm:flex-row sm:items-end sm:p-7">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#00f776]">{role === "fan" ? "Fan hub" : "Coach hub"} / your week</p><h2 className="mt-2 font-display text-4xl uppercase leading-[0.85] text-[#eef4e5] sm:text-6xl">{role === "fan" ? <>We guide the week.<br /><span className="text-[#00f776]">You enjoy the moments.</span></> : <>Run the week.<br /><span className="text-[#00f776]">Lead the team.</span></>}</h2></div>
            <p className="max-w-xs text-xs font-medium leading-relaxed text-[#eef4e5]/45">{role === "fan" ? "Move from calendar to game day to celebration with one clear next step at every turn." : "Schedules, rosters, and game-day checklists in one calm operating view."}</p>
          </div>
          <div className="grid lg:grid-cols-[212px_minmax(0,1fr)]">
            <div className="flex gap-2 overflow-x-auto border-b border-[#eef4e5]/10 p-3 lg:block lg:border-b-0 lg:border-r lg:p-4" role="tablist" aria-label="Pixl tools">
              {toolOrder.map((tool) => { const Icon = toolData[tool].icon; const selected = activeTool === tool; return <button key={tool} type="button" role="tab" aria-selected={selected} onClick={() => setActiveTool(tool)} className={`flex min-w-max items-center gap-3 px-3 py-3 text-left text-[10px] font-bold uppercase tracking-[0.14em] transition-colors lg:mb-1 lg:w-full ${selected ? "bg-[#00f776] text-[#10191d]" : "text-[#eef4e5]/45 hover:bg-[#eef4e5]/[0.05] hover:text-[#eef4e5]"}`}><Icon className="h-4 w-4" /> {toolData[tool].label}</button>; })}
            </div>
            <div className="p-5 sm:p-7"><div className="mb-5 flex items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center bg-[#00f776] text-[#10191d]"><ActiveIcon className="h-5 w-5" /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#00f776]">{active.kicker}</p><h3 className="mt-1 font-display text-3xl uppercase text-[#eef4e5]">{active.label}</h3></div></div><span className="hidden items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-[#eef4e5]/35 sm:inline-flex">Step {String(toolOrder.indexOf(activeTool) + 1).padStart(2, "0")} / 05 <ArrowUpRight className="h-3.5 w-3.5" /></span></div><p className="mb-5 max-w-2xl border-l-2 border-[#00f776] pl-3 text-sm font-medium leading-relaxed text-[#eef4e5]/65">{active.description}</p><ToolVisual tool={activeTool} /><div className="mt-5 flex flex-wrap gap-2">{active.steps.map((step, index) => <span key={step} className="inline-flex items-center gap-2 border border-[#eef4e5]/10 bg-[#eef4e5]/[0.04] px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-[#eef4e5]/55"><span className="text-[#00f776]">0{index + 1}</span>{step}</span>)}</div><button type="button" onClick={() => flash(`${active.label} opened`)} className="mt-6 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#00f776] hover:text-[#eef4e5]">Try {active.label} <ArrowRight className="h-3.5 w-3.5" /></button></div>
          </div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-[1480px] flex-col gap-3 px-5 pb-8 pt-3 text-[9px] font-bold uppercase tracking-[0.18em] text-[#eef4e5]/30 sm:flex-row sm:items-center sm:justify-between sm:px-8"><span>Pixl Sports · A clearer season starts here.</span><span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[#00f776]" /> Studio online</span></footer>
      {notice && <div role="status" className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 border border-[#00f776]/50 bg-[#172326] px-4 py-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#00f776] shadow-[0_12px_32px_rgba(0,0,0,.3)]">{notice}</div>}
    </div>
  );
}

export default PixlSportsSplitVariant;