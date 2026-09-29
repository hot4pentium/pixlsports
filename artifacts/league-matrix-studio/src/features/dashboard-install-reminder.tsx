import React from 'react';
import { Smartphone } from 'lucide-react';
import {
  getScheduleInstallInstructions,
  type ScheduleInstallAction,
} from './schedule-install';

type InstallDeviceClass = 'mobile' | 'desktop';

type DashboardInstallReminderProps = {
  action: ScheduleInstallAction;
  isIOS: boolean;
  showInstructions: boolean;
  onInstall: (deviceClass: InstallDeviceClass) => void;
  variant: InstallDeviceClass;
};

export function DashboardInstallReminder({
  action,
  isIOS,
  showInstructions,
  onInstall,
  variant,
}: DashboardInstallReminderProps) {
  if (action === 'installed') return null;

  const instructionsId = `dashboard-install-instructions-${variant}`;

  return (
    <aside
      className="dashboard-install-reminder"
      aria-label="Install Pixl Sports"
      data-testid={`dashboard-install-reminder-${variant}`}
    >
      <div className="dashboard-install-reminder__copy">
        <span className="dashboard-install-reminder__icon" aria-hidden="true">
          <Smartphone size={18} strokeWidth={2} />
        </span>
        <div className="dashboard-install-reminder__text">
          <p className="dashboard-install-reminder__eyebrow">QUICK ACCESS FOR GAME DAY</p>
          <p className="dashboard-install-reminder__message">
            Install Pixl Sports for one-tap access. Adding a shortcut does not enable alerts; choose them separately under Profile → Phone Alerts.
          </p>
        </div>
      </div>
      <button
        type="button"
        className="dashboard-install-reminder__button"
        onClick={() => { void onInstall(variant); }}
        aria-expanded={showInstructions}
        aria-controls={instructionsId}
        aria-label={action === 'install' ? 'Install Pixl Sports' : 'Show Pixl Sports installation instructions'}
        data-testid={`button-dashboard-install-${variant}`}
      >
        {action === 'install' ? 'Install app' : 'How to install'}
      </button>
      {showInstructions && (
        <p
          id={instructionsId}
          className="dashboard-install-reminder__instructions"
          role="status"
          data-testid={`dashboard-install-instructions-${variant}`}
        >
          {getScheduleInstallInstructions(isIOS)}
        </p>
      )}
    </aside>
  );
}