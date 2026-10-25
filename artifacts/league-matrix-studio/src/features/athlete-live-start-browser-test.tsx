import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { getListAthleteInvitesQueryKey } from '@workspace/api-client-react';
import { LivingAthleteCardPage } from './living-athlete-card';
import { EventCardLiveTaps } from './event-card-live-taps';
import { GameOnInlineStatTracker } from './game-on-inline-stat-tracker';
import { StatTrackerPage } from './stat-tracker-page';
import { currentAccountId } from './account-lifecycle-browser-auth';
import { scheduleLegacyDefaultsMigrationKey, scheduleStorageKey } from './schedule-draft';
import type { Sport } from './stat-tracker';
import '../index.css';

const query = new URLSearchParams(window.location.search);
const apiOrigin = query.get('api') ?? '';
const page = query.get('page') ?? 'tracker';
const inviteToken = 'browser-live-athlete';
const trackerPath = '/studio/stat-tracker';
const inlinePath = '/browser/inline-tracker';
const liveTapsPath = '/browser/event-card-live-taps';
const liveTapsSport = (query.get('sport') ?? 'basketball') as Sport;
const fanPath = `/fan/${inviteToken}`;
const path = page === 'fan' ? fanPath : page === 'inline' ? inlinePath : page === 'live-taps' ? liveTapsPath : trackerPath;

if (page === 'tracker') {
  localStorage.removeItem('leaguematrix-stat-tracker-active-game:workspace-journey');
  localStorage.removeItem('leaguematrix-stat-tracker:workspace-journey');
  localStorage.setItem(scheduleStorageKey, JSON.stringify({
    version: 1,
    teamName: 'Northside Comets',
    season: 'Fall 2026',
    template: 0,
    events: [{
      id: 'scheduled-full-game',
      type: 'game',
      status: 'upcoming',
      date: '2026-10-12',
      time: '18:30',
      location: 'Main Gym',
      opponent: 'Comets',
      snacks: '',
      drinks: '',
      notes: '',
    }],
  }));
  localStorage.setItem(scheduleLegacyDefaultsMigrationKey, '1');
} else if (page === 'inline') {
  localStorage.removeItem('leaguematrix-stat-tracker-active-game:workspace-journey');
} else if (page === 'live-taps') {
  localStorage.removeItem('leaguematrix-stat-tracker-active-game:workspace-journey');
  localStorage.removeItem('pixlSports:liveTaps:browser-live-athlete');
}

window.history.replaceState({}, '', `${path}${window.location.search}${window.location.hash}`);

const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const requestUrl = input instanceof Request
    ? input.url
    : input instanceof URL
      ? input.href
      : String(input);
  const url = new URL(requestUrl, window.location.href);
  if (!url.pathname.startsWith('/api/')) return originalFetch(input, init);

  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  const accountId = currentAccountId();
  if (accountId) headers.set('x-test-user', accountId);
  return originalFetch(`${apiOrigin}${url.pathname}${url.search}`, { ...init, headers });
};

function InlineTrackerRoute() {
  return createElement(GameOnInlineStatTracker, {
    userId: currentAccountId(),
    sport: 'basketball',
    athleteName: 'Alexandria Montgomery-Williams',
    teamName: 'Northside Comets',
    eventId: 'scheduled-inline-game',
    date: '2026-10-13',
    time: '19:00',
    location: 'Away Gym',
    opponent: 'Tigers',
  });
}

function LiveTapsOnlyRoute() {
  return createElement(EventCardLiveTaps, {
    userId: currentAccountId(),
    sport: liveTapsSport,
    athleteName: 'Alexandria Montgomery-Williams',
    teamName: 'Northside Comets',
    eventId: `scheduled-live-taps-game-${liveTapsSport}`,
    date: '2026-10-14',
    time: '18:00',
    location: 'Away Gym',
    opponent: 'Tigers',
  });
}

function FanCardRoute({ params }: { params: { inviteToken?: string } }) {
  return createElement(LivingAthleteCardPage, { params });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
Object.assign(window, {
  __refreshLiveTapsInviteList: () => queryClient.invalidateQueries({
    queryKey: [...getListAthleteInvitesQueryKey(), currentAccountId()],
  }),
});
const root = createRoot(document.getElementById('test-root')!);

root.render(createElement(QueryClientProvider, { client: queryClient },
  createElement(Router, null,
    createElement(Route, { path: trackerPath }, createElement(StatTrackerPage)),
    createElement(Route, { path: inlinePath }, createElement(InlineTrackerRoute)),
    createElement(Route, { path: liveTapsPath }, createElement(LiveTapsOnlyRoute)),
    createElement(Route, { path: '/fan/:inviteToken', component: FanCardRoute }),
  ),
));