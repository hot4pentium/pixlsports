import './_group.css';
import './auth-page.css';

function AuthLayout({ children, title, subtitle }: {
  children: React.ReactNode;
  title: React.ReactNode;
  subtitle: string;
}) {
  return (
    <div className="auth-page">
      <header className="auth-header">
        <a className="auth-home" href="#" aria-label="Pixl Sports home">
          <img src="/__mockup/images/pixlsports-logo.png" alt="Pixl Sports" />
        </a>
        <a className="auth-back" href="#">← Back to Pixl Sports</a>
      </header>
      <main className="auth-shell">
        <section className="auth-story" aria-label="About Pixl Sports">
          <p className="auth-eyebrow"><span aria-hidden="true" /> Your season, guided</p>
          <h1>{title}</h1>
          <p className="auth-subtitle">{subtitle}</p>
          <div className="auth-story-rule" aria-hidden="true" />
          <ul className="auth-highlights">
            <li>✓ <span>Plan each week</span></li>
            <li>✓ <span>Share game day</span></li>
            <li>✓ <span>Cheer on your athlete</span></li>
          </ul>
        </section>
        <div className="auth-form-wrap">
          {children}
          <p className="auth-footnote">A season worth keeping / Pixl Sports</p>
        </div>
      </main>
    </div>
  );
}

export function Current() {
  return (
    <AuthLayout
      title={<>Pick up<br /><span>the season.</span></>}
      subtitle="Your athlete’s season, all in one place. Pick up where you left off."
    >
      <div className="mock-auth-card">
        <img className="mock-auth-logo" src="/__mockup/images/pixlsports-logo.png" alt="Pixl Sports" />
        <h2 className="mock-auth-title">Welcome back</h2>
        <p className="mock-auth-subtitle">Sign in to continue your athlete’s season</p>
        <button className="mock-google-button" type="button"><span className="mock-google-mark">G</span> Continue with Google</button>
        <div className="mock-divider"><span>OR</span></div>
        <label className="mock-field-label">Email address</label>
        <div className="mock-email-field" />
        <button className="mock-email-button" type="button">Continue　›</button>
        <p className="mock-auth-footer">Don’t have an account? <a href="#">Sign up</a></p>
        <p className="mock-dev-label">Development mode</p>
      </div>
    </AuthLayout>
  );
}