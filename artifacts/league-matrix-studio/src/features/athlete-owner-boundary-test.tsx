import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerAthleteInviteManagePage, PublicAthleteInvitePage } from './athlete-invite';
import '../index.css';

const query = new URLSearchParams(location.search);
const params = { inviteToken: 'owner-boundary-test-token' };
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {query.get('view') === 'manage'
      ? <OwnerAthleteInviteManagePage params={params} />
      : <PublicAthleteInvitePage params={params} />}
  </QueryClientProvider>,
);