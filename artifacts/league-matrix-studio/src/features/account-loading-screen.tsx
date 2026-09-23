import './account-loading-screen.css';

export function AccountLoadingScreen() {
  return (
    <div className="account-loading-screen" role="status" aria-live="polite">
      <div className="account-loading-content">
        <img
          className="account-loading-logo"
          src={`${import.meta.env.BASE_URL}pixlsports-logo.png`}
          alt=""
          width="245"
          height="100"
        />
        <div className="account-loading-track" aria-hidden="true">
          <span className="account-loading-progress" />
        </div>
      </div>
      <span className="sr-only">Checking account access…</span>
    </div>
  );
}