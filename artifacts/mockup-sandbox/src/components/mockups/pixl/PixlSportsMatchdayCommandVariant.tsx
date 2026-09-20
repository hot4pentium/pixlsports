import { useState } from "react";
import {
  Activity,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Flag,
  MapPin,
  MoreHorizontal,
  Plus,
  Radio,
  Share2,
  Shield,
  Sparkles,
  Trophy,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";

type Role = "fan" | "coach";
type View = "plan" | "live" | "squad";
type EventId = "arrival" | "warmup" | "kickoff" | "wrap";

const timeline: Array<{
  id: EventId;
  time: string;
  title: string;
  detail: string;
  tag: string;
  accent: string;
  icon: typeof Clock3;
}> = [
  {
    id: "arrival",
    time: "3:45",
    title: "Meet at the south gate",
    detail: "Parents + players · Eastside Field",
    tag: "Up next",
    accent: "#e88b5c",
    icon: MapPin,
  },
  {
    id: "warmup",
    time: "4:00",
    title: "Warm-up window",
    detail: "Blue kit · Bring water",
    tag: "In 18 min",
    accent: "#6ba99b",
    icon: Activity,
  },
  {
    id: "kickoff",
    time: "4:30",
    title: "Falcons vs Northside",
    detail: "League match · Pitch 2",
    tag: "Match",
    accent: "#d7af4b",
    icon: Trophy,
  },
  {
    id: "wrap",
    time: "6:10",
    title: "Pack down + photos",
    detail: "South gate · Save the good ones",
    tag: "After",
    accent: "#a68bc8",
    icon: Sparkles,
  },
];

const navItems: Array<{ id: View; label: string; icon: typeof CalendarDays }> = [
  { id: "plan", label: "Plan", icon: CalendarDays },
  { id: "live", label: "Live", icon: Radio },
  { id: "squad", label: "Squad", icon: UsersRound },
];

function ProgressRing({ value }: { value: number }) {
  return (
    <div className="relative flex h-14 w-14 items-center justify-center rounded-full" style={{ background: `conic-gradient(#e88b5c ${value}%, #293941 0)` }}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#24343b]">
        <span className="font-display text-sm text-[#f3ecdc]">{value}%</span>
      </div>
    </div>
  );
}

export function PixlSportsMatchdayCommandVariant() {
  const [role, setRole] = useState<Role>("fan");
  const [view, setView] = useState<View>("plan");
  const [selectedEvent, setSelectedEvent] = useState<EventId | null>("arrival");
  const [checked, setChecked] = useState<string[]>(["water"]);
  const [showRoleSheet, setShowRoleSheet] = useState(false);
  const [notice, setNotice] = useState("");

  const selected = timeline.find((item) => item.id === selectedEvent);

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  }

  function toggleChecklist(item: string) {
    setChecked((current) => current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item]);
  }

  function chooseView(nextView: View) {
    setView(nextView);
    if (nextView === "live") notify("Live board is ready");
    if (nextView === "squad") notify("Squad board opened");
  }

  return (
    <main className="min-h-[100dvh] bg-[#d7ded6] px-3 py-3 text-[#f3ecdc] sm:px-6 sm:py-6">
      <div className="mx-auto flex h-[calc(100dvh-1.5rem)] max-w-[440px] flex-col overflow-hidden rounded-[2rem] border border-[#15242a]/15 bg-[#24343b] shadow-[0_24px_80px_rgba(28,48,53,0.25)] sm:h-[820px]">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(rgba(243,236,220,.18) .7px, transparent .7px)", backgroundSize: "9px 9px" }} />

          <header className="relative flex items-center justify-between px-5 pb-4 pt-5">
            <button
              type="button"
              onClick={() => setShowRoleSheet(true)}
              className="flex items-center gap-2 rounded-full border border-[#f3ecdc]/15 px-2.5 py-1.5 text-left transition-transform active:scale-95"
              aria-label="Change view"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e88b5c] text-[#24343b]">
                {role === "coach" ? <Shield className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
              </span>
              <span className="text-[9px] font-black uppercase tracking-[0.17em] text-[#f3ecdc]/65">{role} view</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#e88b5c]" />
              <span className="font-display text-lg uppercase tracking-[-0.06em] text-[#f3ecdc]">pixl<span className="text-[#e88b5c]">.</span></span>
            </div>
            <button type="button" onClick={() => notify("No new team updates")} aria-label="Notifications" className="relative flex h-9 w-9 items-center justify-center rounded-full border border-[#f3ecdc]/15 text-[#f3ecdc]/75 transition-transform active:scale-95">
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-[#e88b5c]" />
            </button>
          </header>

          {view === "plan" && (
            <div className="relative h-full overflow-y-auto px-5 pb-28 [scrollbar-width:none]">
              <section className="pb-6 pt-3">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#e88b5c]">Tuesday · Sep 17</p>
                    <h1 className="mt-3 font-display text-[3.35rem] uppercase leading-[0.78] tracking-[-0.05em] text-[#f3ecdc]">Matchday<br /><span className="text-[#e88b5c]">in one view.</span></h1>
                  </div>
                  <button type="button" onClick={() => notify("Share sheet opened")} aria-label="Share matchday" className="mb-1 flex h-10 w-10 items-center justify-center rounded-full border border-[#f3ecdc]/15 text-[#f3ecdc]/70 active:scale-90">
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>
                <p className="mt-5 max-w-[19rem] text-xs font-medium leading-relaxed text-[#f3ecdc]/52">Everything your sideline needs, ordered by the next decision — not buried in a feed.</p>
              </section>

              <section className="relative overflow-hidden rounded-[1.45rem] border border-[#d7af4b]/40 bg-[#d7af4b] p-4 text-[#24343b]">
                <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full border border-[#24343b]/15" />
                <div className="relative flex items-start justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#24343b]/65">Next decision · 18 min</p>
                    <p className="mt-3 max-w-[12rem] font-display text-[2.35rem] uppercase leading-[0.8]">Get to<br />the gate.</p>
                  </div>
                  <div className="rounded-full bg-[#24343b] p-2.5 text-[#d7af4b]"><Flag className="h-4 w-4" /></div>
                </div>
                <div className="relative mt-6 flex items-center justify-between border-t border-[#24343b]/15 pt-3">
                  <span className="flex items-center gap-1.5 text-[10px] font-bold text-[#24343b]/70"><Clock3 className="h-3.5 w-3.5" /> 3:45 PM · South gate</span>
                  <button type="button" onClick={() => { setSelectedEvent("arrival"); notify("Arrival details opened"); }} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#24343b] text-[#d7af4b] transition-transform active:scale-90" aria-label="Open arrival details"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </section>

              <section className="pt-7">
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#f3ecdc]/38">The run of show</p>
                    <h2 className="mt-2 font-display text-2xl uppercase leading-none text-[#f3ecdc]">Today, in order</h2>
                  </div>
                  <span className="rounded-full border border-[#f3ecdc]/15 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-[#f3ecdc]/48">4 stops</span>
                </div>
                <div className="relative mt-5">
                  <div className="absolute bottom-7 left-[23px] top-7 w-px bg-[#f3ecdc]/15" />
                  <div className="space-y-2">
                    {timeline.map((item, index) => {
                      const EventIcon = item.icon;
                      const isSelected = selectedEvent === item.id;
                      return (
                        <button key={item.id} type="button" onClick={() => setSelectedEvent(item.id)} className={`relative flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-transform active:scale-[.985] ${isSelected ? "border-[#f3ecdc]/25 bg-[#30454d]" : "border-transparent bg-[#293c43]/60"}`}>
                          <span className="z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border-4 border-[#24343b]" style={{ backgroundColor: isSelected ? item.accent : "#3c5055", color: isSelected ? "#24343b" : "#f3ecdc" }}>
                            <EventIcon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className={`font-display text-[1.18rem] uppercase leading-none ${isSelected ? "text-[#f3ecdc]" : "text-[#f3ecdc]/72"}`}>{item.title}</span>
                              <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.1em]" style={{ color: isSelected ? item.accent : "rgba(243,236,220,.35)" }}>{item.time}</span>
                            </span>
                            <span className="mt-1.5 flex items-center justify-between gap-2">
                              <span className="truncate text-[10px] font-medium text-[#f3ecdc]/42">{item.detail}</span>
                              <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.12em] text-[#f3ecdc]/32">{item.tag}</span>
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>

              <section className="mt-7 border-t border-[#f3ecdc]/10 pt-5">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#f3ecdc]/38">Ready check</p>
                  <span className="text-[9px] font-black uppercase tracking-[0.15em] text-[#6ba99b]">{checked.length} / 3 packed</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    { id: "water", label: "Water", icon: Circle },
                    { id: "kit", label: "Blue kit", icon: Shield },
                    { id: "camera", label: "Camera", icon: Sparkles },
                  ].map((item) => {
                    const ItemIcon = item.icon;
                    const isChecked = checked.includes(item.id);
                    return (
                      <button key={item.id} type="button" onClick={() => toggleChecklist(item.id)} className={`flex min-h-[68px] flex-col items-start justify-between rounded-xl border p-3 text-left active:scale-[.98] ${isChecked ? "border-[#6ba99b]/45 bg-[#304b4b]" : "border-[#f3ecdc]/10 bg-[#293c43]/55"}`}>
                        <ItemIcon className={`h-4 w-4 ${isChecked ? "text-[#6ba99b]" : "text-[#f3ecdc]/40"}`} />
                        <span className={`text-[10px] font-black uppercase tracking-[0.08em] ${isChecked ? "text-[#f3ecdc]" : "text-[#f3ecdc]/45"}`}>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {view === "live" && (
            <div className="relative h-full overflow-y-auto px-5 pb-28 [scrollbar-width:none]">
              <section className="pt-5">
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#e88b5c]">Live match centre</p>
                <div className="mt-3 flex items-end justify-between">
                  <h1 className="font-display text-[3.6rem] uppercase leading-[0.75] tracking-[-0.05em]">Falcons<br /><span className="text-[#d7af4b]">38 — 31</span></h1>
                  <div className="mb-1 flex items-center gap-2 rounded-full border border-[#e88b5c]/40 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-[#e88b5c]"><span className="h-1.5 w-1.5 rounded-full bg-[#e88b5c]" /> Q3 · 08:41</div>
                </div>
              </section>
              <section className="mt-8 rounded-[1.5rem] border border-[#f3ecdc]/12 bg-[#293c43] p-4">
                <div className="flex items-center justify-between">
                  <div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#f3ecdc]/38">Match pulse</p><p className="mt-2 font-display text-2xl uppercase">Your sideline</p></div>
                  <ProgressRing value={68} />
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {[["Kicks", "07"], ["Saves", "12"], ["Fouls", "03"]].map(([label, value]) => <div key={label} className="border border-[#f3ecdc]/10 p-3"><span className="text-[8px] font-black uppercase tracking-widest text-[#f3ecdc]/40">{label}</span><p className="mt-2 font-display text-2xl text-[#d7af4b]">{value}</p></div>)}
                </div>
              </section>
              <section className="mt-7">
                <div className="flex items-center justify-between"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#f3ecdc]/38">Latest moments</p><button type="button" onClick={() => notify("Moment capture is ready")} className="flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.12em] text-[#e88b5c]"><Plus className="h-3.5 w-3.5" /> Add moment</button></div>
                <div className="mt-4 space-y-2">
                  {["Maya · clean save", "Theo · corner won", "Inez · big recovery"].map((moment, index) => <button key={moment} type="button" onClick={() => notify(`${moment} saved to moments`)} className="flex w-full items-center gap-3 rounded-xl border border-[#f3ecdc]/10 bg-[#293c43]/65 p-3 text-left"><span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: index === 0 ? "#6ba99b" : index === 1 ? "#d7af4b" : "#a68bc8", color: "#24343b" }}><Check className="h-4 w-4" /></span><span><span className="block text-xs font-bold text-[#f3ecdc]">{moment}</span><span className="mt-1 block text-[9px] font-black uppercase tracking-[0.12em] text-[#f3ecdc]/35">{index + 2} min ago · tap to share</span></span><ChevronRight className="ml-auto h-4 w-4 text-[#f3ecdc]/35" /></button>)}
                </div>
              </section>
            </div>
          )}

          {view === "squad" && (
            <div className="relative h-full overflow-y-auto px-5 pb-28 [scrollbar-width:none]">
              <section className="pt-5">
                <p className="text-[9px] font-black uppercase tracking-[0.22em] text-[#e88b5c]">{role === "coach" ? "Coach board" : "Squad board"}</p>
                <h1 className="mt-3 font-display text-[3.45rem] uppercase leading-[0.76] tracking-[-0.05em]">Falcons<br /><span className="text-[#6ba99b]">together.</span></h1>
                <div className="mt-5 flex items-center justify-between border-b border-[#f3ecdc]/10 pb-4"><span className="text-xs font-medium text-[#f3ecdc]/52">12 players · 4 starters</span><button type="button" onClick={() => notify("Invite link copied")} className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-[#e88b5c]"><Plus className="h-3.5 w-3.5" /> Invite</button></div>
              </section>
              <section className="mt-5 space-y-2">
                {["Maya Chen", "Theo Brooks", "Inez Carter", "Ravi Singh", "Noa Williams"].map((player, index) => <button key={player} type="button" onClick={() => notify(`${player}'s card opened`)} className="flex w-full items-center gap-3 rounded-xl border border-[#f3ecdc]/10 bg-[#293c43]/65 p-3 text-left"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d7af4b] font-display text-sm text-[#24343b]">{player.split(" ").map((part) => part[0]).join("")}</span><span className="flex-1"><span className="block text-xs font-bold text-[#f3ecdc]">{player}</span><span className="mt-1 block text-[9px] font-black uppercase tracking-[0.12em] text-[#f3ecdc]/35">{index < 4 ? "Starting line" : "Squad"}</span></span><span className={`h-2 w-2 rounded-full ${index < 4 ? "bg-[#6ba99b]" : "bg-[#f3ecdc]/20"}`} /><ChevronRight className="h-4 w-4 text-[#f3ecdc]/30" /></button>)}
              </section>
            </div>
          )}

          <nav className="absolute bottom-0 left-0 right-0 z-10 border-t border-[#f3ecdc]/10 bg-[#24343b]/95 px-4 pb-4 pt-3 backdrop-blur-md">
            <div className="flex items-center justify-around">
              {navItems.map((item) => {
                const NavIcon = item.icon;
                const selectedNav = view === item.id;
                return <button key={item.id} type="button" onClick={() => chooseView(item.id)} className={`flex min-w-[70px] flex-col items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.1em] ${selectedNav ? "text-[#e88b5c]" : "text-[#f3ecdc]/35"}`}><NavIcon className={`h-[18px] w-[18px] ${selectedNav ? "stroke-[2.5]" : ""}`} />{item.label}</button>;
              })}
              <button type="button" onClick={() => notify("More team options opened")} className="flex min-w-[70px] flex-col items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-[#f3ecdc]/35"><MoreHorizontal className="h-[18px] w-[18px]" />More</button>
            </div>
          </nav>

          {selected && view === "plan" && (
            <div className="pointer-events-none absolute bottom-[78px] left-4 right-4 z-10">
              <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-[#f3ecdc]/15 bg-[#304950] px-3 py-2.5 shadow-[0_12px_30px_rgba(16,28,32,.3)]">
                <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: selected.accent, color: "#24343b" }}><selected.icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-black uppercase tracking-[0.08em] text-[#f3ecdc]">{selected.title}</span><span className="mt-0.5 block truncate text-[9px] text-[#f3ecdc]/45">{selected.detail}</span></span>
                <button type="button" onClick={() => notify(`${selected.title} added to your plan`)} className="rounded-lg bg-[#e88b5c] px-2.5 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-[#24343b]">Save</button>
              </div>
            </div>
          )}
        </div>

        {showRoleSheet && (
          <div className="absolute inset-0 z-20 flex items-end bg-[#17272d]/70 p-3 backdrop-blur-sm">
            <div className="w-full rounded-[1.6rem] border border-[#f3ecdc]/15 bg-[#304950] p-5 text-[#f3ecdc] shadow-2xl">
              <div className="flex items-center justify-between">
                <div><p className="text-[9px] font-black uppercase tracking-[0.2em] text-[#e88b5c]">Personalize the board</p><p className="mt-2 font-display text-2xl uppercase leading-none">Who&apos;s on the sideline?</p></div>
                <button type="button" onClick={() => setShowRoleSheet(false)} aria-label="Close role menu" className="flex h-9 w-9 items-center justify-center rounded-full border border-[#f3ecdc]/15"><X className="h-4 w-4" /></button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {(["fan", "coach"] as Role[]).map((item) => <button key={item} type="button" onClick={() => { setRole(item); setShowRoleSheet(false); notify(`${item === "fan" ? "Fan" : "Coach"} view selected`); }} className={`flex items-center justify-between rounded-xl border p-3 text-left text-[10px] font-black uppercase tracking-[0.12em] ${role === item ? "border-[#e88b5c] bg-[#e88b5c] text-[#24343b]" : "border-[#f3ecdc]/15 text-[#f3ecdc]/65"}`}><span>{item} view</span>{role === item && <Check className="h-4 w-4" />}</button>)}
              </div>
              <button type="button" onClick={() => { setShowRoleSheet(false); notify("Team link copied"); }} className="mt-2 flex w-full items-center justify-between rounded-xl border border-[#f3ecdc]/15 p-3 text-left text-[10px] font-black uppercase tracking-[0.12em] text-[#f3ecdc]/65"><span>Share this matchday board</span><Share2 className="h-4 w-4 text-[#e88b5c]" /></button>
            </div>
          </div>
        )}

        {notice && <div className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#f3ecdc] px-4 py-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#24343b] shadow-lg">{notice}</div>}
      </div>
    </main>
  );
}

export default PixlSportsMatchdayCommandVariant;