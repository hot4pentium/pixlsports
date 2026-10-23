import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, CircleStop, Pause } from 'lucide-react';
import { BackNavigationLink } from '@/components/back-navigation-link';
import type { GameStatus } from './stat-tracker';

export function TrackerHubNavigation({
  gameStatus,
  onBack,
}: {
  gameStatus: GameStatus | null;
  onBack: () => void;
}) {
  const label = gameStatus === 'paused'
    ? 'Back to Game Day Hub · Leave game open'
    : 'Back to Game Day Hub';

  return (
    <>
      {gameStatus === null ? (
        <BackNavigationLink
          href="/studio"
          label="Back to Game Day Hub"
          testId="link-stat-tracker-studio"
          className="mb-0 min-h-14 w-full justify-center text-sm"
        />
      ) : (
        <button
          type="button"
          onClick={onBack}
          aria-label={label}
          data-testid="button-back-to-game-day-hub"
          className="inline-flex min-h-14 w-full items-center justify-center gap-3 border border-border bg-card px-4 py-3 text-center text-xs font-bold uppercase tracking-[.14em] text-primary-ink hover:border-primary hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:text-sm"
        >
          <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{label}</span>
        </button>
      )}
    </>
  );
}

export function TrackerLiveExitDialog({
  open,
  onPauseAndLeave,
  onEndGame,
  onKeepTracking,
}: {
  open: boolean;
  onPauseAndLeave: () => void;
  onEndGame: () => void;
  onKeepTracking: () => void;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepTrackingRef = useRef<HTMLButtonElement>(null);
  const onKeepTrackingRef = useRef(onKeepTracking);
  onKeepTrackingRef.current = onKeepTracking;

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    keepTrackingRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onKeepTrackingRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-[130] flex items-center justify-center overflow-y-auto bg-background/85 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        data-testid="dialog-live-game-leave-choice"
        className="w-full max-w-lg border border-primary bg-card p-5 text-card-foreground shadow-2xl outline-none clip-angled-sm sm:p-7"
      >
        <p className="text-xs font-bold uppercase tracking-[.2em] text-primary-ink">Game still live</p>
        <h2 id={headingId} className="mt-2 font-display text-3xl uppercase tracking-wide">Choose what to do</h2>
        <p id={descriptionId} className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Pause the game before returning to the Game Day Hub, end and save it, or stay here to keep tracking.
        </p>
        <div className="mt-6 grid gap-2">
          <button
            type="button"
            onClick={onPauseAndLeave}
            data-testid="button-pause-and-leave-game"
            className="inline-flex min-h-12 items-center justify-center gap-2 bg-primary px-4 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Pause className="h-4 w-4" aria-hidden="true" /> Pause and return to Game Day Hub
          </button>
          <button
            type="button"
            onClick={onEndGame}
            data-testid="button-end-game-from-leave-choice"
            className="inline-flex min-h-12 items-center justify-center gap-2 border border-destructive px-4 py-3 text-xs font-bold uppercase tracking-widest text-destructive hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <CircleStop className="h-4 w-4" aria-hidden="true" /> End game and review save options
          </button>
          <button
            ref={keepTrackingRef}
            type="button"
            onClick={onKeepTracking}
            data-testid="button-keep-tracking"
            className="inline-flex min-h-12 items-center justify-center border border-border px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Keep tracking
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
