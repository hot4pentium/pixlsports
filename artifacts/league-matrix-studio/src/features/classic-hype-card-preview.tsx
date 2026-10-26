import { CalendarDays, ChartNoAxesCombined, MessageCircle, ThumbsUp, Zap } from 'lucide-react';
import { Link } from 'wouter';
import { LivingAthleteCardFront } from './living-athlete-card-front';
import { normalizeCardAppearance, type HypeCardAppearance } from './hype-card-appearance';
import './classic-hype-card-preview.css';

export type HypeCardPreviewSide = 'responses' | 'stats' | 'live-taps' | 'events';

const previewSections = [
  [ThumbsUp, 'Replies', 'responses'],
  [ChartNoAxesCombined, 'Stats', 'stats'],
  [Zap, 'Taps', 'live-taps'],
  [CalendarDays, 'Events', 'events'],
] as const;

export function HypeCardPreviewNavigation({
  cardHref,
  activeSide,
  onSideChange,
}: {
  cardHref?: string;
  activeSide?: HypeCardPreviewSide | 'front';
  onSideChange?: (side: HypeCardPreviewSide | 'front') => void;
}) {
  return (
    <div className="classic-card-preview-navigation" data-testid="appearance-navigation-preview" role="group" aria-label="HYPE Card sections">
      {previewSections.map(([Icon, label, side]) => cardHref
        ? <Link key={label} href={`${cardHref}?side=${side}`} target="_blank" rel="noopener noreferrer" aria-label={`Open saved card ${label.toLowerCase()} in a new tab`} data-testid={`link-preview-flip-${label.toLowerCase()}`} data-preview-side={side}><Icon aria-hidden="true" />{label}</Link>
        : onSideChange
          ? <button key={label} type="button" onClick={() => onSideChange(activeSide === side ? 'front' : side)} aria-label={activeSide === side ? `Return to card front from ${label.toLowerCase()}` : `Preview ${label.toLowerCase()} section`} aria-pressed={activeSide === side} data-testid={`button-preview-section-${label.toLowerCase()}`} data-preview-side={side}><Icon aria-hidden="true" />{label}</button>
          : <span key={label} data-preview-side={side}><Icon aria-hidden="true" />{label}</span>)}
    </div>
  );
}

