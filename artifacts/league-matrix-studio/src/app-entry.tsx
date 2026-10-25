import { lazy, Suspense } from 'react';
import { ClerkProvider, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClientProvider } from '@tanstack/react-query';
import { Redirect, Route, Router, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { AccountLoadingScreen } from '@/features/account-loading-screen';
import { getHomeEntryState } from '@/features/auth-entry-routing';
import { PublicLandingPage } from '@/features/landing-home';
import { ClerkQueryClientCacheInvalidator, queryClient } from './app-session';
import { clerkAppearance } from './clerk-appearance';
import './landing-unified.css';

const ApplicationRoutes = lazy(() => import('./App'));
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

function HomeEntry() {
  const { isLoaded, isSignedIn } = useUser();
  return getHomeEntryState(isLoaded, Boolean(isSignedIn)) === 'dashboard'
    ? <Redirect to="/studio" />
    : <PublicLandingPage />;
}

function SessionRoutes() {
  const [location, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={import.meta.env.VITE_CLERK_PROXY_URL}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'WELCOME BACK', subtitle: 'Sign in to continue your athlete’s season' } },
        signUp: { start: { title: 'JOIN PIXL SPORTS', subtitle: 'Create an account to start your athlete’s season' } },
      }}
      routerPush={to => setLocation(stripBase(to))}
      routerReplace={to => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <ErrorBoundary resetKey={location}>
          <Switch>
            <Route path="/" component={HomeEntry} />
            <Route>
              <Suspense fallback={<AccountLoadingScreen />}>
                <ApplicationRoutes />
              </Suspense>
            </Route>
          </Switch>
        </ErrorBoundary>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function AppEntry() {
  return <Router base={basePath}><SessionRoutes /></Router>;
}
