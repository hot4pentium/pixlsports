import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'wouter';
import { Trophy, X } from 'lucide-react';
import { getGameOutcome, hasRecordedGameScore, type GameOutcome, type GameSession } from './stat-tracker';

const outcomeLabels: Record<GameOutcome, string> = { win: 'Win', loss: 'Loss', tie: 'Tie' };

export function GameOutcomePicker({
  value,
  onChange,
  disabled = false,
  clearLabel = 'Clear selection / use score instead',
}: {
  value: GameOutcome | null;
  onChange: (value: GameOutcome | null) => void;
  disabled?: boolean;
  clearLabel?: string;
}) {
  return (
    <fieldset className="mt-4 border border-[#476582] bg-[#102B4D] p-3" data-testid="game-outcome-picker">
      <legend className="bg-[#102B4D] px-1 text-xs font-bold uppercase tracking-widest text-white">Game result</legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(['win', 'loss', 'tie'] as const).map((result) => (
          <button
            key={result}
            type="button"
            disabled={disabled}
            aria-pressed={value === result}
            onClick={() => onChange(result)}
            data-testid={`button-game-outcome-${result}`}
            className="min-h-11 border border-[#9BB9D7] bg-[#173A60] px-2 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:border-[#55A4FF] aria-pressed:border-[#55A4FF] aria-pressed:bg-[#1F70D8] aria-pressed:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#55A4FF] disabled:cursor-not-allowed disabled:opacity-100 disabled:[-webkit-text-fill-color:#F8FAFC]"
          >
            {outcomeLabels[result]}
          </button>
        ))}
      </div>
      {value && <button type="button" disabled={disabled} onClick={() => onChange(null)} className="mt-2 min-h-11 text-xs font-medium text-white underline underline-offset-4 hover:text-[#B8D9FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#55A4FF] disabled:cursor-not-allowed disabled:opacity-80">{clearLabel}</button>}
    </fieldset>
  );
}

export function TrackerCompletionDialog({
  game,
  open,
  onOpenChange,
  teamName,
  saveStatus,
  onViewStats,
  viewHref,
}: {
  game: GameSession | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamName: string;
  saveStatus?: 'saving' | 'cloud-saved' | 'local-saved';
  onViewStats?: () => void;
  viewHref?: string;
}) {
  const headingId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    if (!open || !game) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    dialog?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChangeRef.current(false);
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
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
  }, [open, game?.id]);

  if (!game || !open || typeof document === 'undefined') return null;
  const outcome = getGameOutcome(game);
  const hasScore = hasRecordedGameScore(game);
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-background/85 p-4 backdrop-blur-sm pointer-events-auto" onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId} className="tracker-completion-dialog relative max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain border border-primary bg-card text-card-foreground shadow-2xl outline-none clip-angled-sm" data-testid="dialog-tracker-completed">
        <button type="button" onClick={() => onOpenChange(false)} className="absolute right-3 top-3 z-10 grid min-h-11 min-w-11 place-items-center border border-border bg-card text-foreground" aria-label="Close game completion" data-testid="button-completion-close"><X size={18} aria-hidden="true" /></button>
        <div className="tracker-completion-celebration" aria-hidden="true">
          {Array.from({ length: 14 }, (_, index) => (
            <span key={index} className="tracker-completion-confetti" style={{ left: `${8 + index * 6.4}%`, animationDelay: `${(index % 5) * 90}ms` }} />
          ))}
          <div className="tracker-completion-trophy"><Trophy size={32} strokeWidth={2.2} /></div>
        </div>
        <div className="px-6 pb-7 sm:px-8">
          <div className="text-left">
            <p className="text-xs font-bold uppercase tracking-[.22em] text-primary-ink">Game complete</p>
            <h2 id={headingId} className="font-display text-4xl uppercase">Congrats!</h2>
            <p id={descriptionId} className="text-sm text-muted-foreground">
              {game.opponent ? `Your game against ${game.opponent} is complete.` : 'Your game is complete.'}
            </p>
          </div>
          <div className="mt-5 border border-border bg-background p-4" data-testid="tracker-completion-score">
            <p className="text-center text-[10px] font-bold uppercase tracking-[.2em] text-muted-foreground">Final score</p>
            {hasScore ? (
              <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
                <div className="min-w-0"><p className="truncate text-xs font-bold">{teamName || 'Your team'}</p><p className="font-display text-4xl text-primary-ink">{game.score}</p></div>
                <span className="text-lg text-muted-foreground">–</span>
                <div className="min-w-0"><p className="truncate text-xs font-bold">{game.opponent || 'Opponent'}</p><p className="font-display text-4xl">{game.opponentScore}</p></div>
              </div>
            ) : <p className="mt-3 text-center text-sm font-semibold text-muted-foreground">Score not recorded</p>}
            {outcome && <p className="mt-2 text-center text-xs font-bold uppercase tracking-widest text-primary-ink" data-testid="tracker-completion-outcome">{outcomeLabels[outcome]}</p>}
          </div>
          <p className="mt-5 text-sm leading-relaxed">
             Your stats are in <strong>Season stats</strong>. Open this game there for the full report and season totals.
          </p>
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {saveStatus === 'saving' ? 'Saved on this device. Syncing your cloud history…'
              : saveStatus === 'local-saved' ? 'Saved on this device. Cloud sync needs attention in Stat Tracker.'
                : saveStatus === 'cloud-saved' ? 'Saved to your history and synced to your account.'
                  : 'Saved on this device. Open Stat Tracker to review or sync.'}
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            {onViewStats && <button type="button" onClick={onViewStats} className="min-h-11 flex-1 bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground" data-testid="button-completion-view-stats">View game stats</button>}
             {viewHref && <Link href={viewHref} onClick={() => onOpenChange(false)} className="inline-flex min-h-11 flex-1 items-center justify-center bg-primary px-4 text-xs font-bold uppercase tracking-widest text-primary-foreground" data-testid="button-completion-view-stats">{viewHref.startsWith('/studio/season-stats') ? 'View game stats' : 'Open Stat Tracker'}</Link>}
            <button type="button" onClick={() => onOpenChange(false)} className="min-h-11 border border-border px-4 text-xs font-bold uppercase tracking-widest" data-testid="button-completion-done">Done</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}