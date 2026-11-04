import {
  getGetAthleteInviteFanBaseQueryKey,
  useGetAthleteInviteFanBase,
} from '@workspace/api-client-react';

export function FanBaseOwnerCard({ inviteToken }: { inviteToken?: string }) {
  const query = useGetAthleteInviteFanBase(inviteToken ?? '', {
    query: {
      queryKey: getGetAthleteInviteFanBaseQueryKey(inviteToken ?? ''),
      enabled: Boolean(inviteToken),
      retry: false,
      staleTime: 30_000,
    },
  });
  const fanBase = query.data;
  if (!inviteToken || !fanBase || query.isError) return null;

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
        <p className="supporter-game-on-summary__fan-base-empty">No one has shared a name yet.</p>
      )}
      <p className="supporter-game-on-summary__fan-base-note">
        Follows are from devices; names are self-entered.
      </p>
    </section>
  );
}
