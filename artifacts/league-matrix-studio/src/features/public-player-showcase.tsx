import { FanCardActions } from './fan-card-follow';
import { LivingAthleteCardPage } from './living-athlete-card';

export interface PublicPlayerShowcasePageProps {
  params: { inviteToken?: string };
}

/**
 * Compatibility route for older /showcase links.
 * New shares use /fan so iOS Universal Links open the same card directly.
 */
export function PublicPlayerShowcasePage({ params }: PublicPlayerShowcasePageProps) {
  const inviteToken = params.inviteToken ?? '';
  return (
    <LivingAthleteCardPage
      params={params}
      followControls={inviteToken ? <FanCardActions inviteToken={inviteToken} /> : undefined}
    />
  );
}

export default PublicPlayerShowcasePage;
