import type { ReactNode } from 'react';
import { CalendarDays, ExternalLink, MapPin, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import gameOnBadge from '../assets/game-on-badge.webp';

export type PublicAthletePageStatus = 'published' | 'paused' | 'unpublished';

export type PublicGameOnCardFrontFaceProps = {
  eventTitle: string;
  eventType: 'game' | 'practice';
  stageLabel: string;
  opponent?: string;
  dateLabel: string;
  time?: string;
  location?: string;
  athleteName?: string;
  athletePageStatus: PublicAthletePageStatus;
  athletePageHref?: string;
  showingAlternateFace?: boolean;
  alternateFace?: ReactNode;
  controls?: ReactNode;
};

export function PublicGameOnCardFrontFace({
  eventTitle,
  eventType,
  stageLabel,
  opponent,
  dateLabel,
  time,
  location,
  athleteName,
  athletePageStatus,
  athletePageHref,
  showingAlternateFace = false,
  alternateFace,
  controls,
}: PublicGameOnCardFrontFaceProps) {
  const isPractice = eventType === 'practice';

  return (
    <section
      className="relative mx-auto w-full max-w-[600px] text-[#0B1F3A]"
      aria-label={`Event Card, ${showingAlternateFace ? 'stats side' : 'event side'}`}
    >
      <img
        src={gameOnBadge}
        alt=""
        aria-hidden="true"
        className="block w-full"
        width="1023"
        height="1538"
      />
      <div className="absolute inset-x-[12%] bottom-[8%] top-[12%] flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between gap-2 border-b border-[#d9e2ed] pb-3 sm:pb-5">
          <span className="font-display text-lg uppercase leading-none tracking-wide text-[#0B1F3A] sm:text-2xl">Pixl Sports</span>
          <span className="text-right text-[9px] font-black uppercase tracking-[.16em] text-[#2474F5] sm:text-[11px]">Event Card</span>
        </div>

        <div id="game-on-card-face" className="flex min-h-0 flex-1 flex-col pt-4 sm:pt-8" aria-live="polite">
          {showingAlternateFace && alternateFace ? alternateFace : (
            <div className="flex flex-1 flex-col" data-testid="game-on-front-face">
              <p className="text-[9px] font-black uppercase tracking-[.2em] text-[#2474F5] sm:text-xs">{stageLabel}</p>
              <h1 className="mt-2 break-words font-display text-[clamp(1.8rem,6vw,3.6rem)] uppercase leading-[.95] tracking-wide">{eventTitle}</h1>
              {athleteName && <p className="mt-2 text-xs font-semibold text-[#52657a] sm:text-base">Following {athleteName}</p>}
              <div className="mt-5 border-t-2 border-[#0B1F3A] pt-4 sm:mt-10 sm:pt-7">
                <p className="text-[9px] font-black uppercase tracking-[.2em] text-[#2474F5] sm:text-xs">{isPractice ? 'Practice' : 'Game day'}</p>
                {!isPractice && (
                  <p className="mt-1 break-words font-display text-[clamp(1.65rem,5.5vw,3rem)] uppercase leading-none">
                    {opponent ? `vs ${opponent}` : 'Game day'}
                  </p>
                )}
                <p className="mt-3 flex items-start gap-2 text-xs font-bold leading-snug sm:text-base">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[#2474F5]" aria-hidden="true" />
                  <span>{dateLabel}{time ? ` · ${time}` : ''}</span>
                </p>
                {location && (
                  <div className="mt-2 flex items-start gap-2 text-xs font-semibold leading-snug sm:mt-4 sm:text-base">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#2474F5]" aria-hidden="true" />
                    <div>
                      <span className="break-words">{location}</span>
                      <a href={`https://maps.google.com/?q=${encodeURIComponent(location)}`} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-bold text-[#1758bd] underline underline-offset-2">
                        Map <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-auto border-t border-[#d9e2ed] pt-3 sm:pt-6">
                <p className="text-[9px] font-black uppercase tracking-[.2em] text-[#2474F5] sm:text-xs">Athlete Hype Page</p>
                {athletePageStatus === 'published' && athletePageHref ? (
                  <Link href={athletePageHref} className="mt-2 inline-flex min-h-11 max-w-full items-center gap-2 bg-[#2474F5] px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-[#0B1F3A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2474F5] sm:px-5 sm:text-xs" data-testid="game-on-athlete-page-link">
                    <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" /> Visit {athleteName ? `${athleteName}’s page` : 'Athlete Page'}
                  </Link>
                ) : (
                  <p className="mt-2 text-xs font-medium leading-snug text-[#52657a] sm:text-sm">
                    {athletePageStatus === 'paused' ? 'The Athlete Hype Page is currently paused.' : 'No Athlete Hype Page is published yet.'}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        {controls}
      </div>
    </section>
  );
}