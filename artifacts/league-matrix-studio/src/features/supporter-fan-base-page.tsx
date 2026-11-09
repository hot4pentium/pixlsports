import { useState } from 'react';
import { useListAthleteInvites, getListAthleteInvitesQueryKey } from '@workspace/api-client-react';
import { BackNavigationLink } from '@/components/back-navigation-link';
import { FanBaseOwnerCard } from './fan-base-owner-card';
import { getShowcaseInviteCandidates } from './player-showcase-model';
import { resolveFanBaseInvite } from './fan-base-owner-model';
import type { SupporterProfile } from './supporter-dashboard';
import './supporter-game-on-summary.css';
import './supporter-fan-base-page.css';

export function SupporterFanBasePage({ profile, userId }: { profile: SupporterProfile; userId: string }) {
  const [selectedToken, setSelectedToken] = useState(() => new URLSearchParams(window.location.search).get('card') ?? '');
  const invites = useListAthleteInvites({
    query: {
      enabled: Boolean(userId),
      queryKey: [...getListAthleteInvitesQueryKey(), userId],
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      retry: false,
    },
  });
  const candidates = getShowcaseInviteCandidates(invites.data ?? [], profile);
  const selected = resolveFanBaseInvite(invites.data ?? [], profile, selectedToken);

  return (
    <main className="fan-base-page" data-testid="page-supporter-fan-base">
      <div className="fan-base-page__content">
        <BackNavigationLink href="/studio" label="Back to Supporter Hub" testId="link-fan-base-back" />
        <p className="fan-base-page__eyebrow">Your athlete’s supporters</p>
        <h1>Fan Base</h1>
        <section className="fan-base-page__panel" aria-label="Fan Base details">
          {invites.isLoading ? <p role="status">Loading Fan Base…</p>
            : invites.isError ? (
              <div role="alert">
                <p>Fan Base couldn’t load right now.</p>
                <button type="button" onClick={() => void invites.refetch()}>Try again</button>
              </div>
            ) : !selected ? (
              <>
                {selectedToken ? <p>This HYPE Card is no longer available in this account. Return to Supporter Hub to open your current Fan Base.</p> : candidates.length > 1 ? (
                  <label>
                    Choose a HYPE Card
                    <select value="" onChange={event => setSelectedToken(event.target.value)}>
                      <option value="" disabled>Choose a card</option>
                      {candidates.map(card => <option key={card.inviteToken} value={card.inviteToken}>{card.athleteName} · {card.teamName} · {card.seasonName || card.sport}</option>)}
                    </select>
                  </label>
                ) : <p>Set up your athlete’s HYPE Card in Player Showcase to start building a Fan Base.</p>}
              </>
            ) : (
              <>
                <h2>{selected.athleteName}</h2>
                <FanBaseOwnerCard key={`${userId}:${selected.inviteToken}`} inviteToken={selected.inviteToken} showAccessError />
              </>
            )}
        </section>
      </div>
    </main>
  );
}
