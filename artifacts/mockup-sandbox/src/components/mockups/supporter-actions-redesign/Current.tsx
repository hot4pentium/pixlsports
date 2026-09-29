import { Activity, Zap } from 'lucide-react';
import './_group.css';

export function Current() {
  return (
    <main className="supporter-actions-preview">
      <div className="supporter-actions-preview__content">
        <div className="flex flex-wrap items-center gap-3" data-testid="dashboard-primary-actions">
          <a
            href="#stats"
            className="dashboard-quick-action inline-flex min-h-11 items-center gap-2 rounded-md px-4 py-2 text-xs font-bold"
          >
            <Activity size={16} aria-hidden="true" /> View stats
          </a>
          <a
            href="#hype-card"
            className="dashboard-quick-action inline-flex min-h-11 items-center gap-2 rounded-md px-4 py-2 text-xs font-bold"
          >
            <Zap size={16} aria-hidden="true" /> View HYPE Card
          </a>
        </div>
      </div>
    </main>
  );
}