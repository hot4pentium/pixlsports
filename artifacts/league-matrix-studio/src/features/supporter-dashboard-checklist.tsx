import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Trophy, X } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HypeCardReplyInboxTrigger } from './hype-card-reply-inbox';
import {
  isDashboardChecklistComplete,
  normalizeDashboardChecklistItemIds,
  SUPPORTER_DASHBOARD_CHECKLIST_ITEMS,
  type DashboardChecklistItemId,
} from './supporter-dashboard-checklist-state';
import type { ScheduleInstallAction } from './schedule-install';
import './supporter-dashboard-checklist.css';
import './tracker-completion-dialog.css';

type InstallDeviceClass = 'mobile' | 'desktop';

export function SupporterDashboardChecklistCompletionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="tracker-completion-dialog max-h-[85vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto border-primary bg-card p-0 text-card-foreground clip-angled-sm sm:rounded-none"
        data-testid="dialog-dashboard-checklist-complete"
        aria-modal="true"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const heading = [
            document.getElementById('game-on-summary-heading-mobile'),
            document.getElementById('game-on-summary-heading-desktop'),
          ].find((element) => element instanceof HTMLElement && element.getClientRects().length > 0);
          heading?.focus();
        }}
      >
        <div className="tracker-completion-celebration" aria-hidden="true">
          {Array.from({ length: 14 }, (_, index) => (
            <span
              key={index}
              className="tracker-completion-confetti"
              style={{ left: `${8 + index * 6.4}%`, animationDelay: `${(index % 5) * 90}ms` }}
            />
          ))}
          <div className="tracker-completion-trophy">
            <Trophy size={32} strokeWidth={2.2} />
          </div>
        </div>
        <div className="px-6 pb-7 pt-6 sm:px-8">
          <DialogHeader className="text-left">
            <DialogTitle
              className="font-display text-3xl leading-tight sm:text-4xl"
              data-testid="dashboard-checklist-completion-title"
            >
              Warm-up complete. You’re game-ready! 🏆
            </DialogTitle>
            <DialogDescription data-testid="dashboard-checklist-completion-description">
              Your setup is done. Let’s make this season one to remember.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <button
                type="button"
                className="min-h-11 w-full bg-primary px-4 text-sm font-bold text-primary-foreground"
                data-testid="button-dashboard-checklist-completion-done"
              >
                Let’s Play
              </button>
            </DialogClose>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface SupporterDashboardChecklistProps {
  userId: string;
  profileHref: string;
  hypeCardHref: string;
  checkedItemIds: DashboardChecklistItemId[];
  installAction: ScheduleInstallAction;
  installInstructionsOpen: boolean;
  installDeviceClass: InstallDeviceClass;
  onInstall: () => void | Promise<void>;
  onCreateEventCard: () => void;
  onSaveProgress: (checkedItemIds: DashboardChecklistItemId[]) => Promise<void>;
  onDismiss: (checkedItemIds: DashboardChecklistItemId[]) => Promise<void>;
}

