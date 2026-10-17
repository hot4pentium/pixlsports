import { Link } from 'wouter';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { getGetAthleteFanCardQueryKey, useGetAthleteFanCard } from '@workspace/api-client-react';
import { normalizeCardAppearance } from './hype-card-appearance';
import { PlayerKit } from './soccer-gear-builder';
import { gameOnHref } from './athlete-event-links';
import './athlete-locker.css';

export function SharedLockerPage({ params }: { params: { inviteToken?: string } }) {
  const inviteToken = params.inviteToken ?? '';
  const { data: invite, isLoading, isError, refetch } = useGetAthleteFanCard(inviteToken, {
    query: { enabled: !!inviteToken, queryKey: getGetAthleteFanCardQueryKey(inviteToken), retry: false, refetchOnWindowFocus: true, refetchInterval: 60_000 },
  });
  const fanHref = `/fan/${encodeURIComponent(inviteToken)}`;

  if (isLoading) {
    return (
      <main className="shared-locker" aria-busy="true" role="status" data-testid="status-shared-locker-loading">
        <div className="shared-locker__shell athlete-locker__skeleton" style={{ minHeight: 420 }}>Loading locker</div>
      </main>
    );
  }
  if (isError || !invite || !inviteToken) {
    return (
      <main className="shared-locker" role="alert" data-testid="status-shared-locker-unavailable">
        <div className="shared-locker__shell shared-locker__empty">
          <p className="athlete-locker__eyebrow">Shared Pixl Locker</p>
          <h1>This Locker is paused or unavailable.</h1>
          <p>The link may have changed, or the owner may have paused the athlete page. Check with whoever shared it.</p>
          {inviteToken && <button type="button" className="shared-locker__btn" onClick={() => void refetch()} data-testid="button-shared-locker-retry">Try again</button>}
        </div>
      </main>
    );
  }

  const appearance = normalizeCardAppearance(invite.cardAppearance);
  const jersey = appearance.jerseyNumber;
  const accent = appearance.accentColor;
  const sport = invite.sport.charAt(0).toUpperCase() + invite.sport.slice(1);
  const events = invite.showEvents ? invite.events ?? [] : [];

  return (
    <main className="shared-locker" data-testid="page-shared-locker">
      <div className="shared-locker__shell">
        <header className="shared-locker__head">
          <span className="shared-locker__badge"><ShieldCheck size={20} aria-hidden="true" /></span>
          <div>
            <p className="athlete-locker__eyebrow" data-testid="label-shared-locker-public">Shared Pixl Locker · Public view</p>
            <h1 data-testid="text-shared-locker-name">{invite.athleteName}</h1>
            <p className="shared-locker__meta">{[invite.teamName, sport].filter(Boolean).join(' / ')}</p>
          </div>
        </header>

        <div className="shared-locker__stage" style={{ ['--kit' as string]: accent }}>
          <div className="shared-locker__spot" aria-hidden="true" />
          {invite.photoUrl && <img className="shared-locker__photo" src={invite.photoUrl} alt={`${invite.athleteName}`} data-testid="img-shared-locker-photo" />}
          {invite.soccerGear && invite.sport === 'soccer' ? (
            <div className="shared-locker__kit" data-testid="figure-shared-locker-kit">
              <PlayerKit loadout={invite.soccerGear} athleteName={invite.athleteName} jerseyNumber={jersey || ''} />
            </div>
          ) : (
            <div className="shared-locker__jersey" data-testid="figure-shared-locker-jersey" aria-label="Generic team jersey">
              <svg viewBox="0 0 200 210" aria-hidden="true">
                <path d="M70 8 Q100 28 130 8 L186 36 L170 88 L146 76 L146 202 L54 202 L54 76 L30 88 L14 36 Z" fill="var(--kit)" stroke="rgba(255,255,255,.35)" strokeWidth="2"/>
                <path d="M70 8 Q100 28 130 8 Q100 44 70 8Z" fill="#f3f6fa"/>
                <path d="M30 88 L14 36 L26 31 L44 80Z M170 88 L186 36 L174 31 L156 80Z" fill="rgba(255,255,255,.85)"/>
              </svg>
              <span className="shared-locker__jersey-name">{invite.athleteName.split(/\s+/)[0]}</span>
              {jersey && <strong data-testid="text-shared-locker-number">{jersey}</strong>}
            </div>
          )}
          <p className="shared-locker__kitnote" data-testid="text-shared-locker-kit-note">
            {invite.soccerGear && invite.sport === 'soccer' ? 'Saved match-day kit' : 'Generic team jersey, no saved kit shared'}
          </p>
          <div className="shared-locker__bench" aria-hidden="true" />
          <Link href={fanHref} className="shared-locker__cta" data-testid="link-shared-locker-hype-card">
            View HYPE Card <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </div>
        <footer className="shared-locker__foot">
          <span>{invite.seasonName}</span><span>Read-only view</span>
        </footer>
      </div>

      <section className="shared-locker__shell shared-locker__events" aria-label="Event Cards" data-testid="section-shared-locker-events">
        <h2>Event Cards</h2>
        {events.length ? (
          <ul>
            {events.map((e) => (
              <li key={`${e.shareToken}-${e.eventId}`}>
                <Link href={gameOnHref(e.shareToken)} className="shared-locker__event" data-testid={`link-shared-locker-event-${e.eventId}`}>
                  <strong>{e.opponent ? `vs ${e.opponent}` : e.title || 'Event'}</strong>
                  <span>{[e.date, e.time, e.location].filter(Boolean).join(' · ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="shared-locker__none" data-testid="text-shared-locker-no-events">
            {invite.showEvents ? 'No public Event Cards have been shared yet.' : 'Event Cards are not shared on this Locker.'}
          </p>
        )}
      </section>
    </main>
  );
}

export default SharedLockerPage;
