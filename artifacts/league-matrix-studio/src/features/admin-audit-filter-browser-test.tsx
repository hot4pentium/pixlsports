import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';

import { AdminConsolePage } from './admin-console';
import '../index.css';

const apiOrigin = new URLSearchParams(location.search).get('api');
if (!apiOrigin) throw new Error('The admin audit browser test needs its fixture API');

const viewer = new URLSearchParams(location.search).get('viewer') || 'member';
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith('/api/')) return originalFetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set('x-test-viewer', viewer);
  return originalFetch(`${apiOrigin}${url}`, { ...init, headers });
};

history.replaceState({}, '', '/studio/admin');
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

createRoot(document.getElementById('root')!).render(
  <Router>
    <QueryClientProvider client={queryClient}>
      <AdminConsolePage />
    </QueryClientProvider>
  </Router>,
);