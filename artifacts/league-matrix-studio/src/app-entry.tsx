import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { ClerkProvider, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClientProvider } from '@tanstack/react-query';
import { Redirect, Route, Router, Switch, useLocation } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { AccountLoadingScreen } from '@/features/account-loading-screen';
import { getHomeEntryState } from '@/features/auth-entry-routing';
import { forgetPrivateSession, hasPreviousPrivateSession } from '@/features/previous-private-session';
import { getPrivateEntrySplashRemainingMs } from '@/features/private-entry-splash';
import { PublicLandingPage } from '@/features/landing-home';
import { ClerkQueryClientCacheInvalidator, queryClient } from './app-session';
import { clerkAppearance } from './clerk-appearance';
import './landing-unified.css';

const ApplicationRoutes = lazy(() => import('./App'));
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const PRIVATE_ENTRY_SPLASH_STARTED_AT_ATTRIBUTE = 'data-pixl-private-return-started-at';
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
  const [hasPriorPrivateSession] = useState(hasPreviousPrivateSession);

  const entryState = getHomeEntryState(isLoaded, Boolean(isSignedIn), hasPriorPrivateSession);
  if (entryState === 'dashboard') return <Redirect to="/studio" />;
  if (entryState === 'loading') return null;
  return <PublicLandingPage />;
}

function PrivateEntrySplashGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const [startedAt] = useState(() => document.documentElement.getAttribute(PRIVATE_ENTRY_SPLASH_STARTED_AT_ATTRIBUTE));
  const [minimumElapsed, setMinimumElapsed] = useState(
    () => getPrivateEntrySplashRemainingMs(startedAt, performance.now()) === 0,
  );

  useEffect(() => {
    if (isLoaded && !isSignedIn) forgetPrivateSession();
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (minimumElapsed) return;
    const remaining = getPrivateEntrySplashRemainingMs(startedAt, performance.now());
    const timer = window.setTimeout(() => setMinimumElapsed(true), remaining);
    return () => window.clearTimeout(timer);
  }, [minimumElapsed, startedAt]);

  const isPrivateEntry = startedAt !== null;
  const shouldKeepSplash = isPrivateEntry
    && (!isLoaded || (Boolean(isSignedIn) && !minimumElapsed));

  return (
    <>
      <div
        aria-hidden={shouldKeepSplash || undefined}
        inert={shouldKeepSplash || undefined}
        style={{ visibility: shouldKeepSplash ? 'hidden' : undefined }}
      >
        {children}
      </div>
      {shouldKeepSplash && (
        <div
          className="fixed inset-0 z-[100]"
          data-testid="private-entry-splash-overlay"
        >
          <AccountLoadingScreen />
        </div>
      )}
    </>
  );
}

function EntryModuleLoadingState() {
  return (
    <div
      className="grid place-items-center bg-background"
      style={{ minHeight: '100svh' }}
      role="status"
      aria-label="Loading your studio"
      data-testid="entry-module-loading"
    >
      <span
        className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-[#55a4ff]"
        aria-hidden="true"
      />
      <span className="sr-only">Loading your studio…</span>
    </div>
  );
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
        <PrivateEntrySplashGate>
          <ErrorBoundary resetKey={location}>
            <Switch>
              <Route path="/" component={HomeEntry} />
              <Route>
                <Suspense fallback={<EntryModuleLoadingState />}>
                  <ApplicationRoutes />
                </Suspense>
              </Route>
            </Switch>
          </ErrorBoundary>
        </PrivateEntrySplashGate>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default function AppEntry() {
  return <Router base={basePath}><SessionRoutes /></Router>;
}
