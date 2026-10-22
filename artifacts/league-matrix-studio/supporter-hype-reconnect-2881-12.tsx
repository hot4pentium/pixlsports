
import { createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, useLocation } from 'wouter';
import { ClerkProvider } from '@clerk/react';
import { ChecklistPage, ScheduleEditor } from './src/App';
import { MeetingCapture } from './src/features/meeting-capture';
import { NotificationSettings } from './src/features/notification-settings';
import { SupporterDashboardView, SupporterProfileView } from './src/features/supporter-dashboard';
import { useCachedSupporterPhoto } from './src/features/supporter-photo-cache';
import { LiveTrackerGame, StatTrackerPage } from './src/features/stat-tracker-page';
import { getSportRule } from './src/features/stat-tracker';
import { buildBrandedPremiumHypeCardArtwork } from './src/features/premium-hype-card-brand';
import { preparePremiumCardPngExport } from './src/features/premium-hype-card-artwork';
import { defaultCardAppearance } from './src/features/hype-card-appearance';
import './src/index.css';

const testHypeCardPhotoUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iODAiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iODAiIGZpbGw9IiNGOTczMTYiLz48L3N2Zz4=';

window.__premiumNameExport = (design, layer = 'all') => {
  const appearance = { ...defaultCardAppearance(design), athleteScale: 1.45, athleteX: .25, athleteY: -.18 };
  return preparePremiumCardPngExport(buildBrandedPremiumHypeCardArtwork({
    athleteName: 'Alexandria Montgomery-Williams', teamName: 'The Northside Comets Select Travel Club',
    appearance, cutoutUrl: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="770" height="1020"><rect width="770" height="1020" fill="red"/></svg>'),
  }, layer, 'name-export'), appearance, { width: 770, height: 1020 });
};

const profile = {
  displayName: 'Jamie Fan',
  teamName: 'The Northside Comets Select Travel Club',
  athleteName: 'Alexandria Montgomery-Williams',
  jerseyNumber: '24',
  position: 'Guard',
  relationship: 'Parent',
  accessMode: 'full',
  sport: 'basketball',
};

let dashboardEvents = [{
  id: 'game-1',
  type: 'game',
  date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  time: '18:30',
  location: 'Northside Gym',
  opponent: 'Rivals',
}];

