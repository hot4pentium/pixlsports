import { Activity, ArrowUpRight, Zap } from 'lucide-react';
import './_group.css';

export function CombinedCard() {
  return (
    <main className="supporter-actions-preview">
      <div className="supporter-actions-preview__content">
        <section className="combined-actions-card" aria-label="Quick links">
          <div className="combined-actions-card__heading">
            <span className="combined-actions-card__heading-mark" aria-hidden="true" />
            <span>Quick links</span>
          </div>
          <div className="combined-actions-card__grid" data-testid="dashboard-primary-actions-grid">
            <a href="#stats" className="combined-actions-card__link">
              <span className="combined-actions-card__link-content">
                <span className="combined-actions-card__icon" aria-hidden="true">
                  <Activity size={17} strokeWidth={2.2} />
                </span>
                <span className="combined-actions-card__label">View stats</span>
              </span>
              <ArrowUpRight className="combined-actions-card__arrow" size={15} aria-hidden="true" />
            </a>
            <a href="#hype-card" className="combined-actions-card__link">
              <span className="combined-actions-card__link-content">
                <span className="combined-actions-card__icon combined-actions-card__icon--hype" aria-hidden="true">
                  <Zap size={17} strokeWidth={2.2} />
                </span>
                <span className="combined-actions-card__label">View HYPE Card</span>
              </span>
              <ArrowUpRight className="combined-actions-card__arrow" size={15} aria-hidden="true" />
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}