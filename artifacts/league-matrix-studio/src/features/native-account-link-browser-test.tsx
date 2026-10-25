import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NativeAccountLinkSignedIn } from '../pages/NativeAccountLinkPage';
import '../index.css';

const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const fixture = {
  status: 'unlinked', failDecision: false, expire: false,
  requests: [] as { method: string; path: string; body: any; intent: string | null }[],
  refresh: () => client.invalidateQueries(),
};
Object.assign(window, { __nativeLinkFixture: fixture });
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
  if (!path.startsWith('/api/account/native-link')) return originalFetch(input, init);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  const method = init?.method ?? 'GET';
  fixture.requests.push({ path, method, body, intent: new Headers(init?.headers).get('x-pixl-link-intent') });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  if (path.endsWith('/preview')) return json({
    status: 'pending', requestId: 'a2a48bc7-d854-44e6-96a7-e95208b42eea', userCode: body.userCode,
    expiresAt: new Date(Date.now() + (fixture.expire ? -1000 : 600000)).toISOString(),
  });
  if (path.endsWith('/decision')) {
    if (fixture.failDecision) return json({ error: 'Approval could not be saved. Try again.' }, 503);
    fixture.status = body.decision === 'approve' ? 'approved' : 'unlinked';
    return json({ status: body.decision === 'approve' ? 'approved' : 'denied' });
  }
  if (method === 'DELETE') fixture.status = 'unlinked';
  return json({ status: fixture.status, accountLabel: 'iPhone account …fixture' });
};
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <NativeAccountLinkSignedIn userId="user_fixtureParent" email="parent@example.com" name="Fixture parent" />
  </QueryClientProvider>,
);
