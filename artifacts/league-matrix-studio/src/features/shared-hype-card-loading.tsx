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
      <div className="shared-hype-card-loading__frame" aria-hidden="true">
        <div className="shared-hype-card-loading__photo" />
        <div className="shared-hype-card-loading__identity">
          <span>PIXL SPORTS · HYPE CARD</span>
          <i />
        </div>
      </div>
      <p>Opening HYPE Card…</p>
    </main>
  );
}
