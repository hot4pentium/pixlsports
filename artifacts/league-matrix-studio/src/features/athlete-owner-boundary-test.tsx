import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AthleteInviteManager, OwnerAthleteInviteManagePage, PublicAthleteInvitePage } from './athlete-invite';
import { LivingAthleteCardPage } from './living-athlete-card';
import '../index.css';

const query = new URLSearchParams(location.search);
const params = { inviteToken: 'owner-boundary-test-token' };
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {query.get('view') === 'create'
      ? <AthleteInviteManager />
      : query.get('view') === 'manage'
      ? <OwnerAthleteInviteManagePage params={params} />
      : query.get('view') === 'fan'
        ? <LivingAthleteCardPage params={params} />
        : <PublicAthleteInvitePage params={params} />}
  </QueryClientProvider>,
);