import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, Clock3, Radio, ShieldCheck, Wifi } from "lucide-react";

const activityBatches = [
  {
    id: "batch-1",
    label: "3 plays just came in",
    time: "4:58 PM",
    items: [
      { title: "Touchdown", detail: "Q2 · 12:44 remaining", accent: true },
      { title: "Reception", detail: "18 yards", accent: false },
      { title: "Opponent score", detail: "Score adjustment", accent: false },
    ],
  },
  {
    id: "batch-2",
    label: "2 plays just came in",
    time: "4:57 PM",
    items: [
      { title: "Rushing attempt", detail: "7 yards", accent: false },
      { title: "Tackle", detail: "Q2 · 13:11 remaining", accent: false },
    ],
  },
];

function formatTimeAgo(seconds: number) {
  if (seconds <= 1) return "just now";
  return `${seconds} sec ago`;
}

export function RecipientView() {
  const [secondsAgo, setSecondsAgo] = useState(4);
  const [showLatest, setShowLatest] = useState(true);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSecondsAgo((value) => (value >= 5 ? 0 : value + 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (secondsAgo === 0) {
      setShowLatest(true);
      const timer = window.setTimeout(() => setShowLatest(false), 900);
      return () => window.clearTimeout(timer);
    }
  }, [secondsAgo]);

  return (
    <main className="min-h-screen bg-[#e8e6df] p-3 text-[#121713] sm:p-5">
      <div className="mx-auto min-h-[calc(100vh-1.5rem)] max-w-[390px] overflow-hidden border border-[#232923] bg-[#f7f6f1] shadow-[0_18px_50px_rgba(18,23,19,0.18)] sm:min-h-[calc(100vh-2.5rem)]">
        <header className="relative overflow-hidden bg-[#111712] px-5 pb-5 pt-5 text-[#f7f6f1]">
          <div className="absolute -right-14 -top-16 h-40 w-40 rounded-full border-[18px] border-[#d6f23b]/15" />
          <div className="absolute bottom-0 left-0 h-1 w-full bg-[#d6f23b]" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#d6f23b]">Pixl Sports / live view</p>
              <h1 className="mt-2 font-['Arial_Black'] text-[28px] uppercase leading-none tracking-[-0.04em]">Game day</h1>
            </div>
            <div className="flex items-center gap-1.5 border border-[#d6f23b]/40 bg-[#d6f23b]/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#d6f23b]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#d6f23b]" />
              Live
            </div>
          </div>
          <div className="relative mt-6 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.16em] text-white/55">
            <span>Friday, Oct 11</span>
            <span>Q2 · 12:44</span>
          </div>
          <p className="relative mt-2 text-sm font-semibold text-white/90">Westfield Falcons <span className="px-1 text-white/35">vs</span> Northside</p>
        </header>

        <section className="border-b border-[#d6d8cf] bg-[#f7f6f1] px-5 pb-6 pt-5">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#777d74]">Athlete score</p>
              <p className="mt-1 truncate text-lg font-bold uppercase tracking-tight">Jordan Ellis</p>
            </div>
            <span className="font-['Arial_Black'] text-[76px] leading-[0.82] tracking-[-0.08em] text-[#111712]">08</span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <div className="border border-[#d6d8cf] bg-white px-3 py-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#777d74]">Opponent</p>
              <p className="mt-1 text-2xl font-black tracking-tight">02</p>
            </div>
            <div className="border border-[#d6d8cf] bg-white px-3 py-3">
              <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-[#777d74]">Phase</p>
              <p className="mt-1 text-2xl font-black tracking-tight">Q2</p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.12em] text-[#777d74]">
            <span className="inline-flex items-center gap-1.5"><Wifi className="h-3.5 w-3.5 text-[#5f7114]" /> Connected</span>
            <span className={`transition-colors ${secondsAgo === 0 ? "text-[#5f7114]" : "text-[#777d74]"}`}>Updated {formatTimeAgo(secondsAgo)}</span>
          </div>
        </section>

        <section className="px-5 pb-6 pt-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#777d74]">Game activity</p>
              <h2 className="mt-1 font-['Arial_Black'] text-2xl uppercase tracking-[-0.04em]">Recent plays</h2>
            </div>
            <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-[#777d74]">
              <Clock3 className="h-3.5 w-3.5" /> Every 5 sec
            </div>
          </div>

          <div className={`mt-4 border border-[#d6d8cf] bg-white p-3 transition-all duration-500 ${showLatest ? "translate-y-0 opacity-100" : "translate-y-0 opacity-95"}`}>
            {activityBatches.map((batch, batchIndex) => (
              <div key={batch.id} className={batchIndex > 0 ? "mt-5 border-t border-[#e6e7e1] pt-4" : ""}>
                <div className="flex items-center justify-between gap-3">
                  <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${batchIndex === 0 && showLatest ? "text-[#5f7114]" : "text-[#777d74]"}`}>
                    {batchIndex === 0 && showLatest && <ArrowUpRight className="mr-1 inline h-3 w-3" />}
                    {batch.label}
                  </p>
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#9a9e96]">{batch.time}</span>
                </div>
                <div className="mt-3 space-y-2.5">
                  {batch.items.map((item) => (
                    <div key={`${batch.id}-${item.title}`} className="flex items-center gap-3">
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center ${item.accent ? "bg-[#d6f23b] text-[#111712]" : "bg-[#eef0e8] text-[#5f7114]"}`}>
                        <Activity className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold uppercase">{item.title}</p>
                        <p className="mt-0.5 truncate text-[10px] font-medium text-[#777d74]">{item.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-start gap-3 border-l-2 border-[#d6f23b] bg-[#eef0e8] px-3 py-3">
            <Radio className="mt-0.5 h-4 w-4 shrink-0 text-[#5f7114]" />
            <p className="text-[10px] font-semibold leading-relaxed text-[#4d554c]">
              This page refreshes in small batches so the scoreboard stays fast and reliable. Important game-state changes appear immediately.
            </p>
          </div>
        </section>

        <footer className="flex items-center justify-between border-t border-[#d6d8cf] bg-[#eef0e8] px-5 py-4">
          <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#777d74]"><ShieldCheck className="h-3.5 w-3.5 text-[#5f7114]" /> Shared by coach</span>
          <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#777d74]">No sign-in needed</span>
        </footer>
      </div>
    </main>
  );
}