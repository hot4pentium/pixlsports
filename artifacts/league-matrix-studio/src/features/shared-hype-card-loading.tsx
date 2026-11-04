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
      <p>Opening HYPE Card…</p>
    </main>
  );
}
