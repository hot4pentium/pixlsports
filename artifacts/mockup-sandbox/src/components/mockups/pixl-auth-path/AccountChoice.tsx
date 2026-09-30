import './_group.css';
import './auth-page.css';
import { useState } from 'react';
import { ArrowRight, Check, ChevronLeft, LogIn, Mail, ShieldCheck, UserRoundPlus } from 'lucide-react';

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

export function AccountChoice() {
  const [accountPath, setAccountPath] = useState<'new' | 'returning' | null>(null);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');

  const choosePath = (path: 'new' | 'returning') => {
    setAccountPath(path);
    setNotice('');
  };

  const submitEmail = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice(`Email step ready for ${email}.`);
  };

  return (
    <AuthLayout
      title={<>Every season<br /><span>starts here.</span></>}
      subtitle="One home for the schedules, stories, and game-day moments your family shares."
    >
      <section className="auth-choice-card" aria-labelledby="auth-choice-heading">
        <div className="auth-choice-heading">
          <p className="auth-choice-kicker"><span>01</span> Account type <i /> Step 1 of 2</p>
          <h2 className="auth-choice-title" id="auth-choice-heading">First time here, or coming back?</h2>
          <p className="auth-choice-copy">Choose your account path first. We’ll show the right sign-in options next.</p>
        </div>
        <div className="auth-choice-options" role="group" aria-label="Choose your account type">
          <button
            className={`auth-choice-option auth-choice-option--new${accountPath === 'new' ? ' is-selected' : ''}`}
            type="button"
            aria-pressed={accountPath === 'new'}
            onClick={() => choosePath('new')}
          >
            <span className="auth-choice-option__top">
              <span className="auth-choice-option__title"><UserRoundPlus size={18} /> Create an account</span>
              <ArrowRight size={18} />
            </span>
            <span className="auth-choice-option__description">New to Pixl? Set up your family profile and add an athlete.</span>
            <span className="auth-choice-option__meta">FIRST TIME ON PIXL</span>
          </button>
          <button
            className={`auth-choice-option auth-choice-option--returning${accountPath === 'returning' ? ' is-selected' : ''}`}
            type="button"
            aria-pressed={accountPath === 'returning'}
            onClick={() => choosePath('returning')}
          >
            <span className="auth-choice-option__top">
              <span className="auth-choice-option__title"><LogIn size={18} /> Sign in</span>
              <ArrowRight size={18} />
            </span>
            <span className="auth-choice-option__description">Already have a Pixl account? Pick up where your family left off.</span>
            <span className="auth-choice-option__meta">RETURNING MEMBER</span>
          </button>
        </div>

        {accountPath ? (
          <div className="auth-choice-auth" aria-live="polite">
            <div className="auth-choice-auth__heading">
              <div>
                <p className="auth-choice-auth__step">STEP 2 <span>·</span> {accountPath === 'new' ? 'CREATE YOUR ACCOUNT' : 'SIGN IN'}</p>
                <h3>{accountPath === 'new' ? 'Choose how to get started' : 'Welcome back to Pixl'}</h3>
              </div>
              <button className="auth-choice-back" type="button" onClick={() => choosePath(accountPath === 'new' ? 'returning' : 'new')}>
                <ChevronLeft size={15} /> Change
              </button>
            </div>
            <button className="auth-choice-google" type="button" onClick={() => setNotice('Google sign-in selected.')}>
              <span className="auth-choice-google__mark" aria-hidden="true">G</span>
              Continue with Google
              <ArrowRight size={16} />
            </button>
            <div className="auth-choice-divider"><span>or use email</span></div>
            <form className="auth-choice-email" onSubmit={submitEmail}>
              <label htmlFor="pixl-account-email">Email address</label>
              <div className="auth-choice-email__field">
                <Mail size={17} aria-hidden="true" />
                <input
                  id="pixl-account-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <button className="auth-choice-email__submit" type="submit">
                {accountPath === 'new' ? 'Continue with email' : 'Continue to sign in'} <ArrowRight size={16} />
              </button>
            </form>
            {notice ? <p className="auth-choice-notice" role="status"><Check size={15} />{notice}</p> : null}
            <p className="auth-choice-secure"><ShieldCheck size={15} /> Your family’s information stays private and secure.</p>
          </div>
        ) : (
          <p className="auth-choice-footnote"><ShieldCheck size={15} /> Google and email options appear after you choose a path.</p>
        )}
      </section>
    </AuthLayout>
  );
}