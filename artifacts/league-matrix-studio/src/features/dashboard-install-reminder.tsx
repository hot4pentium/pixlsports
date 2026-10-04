import React from 'react';
import { Smartphone } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

  return (
    <aside
      className="dashboard-install-reminder"
      aria-label="Install Pixl Sports"
      data-testid={`dashboard-install-reminder-${variant}`}
    >
      <button
        type="button"
        className="dashboard-install-reminder__button"
        onClick={() => { void onInstall(variant); }}
        aria-expanded={showInstructions}
        aria-controls="dashboard-install-instructions-dialog"
        aria-label={action === 'install' ? 'Install Pixl Sports' : 'Show Pixl Sports installation instructions'}
        data-testid={`button-dashboard-install-${variant}`}
      >
        <Smartphone size={16} strokeWidth={2} aria-hidden="true" />
        <span>{action === 'install' ? 'Install app' : 'How to install'}</span>
      </button>
    </aside>
  );
}

type DashboardInstallInstructionsDialogProps = {
  open: boolean;
  isIOS: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DashboardInstallInstructionsDialog({
  open,
  isIOS,
  onOpenChange,
}: DashboardInstallInstructionsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        id="dashboard-install-instructions-dialog"
        className="w-[calc(100vw-2rem)] max-w-md border-[#55A4FF]/35 bg-[#0B1F3A] p-5 text-white shadow-2xl sm:rounded-xl"
        data-testid="dashboard-install-instructions-dialog"
      >
        <DialogHeader className="space-y-3 pr-5 text-left">
          <DialogTitle className="font-display text-2xl uppercase tracking-wide text-white">
            How to install Pixl Sports
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-white/75">
            Add Pixl Sports to your Home Screen for one-tap game-day access. This does not turn on alerts; choose them separately under Profile → Phone Alerts.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-[#55A4FF]/30 bg-[#102B4D] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-[#8EC4FF]">
            {isIOS ? 'iPhone or iPad' : 'Your browser'}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-white/90" data-testid="dashboard-install-instructions">
            {getScheduleInstallInstructions(isIOS)}
          </p>
        </div>
        <DialogFooter className="sm:justify-start">
          <DialogClose asChild>
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-[#8EC4FF] px-5 text-xs font-black uppercase tracking-widest text-[#071A31] transition-colors hover:bg-[#B8DCFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              data-testid="dashboard-install-instructions-dismiss"
            >
              Got it
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}