export function SupporterDashboardChecklist({
  userId,
  profileHref,
  hypeCardHref,
  checkedItemIds,
  installAction,
  installInstructionsOpen,
  installDeviceClass,
  onInstall,
  onCreateEventCard,
  onSaveProgress,
  onDismiss,
}: SupporterDashboardChecklistProps) {
  const incomingCheckedKey = normalizeDashboardChecklistItemIds(checkedItemIds).join('|');
  const [checked, setChecked] = useState<DashboardChecklistItemId[]>(
    () => normalizeDashboardChecklistItemIds(checkedItemIds),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  useEffect(() => {
    setChecked(normalizeDashboardChecklistItemIds(checkedItemIds));
    setError('');
    setHidden(false);
  }, [userId, incomingCheckedKey]);

  useEffect(() => {
    setActiveStepIndex(0);
  }, [userId]);

  const saveProgress = async (next: DashboardChecklistItemId[]) => {
    setPending(true);
    setError('');
    try {
      await onSaveProgress(next);
      setChecked(next);
      if (isDashboardChecklistComplete(next)) setHidden(true);
    } catch {
      setError('Your checklist progress could not be saved. Try again.');
    } finally {
      setPending(false);
    }
  };

  const toggleItem = (itemId: DashboardChecklistItemId) => {
    const next = checked.includes(itemId)
      ? checked.filter((checkedId) => checkedId !== itemId)
      : [...checked, itemId];
    void saveProgress(normalizeDashboardChecklistItemIds(next));
  };

  const dismissChecklist = async () => {
    setPending(true);
    setError('');
    try {
      await onDismiss(checked);
      setHidden(true);
    } catch {
      setError('The checklist could not be dismissed. Try again.');
    } finally {
      setPending(false);
    }
  };

  if (hidden) return null;

  const progressLabel = `${checked.length} of ${SUPPORTER_DASHBOARD_CHECKLIST_ITEMS.length} complete`;
  return (
    <section
      className="supporter-dashboard-checklist"
      aria-labelledby="supporter-dashboard-checklist-heading"
      data-testid="supporter-dashboard-checklist"
    >
      <header className="supporter-dashboard-checklist__header">
        <div className="supporter-dashboard-checklist__heading-group">
          <p className="supporter-dashboard-checklist__eyebrow">Your dashboard playbook</p>
          <h2 id="supporter-dashboard-checklist-heading">Get to know your Dashboard</h2>
        </div>
        <button
          type="button"
          className="supporter-dashboard-checklist__dismiss"
          onClick={() => void dismissChecklist()}
          disabled={pending}
          aria-label="Dismiss the dashboard checklist"
          data-testid="dashboard-checklist-dismiss"
        >
          <span>Dismiss</span>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <p className="supporter-dashboard-checklist__intro">
        Explore the tools when you’re ready. Check off each step yourself, or dismiss this list.
      </p>

      <div
        className="supporter-dashboard-checklist__progress"
        role="progressbar"
        aria-label="Dashboard checklist progress"
        aria-valuemin={0}
        aria-valuemax={SUPPORTER_DASHBOARD_CHECKLIST_ITEMS.length}
        aria-valuenow={checked.length}
      >
        <span className="supporter-dashboard-checklist__progress-track" aria-hidden="true">
          <span style={{ width: `${(checked.length / SUPPORTER_DASHBOARD_CHECKLIST_ITEMS.length) * 100}%` }} />
        </span>
        <span className="supporter-dashboard-checklist__progress-label">{progressLabel}</span>
      </div>

      <nav
        className="supporter-dashboard-checklist__step-navigation"
        aria-label="Dashboard getting started steps"
        data-testid="dashboard-checklist-step-navigation"
      >
        <button
          type="button"
          className="supporter-dashboard-checklist__step-button"
          onClick={() => setActiveStepIndex((current) => Math.max(0, current - 1))}
          disabled={pending || activeStepIndex === 0}
          aria-label="Previous checklist step"
          data-testid="dashboard-checklist-previous-step"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          <span>Previous</span>
        </button>
        <span
          className="supporter-dashboard-checklist__step-count"
          aria-live="polite"
          data-testid="dashboard-checklist-step-indicator"
        >
          Step {activeStepIndex + 1} of {SUPPORTER_DASHBOARD_CHECKLIST_ITEMS.length}
        </span>
        <button
          type="button"
          className="supporter-dashboard-checklist__step-button"
          onClick={() => setActiveStepIndex((current) => Math.min(SUPPORTER_DASHBOARD_CHECKLIST_ITEMS.length - 1, current + 1))}
          disabled={pending || activeStepIndex === SUPPORTER_DASHBOARD_CHECKLIST_ITEMS.length - 1}
          aria-label="Next checklist step"
          data-testid="dashboard-checklist-next-step"
        >
          <span>Next</span>
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </nav>

      <ul className="supporter-dashboard-checklist__items" aria-label="Dashboard getting started steps">
        {SUPPORTER_DASHBOARD_CHECKLIST_ITEMS.map((item, index) => {
          const isChecked = checked.includes(item.id);
          const isCurrentStep = index === activeStepIndex;
          const checkboxId = `dashboard-checklist-${installDeviceClass}-${item.id}`;
          return (
            <li
              className="supporter-dashboard-checklist__item"
              data-complete={isChecked}
              data-current={isCurrentStep}
              aria-current={isCurrentStep ? 'step' : undefined}
              key={item.id}
            >
              <input
                id={checkboxId}
                className="supporter-dashboard-checklist__checkbox"
                type="checkbox"
                checked={isChecked}
                disabled={pending}
                onChange={() => toggleItem(item.id)}
                aria-label={`Mark ${item.title} complete`}
                data-testid={`dashboard-checklist-checkbox-${item.id}`}
              />
              <label
                className="supporter-dashboard-checklist__item-copy"
                htmlFor={checkboxId}
              >
                <span className="supporter-dashboard-checklist__item-title">{item.title}</span>
                {item.id === 'profile' && <span>Add your athlete and account details.</span>}
                {item.id === 'shoutouts' && <span>See messages from family and friends.</span>}
                {item.id === 'hype-card' && <span>Follow your athlete’s highlights and season.</span>}
                {item.id === 'event-card' && <span>Keep game or practice details close.</span>}
                {item.id === 'install-app' && <span>Keep Pixl Sports one tap away.</span>}
              </label>
              <div className="supporter-dashboard-checklist__action">
                {item.id === 'profile' && (
                  <Link
                    href={profileHref}
                    className="supporter-dashboard-checklist__action-link"
                    data-testid="dashboard-checklist-action-profile"
                  >
                    Open profile <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                )}
                {item.id === 'shoutouts' && (
                  <HypeCardReplyInboxTrigger
                    variant="supporter"
                    ariaLabel="Open Shoutouts"
                    testId="dashboard-checklist-action-shoutouts"
                    className="supporter-dashboard-checklist__shoutouts-action"
                  />
                )}
                {item.id === 'hype-card' && (
                  <Link
                    href={hypeCardHref}
                    className="supporter-dashboard-checklist__action-link"
                    data-testid="dashboard-checklist-action-hype-card"
                  >
                    View Hype Card <ArrowUpRight size={14} aria-hidden="true" />
                  </Link>
                )}
                {item.id === 'event-card' && (
                  <button
                    type="button"
                    className="supporter-dashboard-checklist__action-link"
                    onClick={onCreateEventCard}
                    data-testid="dashboard-checklist-action-event-card"
                  >
                    Create an Event Card <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                )}
                {item.id === 'install-app' && (installAction === 'installed' ? (
                  <span className="supporter-dashboard-checklist__installed" data-testid="dashboard-checklist-app-installed">
                    Installed
                  </span>
                ) : (
                  <button
                    type="button"
                    className="supporter-dashboard-checklist__action-link"
                    onClick={() => { void onInstall(); }}
                    aria-expanded={installInstructionsOpen}
                    data-testid="dashboard-checklist-action-install"
                  >
                    {installAction === 'install' ? 'Install app' : 'How to install'}
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                ))}
              </div>
              {isChecked && <Check className="supporter-dashboard-checklist__complete-mark" size={15} aria-hidden="true" />}
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="supporter-dashboard-checklist__error" role="alert" data-testid="dashboard-checklist-error">
          {error}
        </p>
      )}
      {pending && (
        <p className="supporter-dashboard-checklist__saving" role="status">
          Saving checklist…
        </p>
      )}
    </section>
  );
}