import { createRoot } from 'react-dom/client';

import App from '@/app-entry';
import { defaultProject, saveHypeCardProject } from './hype-card-types';
import { defaultCardAppearance } from './hype-card-appearance';
import { currentAccountId } from './account-lifecycle-browser-auth';

import '../index.css';

const params = new URLSearchParams(location.search);
const scenario = params.get('scenario') || 'still';

if (scenario === 'photo') {
  saveHypeCardProject(window.localStorage, {
    ...defaultProject(),
    mediaType: 'image',
    photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p5wAAAAASUVORK5CYII=',
    cardAppearance: defaultCardAppearance('pixel-edge'),
  });
} else if (scenario === 'video') {
  saveHypeCardProject(window.localStorage, {
    ...defaultProject(),
    mediaType: 'video',
    breakoutEnabled: true,
  });
}

const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const requestUrl = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  if (!new URL(requestUrl, location.href).pathname.startsWith('/api/')) {
    return originalFetch(input, init);
  }

  const pathname = new URL(requestUrl, location.href).pathname;
  const body = pathname === '/api/account/access'
    ? { paid: false, accessMode: 'full' }
    : pathname === '/api/account/lifecycle'
      ? { status: 'active', adminSuspended: false }
      : [];
  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
};

history.replaceState({}, '', '/studio/hype-card');
document.body.dataset.signedInFixture = String(Boolean(currentAccountId()));

createRoot(document.getElementById('root')!).render(<App />);