const navigate = (path) => {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

function ProfilePropagationHarness() {
  const profileStorageKey = 'pixlsports-supporter-profile';
  const defaultProfile = {
    displayName: 'Jamie Fan',
    teamName: 'Northside Comets',
    athleteName: '',
    jerseyNumber: '',
    position: '',
    relationship: 'Parent',
    accessMode: 'full',
    sport: 'basketball',
  };
  const [route, setRoute] = useState(() => (
    new URLSearchParams(window.location.search).get('route') === 'dashboard' ? 'dashboard' : 'profile'
  ));
  const [profile, setProfile] = useState(() => {
    try {
      const stored = window.localStorage.getItem(profileStorageKey);
      return stored ? { ...defaultProfile, ...JSON.parse(stored) } : defaultProfile;
    } catch {
      return defaultProfile;
    }
  });
  const [draft, setDraft] = useState(profile);
  const rule = getSportRule('basketball');
  const currentGame = {
    id: 'live-game',
    sport: 'basketball',
    date: '2026-09-20',
    opponent: 'Rivals',
    opponentScore: 2,
    score: 0,
    stats: Object.fromEntries(rule.stats.map((stat) => [stat.id, 0])),
    events: [],
    status: 'live',
  };

  const openProfile = () => {
    setDraft(profile);
    setRoute('profile');
  };
  const fanToolNav = createElement('nav', { 'data-testid': 'fan-tool-nav', className: 'flex gap-3 p-4' },
    createElement('button', { type: 'button', 'data-testid': 'button-test-open-dashboard', onClick: () => setRoute('dashboard') }, 'Dashboard'),
    createElement('button', { type: 'button', 'data-testid': 'button-test-open-stat-tracker', onClick: () => setRoute('tracker') }, 'Stat Tracker'),
    createElement('button', { type: 'button', 'data-testid': 'button-test-open-athlete-fan-card', onClick: () => setRoute('fan-card') }, 'HYPE Card'),
    createElement('button', { type: 'button', 'data-testid': 'button-test-edit-profile', onClick: openProfile }, 'Profile'),
  );

  if (route === 'profile') {
    return createElement('main', null,
      createElement(SupporterProfileView, {
        profile: draft,
        userId: 'browser-test-profile-user',
        saving: false,
        error: '',
        onChange: (field, value) => setDraft((current) => ({ ...current, [field]: value })),
        onSave: () => {
          setProfile(draft);
          window.localStorage.setItem(profileStorageKey, JSON.stringify(draft));
          const search = new URLSearchParams(window.location.search);
          search.set('route', 'dashboard');
          window.history.replaceState({}, '', window.location.pathname + '?' + search.toString());
          setRoute('dashboard');
        },
        onCancel: () => {
          const search = new URLSearchParams(window.location.search);
          search.set('route', 'dashboard');
          window.history.replaceState({}, '', window.location.pathname + '?' + search.toString());
          setRoute('dashboard');
        },
        initialSection: 'athlete',
      }),
    );
  }

  if (route === 'tracker') {
    return createElement('main', null,
      fanToolNav,
      createElement(LiveTrackerGame, {
        currentGame,
        rule,
        athleteName: profile.athleteName,
        athleteImageUrl: testHypeCardPhotoUrl,
        teamName: profile.teamName,
        displayStats: rule.stats.slice(0, 6),
        showAllStats: false,
        saving: false,
        captureNotice: '',
        onCapture: () => {},
        onGameChange: () => {},
        onToggleShowAllStats: () => {},
        onLeaveGame: () => setRoute('dashboard'),
        onEndGame: () => {},
      }),
    );
  }

  if (route === 'fan-card') {
    return createElement('main', null,
      fanToolNav,
      createElement('a', { 'data-testid': 'link-athlete-fan-card-manager', href: '/studio/athlete-page' }, 'Manage HYPE Card'),
    );
  }

  return createElement('main', null,
    fanToolNav,
    createElement(SupporterDashboardView, {
      profile,
      events: [],
      nextGameIsUpcoming: false,
      scheduleSource: null,
      connectionLabel: '',
      onOpenStatTracker: () => setRoute('tracker'),
      onOpenChecklist: () => {},
    }),
  );
}

function CachedPhotoStartupHarness() {
  const photo = useCachedSupporterPhoto('user-startup', true);
  return createElement('div', null,
    createElement('output', { 'data-testid': 'cached-photo-url' }, photo.imageUrl || 'none'),
    createElement(SupporterDashboardView, {
      profile,
      userId: 'user-startup',
      events: [],
      nextGameIsUpcoming: false,
      scheduleSource: null,
      connectionLabel: '',
      onOpenStatTracker: () => {},
      onOpenChecklist: () => {},
    }),
  );
}

function ChecklistContextHarness() {
  const [location] = useLocation();
  const [, setRouteVersion] = useState(0);
  useEffect(() => {
    const handlePopState = () => setRouteVersion((version) => version + 1);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  const scenario = new URLSearchParams(window.location.search).get('scenario') || 'practice';
  const scenarioEvents = {
    practice: [{
      id: 'practice-1',
      type: 'practice',
      date: '2026-09-23',
      time: '18:30',
      location: 'Northside Gym',
      notes: 'Bring water',
    }],
    meeting: [{
      id: 'meeting-1',
      type: 'meeting',
      date: '2026-09-24',
      time: '17:00',
      location: 'Northside Clubhouse',
      notes: 'Bring the agenda',
    }],
    game: [{
      id: 'game-1',
      type: 'game',
      date: '2026-09-25',
      time: '18:30',
      location: 'Eastside Gym',
      opponent: 'Rivals',
      status: 'upcoming',
    }],
    mixed: [{
      id: 'game-1',
      type: 'game',
      date: '2026-09-23',
      time: '18:30',
      location: 'Eastside Gym',
      opponent: 'Rivals',
      status: 'upcoming',
    }, {
      id: 'practice-1',
      type: 'practice',
      date: '2026-09-24',
      time: '18:30',
      location: 'Northside Gym',
      notes: 'Bring water',
    }, {
      id: 'meeting-1',
      type: 'meeting',
      date: '2026-09-25',
      time: '17:00',
      location: 'Northside Clubhouse',
      notes: 'Bring the agenda',
    }],
  };
  const events = scenarioEvents[scenario] || scenarioEvents.practice;

  if (location === '/studio/checklist' || new URLSearchParams(window.location.search).get('route') === 'checklist') {
    return createElement('div', { 'data-testid': 'checklist-context-harness' }, createElement(ChecklistPage));
  }

  return createElement('div', { 'data-testid': 'checklist-context-harness' },
    createElement(SupporterDashboardView, {
      profile,
      events,
      nextGameIsUpcoming: true,
      scheduleSource: 'custom',
      connectionLabel: 'Northside · 2026',
      onOpenProfile: () => {},
      onOpenStatTracker: () => {},
      onOpenChecklist: () => navigate('/studio/checklist'),
    }),
  );
}

function WorkspaceJourneyHarness() {
  const [location] = useLocation();
  const route = new URLSearchParams(window.location.search).get('route');
  const defaultEvents = [{
    id: 'game-default', type: 'game', status: 'upcoming',
    date: '2026-10-12', time: '18:30', location: 'Main Gym', opponent: 'Falcons',
  }, {
    id: 'game-selected', type: 'game', status: 'upcoming',
    date: '2026-10-13', time: '19:00', location: 'Away Gym', opponent: 'Tigers',
  }];
  const savedDraft = JSON.parse(window.localStorage.getItem('leaguematrix-schedule-draft') || 'null');
  const events = Array.isArray(savedDraft?.events) ? savedDraft.events : defaultEvents;
  const tool = location.startsWith('/studio/') ? location : route ? '/studio/' + route : '';
  return createElement('main', { 'data-testid': 'workspace-journey-harness' },
    createElement('button', { type: 'button', 'data-testid': 'journey-return-dashboard', onClick: () => navigate('/') }, 'Dashboard'),
    tool === '/studio/schedule' ? createElement(ScheduleEditor)
      : tool === '/studio/checklist' ? createElement(ChecklistPage)
      : tool === '/studio/stat-tracker' ? createElement(StatTrackerPage)
      : createElement(SupporterDashboardView, {
        profile,
        userId: window.location.search.includes('supporter-active-game-sync') ? 'supporter-sync-user' : undefined,
        prepUserId: 'workspace-journey',
        events,
        nextGameIsUpcoming: true,
        scheduleSource: 'custom',
        connectionLabel: 'Northside · 2026',
        onOpenProfile: () => {},
        onOpenStatTracker: () => navigate('/studio/stat-tracker'),
        onOpenChecklist: () => navigate('/studio/checklist'),
      }),
  );
}

export function mount() {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const requestUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input?.url || String(input || '');
    if (
      window.location.search.includes('game-on-card-save-transition')
      && new URL(requestUrl, window.location.href).pathname === '/api/athlete-invites'
    ) {
      return Promise.resolve(new Response(JSON.stringify([{
        inviteToken: 'browser-test-fan-card',
        athleteName: 'Test Athlete',
        teamName: 'Northside',
        paused: false,
      }]), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (new URL(requestUrl, window.location.href).pathname === '/api/game-on-cards/owned') {
      return Promise.resolve(new Response('[]', {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (new URL(requestUrl, window.location.href).pathname === '/api/athlete-invites') {
      return Promise.resolve(new Response('[]', {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (new URL(requestUrl, window.location.href).pathname === '/api/projects') {
      return Promise.resolve(new Response('[]', {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (
      window.location.search.includes('supporter-active-game-sync')
      && new URL(requestUrl, window.location.href).pathname === '/api/supporter/active-game'
    ) {
      const method = String(init?.method || 'GET').toUpperCase();
      // Shared across tabs like the account endpoint; request history remains per tab.
      const selectionKey = 'supporter-active-game-sync-server-selection';
      const requestsKey = 'supporter-active-game-sync-requests';
      const requests = JSON.parse(window.sessionStorage.getItem(requestsKey) || '[]');
      const body = method === 'PUT' ? JSON.parse(String(init?.body || '{}')) : undefined;
      requests.push({ method, body: body ?? null });
      window.sessionStorage.setItem(requestsKey, JSON.stringify(requests));
      if (method === 'PUT') {
        if (
          Object.keys(body).length !== 1
          || !Object.prototype.hasOwnProperty.call(body, 'gameId')
          || !(typeof body.gameId === 'string' || body.gameId === null)
        ) {
          return Promise.resolve(new Response(JSON.stringify({ error: 'Only a game ID may be saved.' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          }));
        }
        window.localStorage.setItem(selectionKey, JSON.stringify(body.gameId));
        return Promise.resolve(new Response(JSON.stringify({ gameId: body.gameId }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
      const gameId = JSON.parse(window.localStorage.getItem(selectionKey) || 'null');
      return Promise.resolve(new Response(JSON.stringify({ gameId }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (
      window.location.search.includes('supporter-game-record')
      && requestUrl.endsWith('/api/supporter/active-game')
    ) {
      return Promise.resolve(new Response(JSON.stringify({ gameId: null }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (new URL(requestUrl, window.location.href).pathname === '/api/supporter/active-game') {
      return Promise.resolve(new Response(JSON.stringify({ gameId: null }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (window.sessionStorage.getItem('workspace-journey')) {
      const url = new URL(requestUrl, window.location.href);
      if (url.pathname.startsWith('/api/')) {
        const method = (init?.method || 'GET').toUpperCase();
        const requests = JSON.parse(window.sessionStorage.getItem('workspace-journey-requests') || '[]');
        requests.push({ path: url.pathname, method, body: String(init?.body || '') });
        window.sessionStorage.setItem('workspace-journey-requests', JSON.stringify(requests));
        if (method !== 'GET') return Promise.reject(new Error('Unexpected public mutation in workspace journey'));
        const data = url.pathname === '/api/account/access' ? { accessMode: 'full', paid: false }
          : url.pathname.endsWith('/supporter-photo') ? null
          : url.pathname.includes('reply-inbox') ? { groups: [], unreadCount: 0, totalCount: 0 }
          : [];
        return Promise.resolve(new Response(JSON.stringify(data), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        }));
      }
    }
    if (window.location.search.includes('notification-preferences')) {
      if (requestUrl.includes('/api/notifications/subscriptions/status')) {
        const signedOut = window.localStorage.getItem('browser-test-notification-user') === 'signed-out';
        return Promise.resolve(new Response(JSON.stringify({
          owned: !signedOut,
          ownedByAnotherAccount: false,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (requestUrl.endsWith('/api/notifications/subscriptions')) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (requestUrl.endsWith('/api/notifications/config')) {
        return Promise.resolve(new Response(JSON.stringify({
          available: true,
          publicKey: 'BROWSER_TEST_PUBLIC_KEY',
          scheduledDeliveryEnabled: window.localStorage.getItem('browser-test-scheduled-delivery-enabled') === 'true',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      if (requestUrl.endsWith('/api/notifications/preferences')) {
        const preferencesStorageKey = 'browser-test-notification-preferences';
        const requestLogStorageKey = 'browser-test-notification-preference-requests';
        const method = String(init?.method || 'GET').toUpperCase();
        if (method === 'PATCH') {
          const body = JSON.parse(String(init?.body || '{}'));
          const requests = JSON.parse(window.localStorage.getItem(requestLogStorageKey) || '[]');
          requests.push({ method, url: new URL(requestUrl, window.location.href).pathname, body });
          window.localStorage.setItem(requestLogStorageKey, JSON.stringify(requests));
          window.localStorage.setItem(preferencesStorageKey, JSON.stringify(body));
          return Promise.resolve(new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
        const preferences = JSON.parse(window.localStorage.getItem(preferencesStorageKey) || '{"oneHourBefore":true,"dayOf":false,"timezone":"UTC"}');
        return Promise.resolve(new Response(JSON.stringify(preferences), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
    }
    if (requestUrl.includes('/api/hype-card-shares/reply-inbox')) {
      return Promise.resolve(new Response(JSON.stringify({ groups: [], unreadCount: 0, totalCount: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    if (requestUrl.endsWith('/api/supporter-photo')) {
      return new Promise((resolve) => {
        window.setTimeout(() => {
          window.__pixlSupporterPhotoMetadataResolved = true;
          window.__pixlSupporterPhotoMetadataResolvedAt = performance.now();
          resolve(new Response(JSON.stringify({
            url: '/api/supporter-photo/image',
            contentType: 'image/png',
            size: 68,
            cropX: 50,
            cropY: 50,
            cropZoom: 100,
            updatedAt: '2026-09-23T12:00:00.000Z',
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }, 1_500);
      });
    }
    return originalFetch(input, init);
  };
  let notificationUserId = null;
  if (window.location.search.includes('notification-preferences')) {
    const storedNotificationUser = window.localStorage.getItem('browser-test-notification-user');
    notificationUserId = storedNotificationUser === 'signed-out'
      ? null
      : storedNotificationUser || 'browser-test-notification-owner';
    const testSubscription = {
      endpoint: 'https://fcm.googleapis.com/wp/browser-test-notification-endpoint',
      toJSON: () => ({
        endpoint: 'https://fcm.googleapis.com/wp/browser-test-notification-endpoint',
        keys: { p256dh: 'BROWSER_TEST_P256DH', auth: 'BROWSER_TEST_AUTH' },
      }),
      unsubscribe: async () => true,
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => testSubscription },
        }),
      },
    });
    Object.defineProperty(window, 'PushManager', { configurable: true, value: function PushManager() {} });
    Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => 'denied' } });
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.__setReplyInboxUnreadCount = (unreadCount) => {
    const query = queryClient.getQueryCache().findAll().find(({ queryKey }) =>
      queryKey.some((part) => String(part).includes('/api/hype-card-shares/reply-inbox')));
    if (!query) return false;
    queryClient.setQueryData(query.queryKey, { groups: [], unreadCount, totalCount: unreadCount });
    return true;
  };
  const root = createRoot(document.getElementById('test-root'));
  if (window.location.search.includes('supporter-active-game-sync')) {
    dashboardEvents = [{
      id: 'game-default',
      type: 'game',
      date: '2026-10-12',
      time: '18:30',
      location: 'Main Gym',
      opponent: 'Falcons',
      status: 'upcoming',
    }, {
      id: 'game-selected',
      type: 'game',
      date: '2026-10-13',
      time: '19:00',
      location: 'Away Gym',
      opponent: 'Tigers',
      status: 'upcoming',
      notes: 'PRIVATE CHECKLIST NOTES',
      checklistItems: ['PRIVATE CHECKLIST ITEM'],
    }];
    if (!window.localStorage.getItem('supporter-active-game-sync-server-selection')) {
      window.localStorage.setItem('supporter-active-game-sync-server-selection', 'null');
    }
  }
  if (window.location.search.includes('workspace-journey')) {
    window.sessionStorage.setItem('workspace-journey', 'true');
    root.render(createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(WorkspaceJourneyHarness),
      ),
    ));
    return;
  }
  if (window.location.search.includes('profile-propagation')) {
    root.render(createElement(ClerkProvider, {
      publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    },
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(ProfilePropagationHarness),
      ),
    )));
    return;
  }
  if (window.location.search.includes('cached-photo-startup')) {
    window.localStorage.setItem('pixlsports-supporter-photo:user-startup', JSON.stringify({
      url: '/api/supporter-photo/image',
      contentType: 'image/png',
      size: 68,
      cropX: 50,
      cropY: 50,
      cropZoom: 100,
      updatedAt: '2026-09-23T12:00:00.000Z',
    }));
    window.__pixlSupporterPhotoMetadataResolved = false;
    root.render(createElement(ClerkProvider, {
      publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    },
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(CachedPhotoStartupHarness),
      ),
    )));
    return;
  }
  if (window.location.search.includes('meeting-capture')) {
    root.render(createElement(ClerkProvider, {
      publishableKey: 'pk_test_ZXhhbXBsZS5jb20k',
    },
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(MeetingCapture),
      ),
    )));
    return;
  }
  if (window.location.search.includes('checklist-context')) {
    root.render(
      createElement(ClerkProvider, {
        publishableKey: 'pk_test_ZXhhbXBsZS5jb20k',
      },
      createElement(Router, null,
        createElement(QueryClientProvider, { client: queryClient },
          createElement(ChecklistContextHarness),
        ),
      )),
    );
    return;
  }
  if (window.location.search.includes('notification-preferences')) {
    root.render(createElement(QueryClientProvider, { client: queryClient },
      createElement(NotificationSettings, { userId: notificationUserId }),
    ));
    return;
  }
  const dashboardChecklistScenario = new URLSearchParams(window.location.search).get('dashboard-checklist');
  const dashboardChecklistAllItemIds = ['profile', 'shoutouts', 'hype-card', 'event-card', 'install-app'];
  const dashboardChecklistStorageKey = dashboardChecklistScenario === 'complete'
    ? 'supporter-dashboard-checklist-complete'
    : null;
  const savedDashboardChecklist = dashboardChecklistStorageKey
    ? JSON.parse(window.localStorage.getItem(dashboardChecklistStorageKey) || 'null')
    : null;
  let dashboardChecklistItemIds = Array.isArray(savedDashboardChecklist?.checkedItemIds)
    ? savedDashboardChecklist.checkedItemIds
    : dashboardChecklistScenario === 'failure'
      ? dashboardChecklistAllItemIds.slice(0, 4)
      : [];
  let dashboardChecklistDismissed = Boolean(savedDashboardChecklist?.dismissed);
  window.__dashboardChecklistSaves = [];
  window.__dashboardChecklistDismissals = [];
  let dashboardUserId = dashboardChecklistScenario
    ? 'supporter-checklist-' + dashboardChecklistScenario
    : window.location.search.includes('supporter-game-record')
    ? 'supporter-game-record-user'
    : window.location.search.includes('supporter-active-game-sync')
      ? 'supporter-sync-user'
      : undefined;
  if (window.location.search.includes('mobile-hype-pair')) {
    dashboardUserId = 'hype-owner';
    window.__hypePreviewState = JSON.parse(localStorage.getItem('hype-preview-fixture') || '"loading"');
    window.__hypeRequests = 0;
    window.__hypeReconnectCalls = 0;
    window.__hypeReconnectBody = null;
    window.__hypeReconnectPath = '';
    window.__hypeReconnected = false;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = input instanceof Request ? input.url : String(input);
      const pathname = new URL(requestUrl, location.href).pathname;
      if (pathname.startsWith('/api/athlete-invites/')) {
        window.__hypeReconnectCalls++;
        window.__hypeReconnectPath = pathname;
        window.__hypeReconnectBody = JSON.parse(String(init?.body || '{}'));
        window.__hypeReconnected = true;
        return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (pathname !== '/api/athlete-invites') return originalFetch(input, init);
      window.__hypeRequests++;
      const user = dashboardUserId;
      const initial = window.__hypePreviewState;
      if (initial === 'loading') await new Promise(resolve => {
        if (location.search.includes('webkit-loading')) window.__releaseHypeLoading = resolve;
        else setTimeout(resolve, 600);
      });
      const state = initial === 'loading' ? 'velocity' : initial;
      const headers = { 'Content-Type': 'application/json' };
      if (state === 'error') return new Response('{"error":"Unavailable"}', { status: 503, headers });
      const photo = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><circle cx="200" cy="170" r="90" fill="#eaa44a"/><path d="M60 580V350Q200 230 340 350V580" fill="#eaa44a"/></svg>');
      return new Response(JSON.stringify(state === 'empty' || user !== 'hype-owner' ? [] : [{
        inviteToken: 'saved-athlete-token',
        athleteName: state === 'mismatch' && !window.__hypeReconnected ? 'Another athlete' : profile.athleteName,
        teamName: state === 'mismatch' && !window.__hypeReconnected ? 'Previous Comets' : profile.teamName,
        seasonName: '2026', seasonEndsAt: '2030-01-01',
        sport: profile.sport, timezone: 'America/New_York', trackerProjectId: null, scheduleProjectId: null,
        showHypeCard: state !== 'hidden', showStats: true, showSchedule: true, showEvents: true,
        hypesEnabled: true, paused: state === 'paused', liveTrackerShareToken: null,
        photoUrl: photo, cutoutUrl: photo, photoRevision: 'portrait',
        cardAppearance: { design: ['velocity','wave','glass','varsity','spotlight','pixel-edge'].includes(state) ? state : 'velocity',
          lowerThirdTemplate: 'velocity',
          jerseyNumber: '24', position: 'Guard', borderColor: '#eecc77', accentColor: '#00aadd',
          accentLinked: true, removeBackground: true, athleteX: .02,
          athleteY: location.search.includes('webkit-loading') ? -.18 : -.08,
          athleteScale: location.search.includes('webkit-loading') ? 1.45 : 1.2,
          namePlateX: .02, namePlateY: .03 },
        events: [], createdAt: '2026-01-01', updatedAt: new Date().toISOString()
      }]), { status: 200, headers });
    };
    window.__setHypePreviewState = async (state) => {
      window.__hypePreviewState = state;
      localStorage.setItem('hype-preview-fixture', JSON.stringify(state));
      await queryClient.invalidateQueries({ queryKey: ['/api/athlete-invites'] });
    };
  }
  if (window.location.search.includes('game-on-card-save-transition')) {
    dashboardUserId = 'supporter-save-transition';
    window.__gameOnCardMockSaveRequests = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const requestUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (typeof requestUrl === 'string') {
        const pathname = new URL(requestUrl, window.location.href).pathname;
        if (pathname.endsWith('/api/game-on-cards/owned')) {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname === '/api/projects') {
          return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (pathname.endsWith('/api/hype-card-shares/reply-inbox')) {
          return new Response(JSON.stringify({ groups: [], unreadCount: 0, totalCount: 0 }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (pathname.endsWith('/api/schedule-shares') && method === 'POST') {
          window.__gameOnCardMockSaveRequests += 1;
          return new Response(JSON.stringify({ shareToken: 'mock-game-on-card-token' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      return originalFetch(input, init);
    };
  }
  const saveDashboardChecklistProgress = async (checkedItemIds) => {
    if (dashboardChecklistScenario === 'failure') throw new Error('Checklist progress could not be saved');
    dashboardChecklistItemIds = [...checkedItemIds];
    if (dashboardChecklistStorageKey) {
      window.localStorage.setItem(dashboardChecklistStorageKey, JSON.stringify({
        checkedItemIds: dashboardChecklistItemIds,
        dismissed: dashboardChecklistDismissed,
      }));
    }
    window.__dashboardChecklistSaves = [...window.__dashboardChecklistSaves, [...checkedItemIds]];
    renderDashboard();
  };
  const dismissDashboardChecklist = async (checkedItemIds) => {
    if (dashboardChecklistScenario === 'failure') throw new Error('Checklist dismissal could not be saved');
    dashboardChecklistItemIds = [...checkedItemIds];
    dashboardChecklistDismissed = true;
    if (dashboardChecklistStorageKey) {
      window.localStorage.setItem(dashboardChecklistStorageKey, JSON.stringify({
        checkedItemIds: dashboardChecklistItemIds,
        dismissed: dashboardChecklistDismissed,
      }));
    }
    window.__dashboardChecklistDismissals = [...window.__dashboardChecklistDismissals, [...checkedItemIds]];
    renderDashboard();
  };
  const renderDashboard = () => root.render(
    createElement(ClerkProvider, {
      publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
    },
    createElement(Router, null,
      createElement(QueryClientProvider, { client: queryClient },
        createElement(SupporterDashboardView, {
          profile,
          userId: dashboardUserId,
          showDashboardChecklist: Boolean(
            dashboardChecklistScenario
            && dashboardChecklistScenario !== 'existing'
            && !dashboardChecklistDismissed
            && dashboardChecklistItemIds.length < 5,
          ),
          dashboardChecklistCheckedItemIds: dashboardChecklistItemIds,
          onSaveDashboardChecklistProgress: dashboardChecklistScenario ? saveDashboardChecklistProgress : undefined,
          onDismissDashboardChecklist: dashboardChecklistScenario ? dismissDashboardChecklist : undefined,
          events: dashboardEvents,
          nextGameIsUpcoming: true,
          scheduleSource: 'custom',
          connectionLabel: 'Northside · 2026',
          onCompleteScheduledGame: async (eventId, completedAt) => {
            const scheduledGame = dashboardEvents.find((event) => event.id === eventId && event.type === 'game');
            if (!scheduledGame) throw new Error('The scheduled game is no longer available.');
            dashboardEvents = dashboardEvents.map((event) => event.id === eventId
              ? { ...event, status: 'final', completedAt }
              : event);
            renderDashboard();
          },
          onOpenStatTracker: () => navigate('/studio/stat-tracker'),
          onOpenChecklist: () => navigate('/studio/checklist'),
        }),
      ),
    )),
  );
  window.__setSupporterDashboardEvents = (nextEvents) => {
    dashboardEvents = nextEvents;
    renderDashboard();
  };
  window.__applyRemoteDashboardChecklistCompletion = () => {
    dashboardChecklistItemIds = [...dashboardChecklistAllItemIds];
    renderDashboard();
  };
  window.__getSupporterDashboardEvents = () => dashboardEvents;
  window.__navigateSupporterDashboardAwayForFilterTest = (tool) => root.render(
    createElement('main', null,
      createElement('h1', { 'data-testid': 'supporter-dashboard-away-tool' }, tool),
      createElement('button', {
        type: 'button',
        'data-testid': 'button-return-to-supporter-dashboard',
        onClick: renderDashboard,
      }, 'Return to Dashboard'),
    ),
  );
  window.__setSupporterDashboardTrackerUserId = async (userId) => {
    dashboardUserId = userId || undefined;
    renderDashboard();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };
  window.__setSupporterDashboardSport = (sport) => {
    profile.sport = sport;
    renderDashboard();
  };
  renderDashboard();
}
