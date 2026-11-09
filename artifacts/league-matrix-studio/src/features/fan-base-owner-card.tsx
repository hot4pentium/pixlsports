import { useUser } from '@clerk/react';
import { Link } from 'wouter';
import {
  getGetAthleteInviteFanBaseQueryKey,
  useGetAthleteInviteFanBase,
} from '@workspace/api-client-react';

export function FanBaseEntry({ inviteToken }: { inviteToken?: string }) {
  if (!inviteToken) return null;
  return (
    <Link
      href={`/studio/fan-base?card=${encodeURIComponent(inviteToken)}`}
      className="fan-base-entry"
      data-testid="link-dashboard-fan-base"
      aria-label="Fan Base, view all details"
    >
      Fan Base
    </Link>
  );
}

export function FanBaseOwnerCard({ inviteToken, showAccessError = false }: { inviteToken?: string; showAccessError?: boolean }) {
  const { user, isLoaded } = useUser();
  const query = useGetAthleteInviteFanBase(inviteToken ?? '', {
    query: {
      queryKey: [...getGetAthleteInviteFanBaseQueryKey(inviteToken ?? ''), user?.id],
      enabled: Boolean(isLoaded && user?.id && inviteToken),
      retry: false,
      staleTime: 30_000,
    },
  });
  const fanBase = query.data;
  const error = query.error as { status?: number; response?: { status?: number } } | null;
  const status = error?.status ?? error?.response?.status;
  if (!isLoaded || !user?.id || !inviteToken) return null;
  if (status && [401, 403, 404, 423].includes(status)) {
    return showAccessError ? <p role="status">Fan Base is not available for this card. Return to Supporter Hub to choose your current card.</p> : null;
  }
  if (!fanBase || query.isError) {
    return (
      <section className="supporter-game-on-summary__fan-base" aria-label="Fan Base" data-testid="fan-base-owner">
        <h3>Fan Base</h3>
        <p className="supporter-game-on-summary__fan-base-note" role="status">
          {query.isError ? 'Fan Base couldn’t load right now.' : 'Loading Fan Base…'}
        </p>
        {query.isError && (
          <button type="button" onClick={() => void query.refetch()} className="min-h-11 text-xs underline">Try again</button>
        )}
      </section>
    );
  }

  return (
    <section className="supporter-game-on-summary__fan-base" aria-label="Fan Base" data-testid="fan-base-owner">
      <header className="supporter-game-on-summary__fan-base-heading">
        <div>
          <span>FAN BASE</span>
          <h3>{fanBase.totalFollows} {fanBase.totalFollows === 1 ? 'follow' : 'follows'}</h3>
        </div>
        <span aria-label={`${fanBase.anonymousFollows} followers without a name`}>
          {fanBase.anonymousFollows} anonymous
        </span>
      </header>
      {fanBase.namedFans.length > 0 ? (
        <ul className="supporter-game-on-summary__fan-base-names" aria-label="Fans who shared their names">
          {fanBase.namedFans.map((name, index) => (
            <li key={`${name}-${index}`}>{name}</li>
          ))}
        </ul>
      ) : (
        <p className="supporter-game-on-summary__fan-base-empty">
          {fanBase.totalFollows === 0 ? 'Fans will appear here when they follow your HYPE Card.' : 'No one has shared a name yet.'}
        </p>
      )}
      <p className="supporter-game-on-summary__fan-base-note">
        Follows are from devices; names are self-entered.
      </p>
    </section>
  );
}
