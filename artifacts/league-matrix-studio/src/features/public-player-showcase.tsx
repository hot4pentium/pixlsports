import {
  getListAthleteInvitesQueryKey,
  getGetAthleteFanCardQueryKey,
  useListAthleteInvites,
  useGetAthleteFanCard,
} from '@workspace/api-client-react';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { useUser } from '@clerk/react';
import { BackNavigationLink } from '@/components/back-navigation-link';
import { normalizeCardAppearance } from './hype-card-appearance';
import { LivingAthleteCardPage } from './living-athlete-card';
import './public-player-showcase.css';
import './showcase-desktop-density.css';

export interface PublicPlayerShowcasePageProps {
  params: { inviteToken?: string };
}

export function PublicPlayerShowcasePage({ params }: PublicPlayerShowcasePageProps) {
  const inviteToken = params.inviteToken ?? '';
  const { isSignedIn, user } = useUser();
  const ownerInvitesQuery = useListAthleteInvites({
    query: {
      enabled: Boolean(isSignedIn),
      queryKey: [...getListAthleteInvitesQueryKey(), isSignedIn ? user?.id ?? null : null],
      retry: false,
    },
  });
  const isOwner = Boolean(
    isSignedIn && ownerInvitesQuery.data?.some((ownedInvite) => ownedInvite.inviteToken === inviteToken),
  );
  const { data: invite, isLoading, isError, refetch } = useGetAthleteFanCard(inviteToken, {
    query: {
      enabled: !!inviteToken,
      queryKey: getGetAthleteFanCardQueryKey(inviteToken),
      retry: false,
      refetchOnWindowFocus: true,
    },
  });
  if (isLoading) {
    return (
      <main className="public-showcase public-showcase--state" aria-busy="true" role="status" data-testid="status-public-showcase-loading">
        <div className="public-showcase__state-panel">
          <span className="public-showcase__state-mark" aria-hidden="true">PS</span>
          <p className="public-showcase__eyebrow">Pixl Sports · Athlete showcase</p>
          <div className="public-showcase__skeleton public-showcase__skeleton--title" />
          <div className="public-showcase__skeleton public-showcase__skeleton--line" />
          <div className="public-showcase__skeleton public-showcase__skeleton--stage" />
          <span className="public-showcase__loading-copy">Getting the showcase ready</span>
        </div>
      </main>
    );
  }

  if (isError || !invite) {
    return (
      <main
        className="public-showcase public-showcase--state"
        role="alert"
        aria-labelledby="public-showcase-unavailable-title"
        aria-describedby="public-showcase-unavailable-context"
        data-testid="status-public-showcase-unavailable"
      >
        <section className="public-showcase__state-panel public-showcase__state-panel--error">
          <span className="public-showcase__state-mark" aria-hidden="true">PS</span>
          <p className="public-showcase__eyebrow">A private-by-default share</p>
          <h1 id="public-showcase-unavailable-title">This showcase isn’t available.</h1>
          <p id="public-showcase-unavailable-context">The link may have expired, or the athlete’s family may have paused sharing. Check with the person who sent it.</p>
          {inviteToken && <button className="public-showcase__retry" type="button" aria-label="Try again to load this showcase" onClick={() => void refetch()} data-testid="button-public-showcase-retry">Try again <ArrowUpRight size={16} aria-hidden="true" /></button>}
        </section>
      </main>
    );
  }

  const appearance = normalizeCardAppearance(invite.cardAppearance);

  return (
    <main className="public-showcase public-showcase--card public-showcase--card-only" data-testid="page-public-player-showcase">
      <header className="public-showcase__topbar">
        <div className="public-showcase__brand" aria-label="Pixl Sports">
          <span className="public-showcase__brand-icon" aria-hidden="true">P</span>
          <span>PIXL <b>SPORTS</b></span>
        </div>
        <span className="public-showcase__safe-label"><ShieldCheck size={15} aria-hidden="true" /> Shared by family</span>
      </header>
      {isOwner && (
        <nav className="public-showcase__owner-nav" aria-label="Owner navigation">
          <BackNavigationLink
            href="/studio/player-showcase"
            label="Back to my Player Showcase"
            testId="link-owner-back-to-showcase"
            variant="public"
          />
        </nav>
      )}

      <section className="public-showcase__hero" aria-labelledby="public-showcase-title">
        <div className="public-showcase__hero-copy">
          <p className="public-showcase__eyebrow"><span /> Pixl Sports / Player Showcase</p>
          <h1 id="public-showcase-title" data-testid="text-public-showcase-name">{invite.athleteName}<i>.</i></h1>
          <p className="public-showcase__intro">HYPE Card.</p>
          <div className="public-showcase__identity">
            <span>{invite.teamName || 'Team'}</span>
            <span aria-hidden="true">/</span>
            <span>{invite.seasonName || 'Current season'}</span>
          </div>
          <span className="public-showcase__read-only"><ShieldCheck size={14} aria-hidden="true" /> Public view · read only</span>
        </div>

        <div className="public-showcase__visual public-showcase__visual--card" role="group" aria-label={`${invite.athleteName} HYPE Card`} style={{ ['--showcase-accent' as string]: appearance.accentColor }}>
          <div className="public-showcase__card-slide public-showcase__card-slide--interactive" data-testid="figure-public-showcase-hype-card">
            <div className="public-showcase__card-interactive" data-testid="public-showcase-interactive-hype-card">
              <LivingAthleteCardPage params={{ inviteToken }} embedded />
            </div>
          </div>
        </div>
      </section>
      <footer className="public-showcase__footer">
        <span>PIXL SPORTS <i>·</i> ATHLETE FIRST</span>
        <span>Made to celebrate the work.</span>
      </footer>
    </main>
  );
}

export default PublicPlayerShowcasePage;
