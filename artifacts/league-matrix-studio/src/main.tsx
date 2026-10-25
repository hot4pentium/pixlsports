import { createRoot } from 'react-dom/client';

import App from './app-entry';
import { ErrorBoundary } from '@/components/error-boundary';
import { afterPageLoad } from '@/features/after-page-load';

import './index.css';
import './features/tracker-completion-dialog.css';

const offlineCachePrefix = 'pixl-sports-shell';
const developmentWorkerResetKey = 'pixl-sports-dev-worker-reset';

async function clearDevelopmentServiceWorker() {
  if (import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href);
  const registrations = await navigator.serviceWorker.getRegistrations();
  const matchingRegistrations = registrations.filter((registration) => {
    const scope = new URL(registration.scope);
    return scope.origin === baseUrl.origin && scope.pathname === baseUrl.pathname;
  });
  const controlledByMatchingWorker = matchingRegistrations.some((registration) =>
    navigator.serviceWorker.controller?.scriptURL.startsWith(registration.scope),
  );

  await Promise.all(matchingRegistrations.map((registration) => registration.unregister()));

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(offlineCachePrefix))
        .map((cacheName) => caches.delete(cacheName)),
    );
  }

  if (controlledByMatchingWorker && sessionStorage.getItem(developmentWorkerResetKey) !== 'done') {
    sessionStorage.setItem(developmentWorkerResetKey, 'done');
    window.location.reload();
    return;
  }

  sessionStorage.removeItem(developmentWorkerResetKey);
}

function registerProgressiveWebApp() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  afterPageLoad(document, window, () => {
    const basePath = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${basePath}sw.js`, {
      scope: basePath,
      updateViaCache: 'none',
    }).catch((error) => {
      console.warn('Pixl Sports offline shell could not be registered.', error);
    });
  });
}

void clearDevelopmentServiceWorker().catch((error) => {
  console.warn('Pixl Sports could not clear its stale development worker.', error);
});

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);

registerProgressiveWebApp();
window.dispatchEvent(new Event('leagueMatrix:booted'));
