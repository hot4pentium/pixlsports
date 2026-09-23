import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Route, Router, Switch, useLocation } from 'wouter';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AccountLifecycleGate, ClerkQueryClientCacheInvalidator, SupporterProfilePage, queryClient } from '@/App';
import { currentAccountId, switchAccount } from './account-lifecycle-browser-auth';
import '../index.css';

declare global {
  interface Window {
    __switchLifecycleAccount: (id: string) => void;
    __navigateLifecycle: (path: string) => void;
  }
}

const apiOrigin = new URLSearchParams(location.search).get('api');
if (!apiOrigin) throw new Error('The lifecycle browser test needs its API server');
history.replaceState({}, '', '/studio/profile');
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith('/api/')) return originalFetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set('x-test-user', currentAccountId());
  return originalFetch(`${apiOrigin}${url}`, { ...init, headers });
};
window.__switchLifecycleAccount = switchAccount;
queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });

function NavigationHook() {
  const [, navigate] = useLocation();
  window.__navigateLifecycle = navigate;
  return null;
}

createRoot(document.getElementById('root')!).render(
  <Router>
    <QueryClientProvider client={queryClient}>
      <ClerkQueryClientCacheInvalidator />
      <NavigationHook />
      <TooltipProvider>
        <AccountLifecycleGate>
          <Switch>
            <Route path="/studio/profile" component={SupporterProfilePage} />
            <Route path="/studio"><main data-testid="studio-restored">Studio access restored</main></Route>
          </Switch>
        </AccountLifecycleGate>
      </TooltipProvider>
    </QueryClientProvider>
  </Router>,
);