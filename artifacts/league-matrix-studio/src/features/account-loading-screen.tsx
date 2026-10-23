import { useEffect, useState } from 'react';

import './account-loading-screen.css';

export function AccountLoadingScreen({ onRetry, error = false }: { onRetry?: () => void; error?: boolean }) {
  const [slow, setSlow] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 3000);
    const updateConnection = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  return (
    <div className="account-loading-screen" data-error={error || !online ? 'true' : undefined} role={error ? 'alert' : 'status'} aria-live="polite">
      <div className="account-loading-content">
        <span className="account-loading-logo" aria-label="Pixl Sports">
          PIXL <span>SPORTS</span>
        </span>
        <div className="account-loading-track" aria-hidden="true">
          <span className="account-loading-progress" />
        </div>
        <h1 className="account-loading-title">Opening your studio</h1>
        <p className="account-loading-message" data-testid="dashboard-boot-status">
          {!online
            ? 'You are offline. Reconnect to verify your account and open your private dashboard.'
            : error
              ? 'Could not check your account access. Try again.'
              : slow
              ? 'Still checking your account. A weak connection may take longer.'
              : 'Checking your account access…'}
        </p>
        {online && (slow || error) && onRetry && (
          <button className="account-loading-retry" type="button" onClick={onRetry}>
            Try again
          </button>
        )}
        <div className="account-loading-dashboard" aria-hidden="true">
          <div className="account-loading-dashboard-top" />
          <div className="account-loading-dashboard-card" />
          <div className="account-loading-dashboard-card account-loading-dashboard-card-small" />
        </div>
      </div>
    </div>
  );
}