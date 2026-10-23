import React, { useEffect, useRef } from 'react';
import { ArrowRight, Trophy } from 'lucide-react';

type StatTrackerFinalPromptProps = {
  athleteName: string;
  followHref: string | null;
  onDismiss: () => void;
};

export function StatTrackerFinalPrompt({ athleteName, followHref, onDismiss }: StatTrackerFinalPromptProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="spectator-final-title"
      aria-describedby="spectator-final-description"
      data-testid="stat-tracker-final-prompt"
      onCancel={(event) => { event.preventDefault(); onDismiss(); }}
      className="fixed inset-0 m-auto max-h-[85dvh] w-[90vw] max-w-md overflow-y-auto border border-primary/50 bg-card p-6 text-card-foreground shadow-2xl backdrop:bg-black/80 sm:p-8"
    >
      <Trophy className="h-9 w-9 text-primary" aria-hidden="true" />
      <p className="mt-4 text-xs font-bold uppercase tracking-[.2em] text-primary-ink">Game complete</p>
      <h2 id="spectator-final-title" className="mt-2 break-words font-display text-3xl uppercase tracking-wide">
        Thanks for watching {athleteName || 'the game'}!
      </h2>
      <p id="spectator-final-description" className="mt-3 text-sm text-muted-foreground">
        {followHref
          ? `Keep cheering ${athleteName || 'this athlete'} on. Open their HYPE Card to follow and stay connected.`
          : 'The game has ended. You can still review the final score and recorded stats.'}
      </p>
      {followHref && (
        <a
          href={followHref}
          data-testid="link-final-prompt-follow"
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 bg-primary px-4 py-3 text-sm font-bold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Follow {athleteName || 'athlete'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </a>
      )}
      <button
        type="button"
        onClick={onDismiss}
        data-testid="button-final-view-stats"
        className="mt-3 min-h-11 w-full border border-border px-4 py-3 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        View final stats
      </button>
    </dialog>
  );
}
