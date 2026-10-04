import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import './hype-manager-wallet.css';

export function HypeManagerTaskCard({
  id,
  title,
  description,
  Icon,
  active,
  onSelect,
  taskIndex,
  activeTaskIndex,
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
  taskIndex?: number;
  activeTaskIndex?: number;
  children: ReactNode;
  badge?: string;
  preview?: ReactNode;
}) {
  const panelId = `hype-manager-panel-${id}`;
  const triggerId = `hype-manager-trigger-${id}`;
  const gridPositions: CSSProperties | undefined = taskIndex === undefined || activeTaskIndex === undefined
    ? undefined
    : (() => {
      const mobileGroup = Math.floor(taskIndex / 2);
      const mobileActiveGroup = activeTaskIndex < 0 ? -1 : Math.floor(activeTaskIndex / 2);
      const desktopGroup = Math.floor(taskIndex / 3);
      const desktopActiveGroup = activeTaskIndex < 0 ? -1 : Math.floor(activeTaskIndex / 3);
      return {
        '--hype-task-column-mobile': String((taskIndex % 2) + 1),
        '--hype-task-row-mobile': String(mobileGroup + 1 + (activeTaskIndex >= 0 && mobileGroup > mobileActiveGroup ? 1 : 0)),
        '--hype-panel-row-mobile': String(Math.max(1, mobileActiveGroup + 2)),
        '--hype-task-column-desktop': String((taskIndex % 3) + 1),
        '--hype-task-row-desktop': String(desktopGroup + 1 + (activeTaskIndex >= 0 && desktopGroup > desktopActiveGroup ? 1 : 0)),
        '--hype-panel-row-desktop': String(Math.max(1, desktopActiveGroup + 2)),
      } as CSSProperties;
    })();

  return (
    <div className="hype-manager-task" style={gridPositions}>
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