export function HypeCardDraftSectionPreview({
  side,
  athleteName,
  teamName,
}: {
  side: HypeCardPreviewSide;
  athleteName: string;
  teamName: string;
}) {
  const name = athleteName.trim() || 'Your athlete';
  const team = teamName.trim() || 'Your team';

  return (
    <div className="grid h-full w-full place-items-center overflow-hidden" data-testid="hype-card-draft-section-stage">
      <section
        className="flex max-h-full max-w-full flex-col overflow-hidden rounded-xl border border-[#9fcaef62] bg-[radial-gradient(circle_at_90%_0%,#2354869c,transparent_50%),linear-gradient(155deg,#113458,#081a30_75%)] p-5 text-[#edf3f6] shadow-xl sm:p-7"
        style={{ height: 'auto', width: 'min(100%, 24rem)', maxHeight: '100%', aspectRatio: '3 / 4' }}
        aria-label={`Example ${side === 'responses' ? 'replies' : side === 'live-taps' ? 'taps' : side} preview`}
        data-testid="hype-card-draft-section-preview"
        data-preview-side={side}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/20 pb-3 text-[9px] font-extrabold uppercase tracking-[.2em] text-[#8ecbff]">
          <span>Pixl / {side === 'responses' ? 'The crowd' : side === 'stats' ? 'The record' : side === 'live-taps' ? 'Family cheers' : 'Game days'}</span>
          <span className="shrink-0">Example preview</span>
        </div>

        {side === 'responses' && (
          <div className="flex min-h-0 flex-1 flex-col pt-5">
            <h3 className="font-display text-4xl font-black uppercase leading-none text-white sm:text-5xl">Replies.</h3>
            <p className="mt-2 text-xs font-medium text-[#a9bfd3]">Support from the people in {name}’s corner.</p>
            <div className="mt-5 grid gap-3">
              {[
                ['👏', 'Go get it, superstar!', 'Aunt Maya'],
                ['⭐', 'We’re proud of you!', 'Coach Lee'],
              ].map(([emoji, message, sender]) => (
                <article key={sender} className="border border-white/15 bg-[#0b2948] p-3">
                  <div className="flex items-center gap-2 text-sm"><span aria-hidden="true">{emoji}</span><strong className="text-xs text-white">{sender}</strong></div>
                  <p className="mb-0 mt-2 text-xs leading-relaxed text-[#d2e2ee]">“{message}”</p>
                </article>
              ))}
            </div>
            <p className="mt-auto flex items-center gap-2 border-t border-white/15 pt-4 text-[10px] font-bold uppercase tracking-wide text-[#8ecbff]"><MessageCircle size={14} aria-hidden="true" /> Supporter messages</p>
          </div>
        )}

        {side === 'stats' && (
          <div className="flex min-h-0 flex-1 flex-col pt-5">
            <h3 className="font-display text-4xl font-black uppercase leading-none text-white sm:text-5xl">Season stats.</h3>
            <p className="mt-2 text-xs font-medium text-[#a9bfd3]">{name} / {team} / Finalized games</p>
            <div className="mt-5 grid grid-cols-3 gap-px border border-white/20 bg-white/20">
              {[['3–1–0', 'W – L – T'], ['4', 'Games'], ['18', 'Points']].map(([value, label]) => (
                <div key={label} className="bg-[#12375c] p-2 text-center sm:p-3">
                  <strong className="block text-lg font-black text-white sm:text-2xl">{value}</strong>
                  <span className="text-[8px] font-bold uppercase tracking-wide text-[#a9bfd3] sm:text-[9px]">{label}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 text-xs">
              {[['Teamwork', '12'], ['Effort plays', '8']].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-white/15 py-2 text-[#d2e2ee]"><span>{label}</span><strong className="text-white">{value}</strong></div>
              ))}
            </div>
            <p className="mt-auto border-t border-white/15 pt-4 text-[10px] leading-relaxed text-[#a9bfd3]">Sample numbers show how finalized season stats can appear.</p>
          </div>
        )}

        {side === 'live-taps' && (
          <div className="flex min-h-0 flex-1 flex-col pt-5">
            <h3 className="font-display text-4xl font-black uppercase leading-none text-white sm:text-5xl">Live Taps.</h3>
            <p className="mt-2 text-xs font-medium text-[#a9bfd3]">Family cheers for {name}.</p>
            <div className="mt-5 border border-[#ff784989] bg-[#091c32] p-4">
              <div className="flex items-center justify-between gap-2">
                <div><p className="m-0 text-[9px] font-extrabold uppercase tracking-[.15em] text-[#8ecbff]">Season record</p><h4 className="mb-0 mt-1 text-sm font-extrabold uppercase text-white">Cheers this season</h4></div>
                <strong className="font-display text-4xl font-black leading-none text-[#ff7849]">24</strong>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {[['👏', 'Applause', '12'], ['💪', 'Strong', '7'], ['⭐', 'Star', '5'], ['🔥', 'Fire', '0']].map(([emoji, label, count]) => (
                  <div key={label} className="flex min-h-10 items-center gap-2 border border-[#70b7ed]/50 bg-[#194b75] px-2 py-2 text-[10px] font-bold text-white">
                    <span aria-hidden="true">{emoji}</span><span className="min-w-0 flex-1">{label}</span><strong className="text-[#ff7849]">{count}</strong>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-auto border-t border-white/15 pt-4 text-[10px] leading-relaxed text-[#a9bfd3]">Cheers are shared during Game Day Live. Counts shown are examples.</p>
          </div>
        )}

        {side === 'events' && (
          <div className="flex min-h-0 flex-1 flex-col pt-5">
            <h3 className="font-display text-4xl font-black uppercase leading-none text-white sm:text-5xl">Events.</h3>
            <p className="mt-2 text-xs font-medium text-[#a9bfd3]">Game days and season moments.</p>
            <article className="mt-5 border border-white/20 bg-[#0b2948] p-4">
              <div className="flex items-center justify-between gap-2 text-[9px] font-extrabold uppercase tracking-wide text-[#8ecbff]"><span>Game / Upcoming</span><span>Saturday · 10:00 AM</span></div>
              <h4 className="mb-0 mt-4 font-display text-2xl font-black uppercase leading-none text-white">vs. Northside</h4>
              <p className="mt-2 text-xs font-bold text-[#d2e2ee]">{team}</p>
              <dl className="mt-4 space-y-2 border-t border-white/15 pt-3 text-[10px]">
                <div className="flex justify-between gap-3"><dt className="text-[#a9bfd3]">Time</dt><dd className="m-0 font-bold text-white">10:00 AM</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-[#a9bfd3]">Location</dt><dd className="m-0 font-bold text-white">Home field</dd></div>
              </dl>
            </article>
            <p className="mt-auto border-t border-white/15 pt-4 text-[10px] leading-relaxed text-[#a9bfd3]">Eligible Event Cards can appear here when event sharing is on.</p>
          </div>
        )}
      </section>
    </div>
  );
}

export function ClassicHypeCardPreview({ athleteName, teamName, photoUrl, appearance, cardHref }: {
  athleteName: string;
  teamName: string;
  photoUrl: string | null;
  appearance?: Partial<HypeCardAppearance> | null;
  cardHref?: string;
}) {
  const cardAppearance = normalizeCardAppearance(appearance);
  return (
    <div data-testid="classic-card-preview-stack">
      <div className="classic-card-preview-surface" data-testid="classic-card-preview-surface" data-design={cardAppearance.design} role="img" aria-label={`HYPE Card preview for ${athleteName}`} style={{ aspectRatio: '3 / 4', position: 'relative' }}>
        <LivingAthleteCardFront athleteName={athleteName} teamName={teamName} photoUrl={photoUrl} appearance={cardAppearance} />
      </div>
      <HypeCardPreviewNavigation cardHref={cardHref} />
    </div>
  );
}
