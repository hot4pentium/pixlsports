import { useMemo, useState } from 'react';
import { CalendarDays, ChartNoAxesCombined, Zap } from 'lucide-react';
import playerPhoto from './assets/hypecard-player-photo-640.webp?url';
import { defaultCardAppearance } from './features/hype-card-appearance';
import { buildBrandedPremiumHypeCardArtwork } from './features/premium-hype-card-brand';
import './simplified.css';

const appearance = {
  ...defaultCardAppearance('breakout'),
  borderColor: '#B7C4D4',
  accentColor: '#36B9FF',
  jerseyNumber: '24',
};

const sections = [
  { label: 'Replies', emoji: '👍' },
  { label: 'Stats', icon: ChartNoAxesCombined },
  { label: 'Taps', icon: Zap },
  { label: 'Events', icon: CalendarDays },
];

export function Simplified() {
  const [activeSection, setActiveSection] = useState('Replies');
  const artwork = useMemo(() => buildBrandedPremiumHypeCardArtwork({
    athleteName: 'Kimberly',
    teamName: 'Hurricanes',
    sport: 'Basketball',
    photoUrl: playerPhoto,
    appearance,
  }, 'all', 'simplified-breakout'), []);

  return (
    <main className="breakout-simplified">
      <div className="breakout-preview">
        <section className="breakout-showcase" aria-label="Kimberly's Breakout HYPE Card">
          <div className="breakout-art-frame">
            <div className="breakout-art" role="img" aria-label="Kimberly, Hurricanes — Breakout HYPE Card" dangerouslySetInnerHTML={{ __html: artwork }} />
          </div>
          <nav className="breakout-side-nav" aria-label="HYPE Card sections">
            {sections.map(({ label, icon: Icon, emoji }) => (
              <button
                type="button"
                key={label}
                className="breakout-nav-item"
                aria-pressed={activeSection === label}
                onClick={() => setActiveSection(label)}
              >
                {emoji ? <span className="breakout-nav-emoji" aria-hidden="true">{emoji}</span> : Icon && <Icon aria-hidden="true" />}
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </section>
      </div>
    </main>
  );
}

export default Simplified;