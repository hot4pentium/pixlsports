import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

function registerProgressiveWebApp() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    const basePath = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${basePath}sw.js`, { scope: basePath }).catch((error) => {
      console.warn('Pixl Sports offline shell could not be registered.', error);
    });
  }, { once: true });
}

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
