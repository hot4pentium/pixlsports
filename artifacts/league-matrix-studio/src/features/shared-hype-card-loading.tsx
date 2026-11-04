import './shared-hype-card-loading.css';

export function SharedHypeCardLoading() {
  return (
    <main
      className="shared-hype-card-loading"
      role="status"
      aria-label="Opening HYPE Card"
      aria-busy="true"
      data-testid="shared-hype-card-loading"
    >
      <img
        className="shared-hype-card-loading__logo"
        src={`${import.meta.env.BASE_URL}pixlsports-logo.png`}
        alt="PIXL Sports"
        width="280"
        height="114"
      />
      <p>Opening HYPE Card…</p>
    </main>
  );
}
