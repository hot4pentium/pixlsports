import type { ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import './hype-manager-wallet.css';

export function HypeManagerTaskCard({
  id,
  title,
  description,
  Icon,
  active,
  onSelect,
  children,
  badge,
  preview,
}: {
  id: string;
  title: string;
  description: string;
  Icon: LucideIcon;
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
  badge?: string;
  preview?: ReactNode;
}) {
  const panelId = `hype-manager-panel-${id}`;
  const triggerId = `hype-manager-trigger-${id}`;

  return (
    <div className="hype-manager-task">
      <button
        id={triggerId}
        type="button"
        className="hype-manager-task-button"
        data-testid={`button-hype-manager-${id}`}
        aria-expanded={active}
        aria-controls={panelId}
        onClick={onSelect}
      >
        <span className="hype-manager-task-icon" aria-hidden="true"><Icon /></span>
        <span className="hype-manager-task-copy">
          {badge && <span className="hype-manager-task-badge">{badge}</span>}
          <span className="hype-manager-task-title">{title}</span>
          <span className="hype-manager-task-description">{description}</span>
        </span>
        {preview && <span className="hype-manager-task-preview" aria-hidden="true">{preview}</span>}
        <span className="hype-manager-task-chevron" aria-hidden="true"><ChevronRight /></span>
      </button>
      <div
        id={panelId}
        className="hype-manager-task-panel"
        aria-labelledby={triggerId}
        hidden={!active}
      >
        {children}
      </div>
    </div>
  );
}