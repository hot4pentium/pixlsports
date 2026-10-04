import { CalendarDays, ChartNoAxesCombined, Zap } from 'lucide-react';
import { LivingAthleteCardFront } from './current/features/living-athlete-card-front';
import { defaultCardAppearance } from './current/features/hype-card-appearance';
import athletePhoto from './current/assets/hypecard-player-photo-640.webp';
import './_group.css';

const appearance = {
  ...defaultCardAppearance('breakout'),
  jerseyNumber: '24',
};

export function Current() {
  return (
    <div className="living-card-page breakout-mockup">
      <main className="living-card-main">
        <div className="living-card-layout living-card-layout-solo">
          <section className="living-card-stage" data-design="breakout" aria-label="Kimberly's HYPE Card">
            <div className="living-card-frame-outer">
              <div className="living-card-frame" data-side="front" data-design="breakout">
                <div className="living-card-flip-inner">
                  <div className="living-card-flip-face living-card-flip-front">
                    <LivingAthleteCardFront
                      athleteName="Kimberly"
                      teamName="Hurricanes"
                      photoUrl={athletePhoto}
                      appearance={appearance}
                      sport="basketball"
                    />
                  </div>
                  <div className="living-card-flip-face living-card-flip-back" />
                </div>
                <div className="living-card-controls" role="group" aria-label="Card sides">
                  <button type="button" className="living-card-control" aria-pressed="false"><span className="living-card-control-emoji" aria-hidden="true">👍</span> Replies</button>
                  <button type="button" className="living-card-control" aria-pressed="false"><ChartNoAxesCombined aria-hidden="true" /> Stats</button>
                  <button type="button" className="living-card-control" aria-pressed="false"><Zap aria-hidden="true" /> Taps</button>
                  <button type="button" className="living-card-control" aria-pressed="false"><CalendarDays aria-hidden="true" /> Events</button>
                </div>
              </div>
            </div>
            <button type="button" className="living-card-return-front" aria-pressed="true">
              Flip to card front
            </button>
          </section>
        </div>
      </main>
    </div>
  );
}